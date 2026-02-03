/**
 * BilingualTranslationDemo 组件
 * 基于 AutoDetectBilingualAsrService 实现双向实时转译
 * 
 * 核心功能：
 * 1. 自动检测输入语言（中文/英文）
 * 2. 自动翻译成目标语言
 * 3. 实时语音识别（ASR）
 * 4. 文本转语音（TTS）播放翻译结果
 * 5. 支持多种语言对配置
 * 
 * 工作流程：
 * 1. 用户说话 → ASR 识别文本
 * 2. AutoDetectBilingualAsrService 自动检测语言
 * 3. 自动翻译成另一种语言
 * 4. TTS 播放翻译结果
 * 5. 显示识别文本和翻译结果
 */

import React, { useEffect, useState, useRef, useCallback } from "react"
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from "react-native"
import { AudioModule } from "expo-audio"
import Colors from "@/colors"
import RequireMicAccess from "@/components/RequireMicAccess"
import { GummyConfig } from "@/services/AliAsrService"
import { AliTtsService, CosyvoiceConfig, YinseOptions } from "@/services/AliTtsService"
import { AudioSource } from "@/services/AudioSource"
import { AutoDetectBilingualAsrService, BilingualLanguageConfig } from "@/services/AutoDetectBilingualAsrService"
import * as FileSystem from 'expo-file-system'
import Sound from 'react-native-sound'
import { Picker } from "@/components/Picker"
import { MenuAction } from "@react-native-menu/menu"

type MicrophoneAccess = "pending" | "granted" | "denied"

// 定义语言对配置
const LANGUAGE_PAIR_CONFIGS = {
  "zh-en": {
    name: "中英互译",
    description: "Chinese ↔ English",
    langConfig: {
      languageMapping: {
        "zh": "en",
        "en": "zh",
      },
      detectLanguage: (text: string) => {
        const chineseRegex = /[\u4E00-\u9FFF]/g
        const ratio = (text.match(chineseRegex) || []).length / text.length
        return ratio > 0.3 ? "zh" : "en"
      },
    } as BilingualLanguageConfig,
    defaultVoice: "loongcindy_v2",
  },
  "en-ja": {
    name: "英日互译",
    description: "English ↔ Japanese",
    langConfig: {
      languageMapping: {
        "en": "ja",
        "ja": "en",
      },
      detectLanguage: (text: string) => {
        const japaneseRegex = /[\u3040-\u309F\u30A0-\u30FF]/g
        const ratio = (text.match(japaneseRegex) || []).length / text.length
        return ratio > 0.2 ? "ja" : "en"
      },
    } as BilingualLanguageConfig,
    defaultVoice: "hana_v2",
  },
  "en-ko": {
    name: "英韩互译",
    description: "English ↔ Korean",
    langConfig: {
      languageMapping: {
        "en": "ko",
        "ko": "en",
      },
      detectLanguage: (text: string) => {
        const koreanRegex = /[\uAC00-\uD7AF]/g
        const ratio = (text.match(koreanRegex) || []).length / text.length
        return ratio > 0.3 ? "ko" : "en"
      },
    } as BilingualLanguageConfig,
    defaultVoice: "jieun_v2",
  },
}

type LanguagePairKey = keyof typeof LANGUAGE_PAIR_CONFIGS

export const BilingualTranslationDemo = () => {
  // Microphone access state
  const [micAccess, setMicAccess] = useState<MicrophoneAccess>("pending")

  // Processing state
  const [isProcessing, setIsProcessing] = useState(false)

  // Language pair selection
  const [selectedLanguagePair, setSelectedLanguagePair] = useState<LanguagePairKey>("zh-en")

  // Performance optimization: server-side audio cache
  const [useServerCache, setUseServerCache] = useState(false)

  // Results display
  const [sourceText, setSourceText] = useState("")
  const [translatedText, setTranslatedText] = useState("")
  const [detectedLanguage, setDetectedLanguage] = useState("")
  const [targetLanguage, setTargetLanguage] = useState("")
  const [status, setStatus] = useState("Ready")

  // TTS state
  const [isTtsProcessing, setIsTtsProcessing] = useState(false)
  const [ttsStatus, setTtsStatus] = useState("Ready")
  const [playbackStatus, setPlaybackStatus] = useState("stopped")

  // Service instances
  const bilingualAsrServiceRef = useRef<AutoDetectBilingualAsrService | null>(null)
  const ttsServiceRef = useRef<AliTtsService | null>(null)
  const audioProcessorRef = useRef<AudioSource | null>(null)

  // Audio buffer for TTS
  const audioDataBuffer = useRef<Uint8Array[]>([])
  const soundRef = useRef<Sound | null>(null)
  const isPlaying = useRef(false)

  // Audio collection for ASR processing
  const audioFramesRef = useRef<Int16Array[]>([])
  const isCollectingRef = useRef(false)
  const isProcessingRef = useRef(false)
  const isPhaseSwitchingRef = useRef(false)  // 标记阶段切换期间的状态

  // ScrollView ref
  const scrollViewRef = useRef<ScrollView>(null)

  // Language pair options for picker
  const languagePairOptions: MenuAction[] = Object.entries(LANGUAGE_PAIR_CONFIGS).map(([key, config]) => ({
    id: key,
    title: `${config.name} (${config.description})`,
  }))

  // Auto scroll to bottom when content updates
  useEffect(() => {
    const timer = setTimeout(() => {
      scrollViewRef.current?.scrollToEnd({ animated: true })
    }, 100)
    return () => clearTimeout(timer)
  }, [sourceText, translatedText])

  // Request microphone permission
  useEffect(() => {
    ;(async () => {
      const status = await AudioModule.requestRecordingPermissionsAsync()
      if (status.granted) {
        console.log("Granted microphone permission")
        setMicAccess("granted")
      } else {
        setMicAccess("denied")
      }
    })()
  }, [])

  // Initialize services
  useEffect(() => {
    if (micAccess !== "granted") return

    console.log("[BilingualTranslationDemo] Initializing services")

    // Get language config
    const langConfig = LANGUAGE_PAIR_CONFIGS[selectedLanguagePair].langConfig

    // Create bilingual ASR service
    const asrConfig = new GummyConfig()
    const bilingualAsrService = new AutoDetectBilingualAsrService(asrConfig, langConfig)
    
    // Enable server-side audio cache optimization if requested
    if (useServerCache) {
      console.log("[BilingualTranslationDemo] Enabling server-side audio cache optimization")
      bilingualAsrService.setUseServerSideAudioCache(true)
    }
    
    bilingualAsrServiceRef.current = bilingualAsrService

    // Close old TTS service if exists
    const oldTtsService = ttsServiceRef.current
    if (oldTtsService) {
      try {
        oldTtsService.close()
      } catch (error) {
        console.error("Error closing old TTS service:", error)
      }
      ttsServiceRef.current = null
    }

    // Create TTS service
    const ttsConfig = new CosyvoiceConfig()
    const defaultVoice = LANGUAGE_PAIR_CONFIGS[selectedLanguagePair].defaultVoice
    ttsConfig.parameters.voice = defaultVoice
    const ttsService = new AliTtsService(ttsConfig)
    ttsServiceRef.current = ttsService

    // Get audio processor
    const audioProcessor = AudioSource.getInstance()
    audioProcessorRef.current = audioProcessor

    // Set up translation result callback to receive real-time translation results
    bilingualAsrService.setTranslationResultCallback((result) => {
      console.log("[BilingualTranslationDemo] Translation result:", result)
      setSourceText(result.transcriptionText)
      setTranslatedText(result.translation)
      setDetectedLanguage(result.detectedLanguage)
      setTargetLanguage(result.targetLanguage)
      setStatus("Translating...")
      
      // Auto trigger TTS for translated text (real-time)
      if (result.translation.trim()) {
        triggerTTS(result.translation, result.targetLanguage)
      }
    })

    // Set up phase switching callback to control audio sending
    bilingualAsrService.setPhaseSwitchingCallback((isSwitching) => {
      console.log("[BilingualTranslationDemo] Phase switching:", isSwitching)
      isPhaseSwitchingRef.current = isSwitching
      if (isSwitching) {
        setStatus("Switching to translation phase...")
      }
    })

    // Set up TTS audio callback
    ttsService.setAudioCallback((audioData, metadata) => {
      if (metadata?.isFinal) {
        console.log("[TTS] Audio stream ended")
        playAudioBuffer()
      } else if (audioData) {
        const chunk = new Uint8Array(audioData)
        audioDataBuffer.current.push(chunk)
        console.log(`[TTS] Received chunk ${audioDataBuffer.current.length}`)
      }
    })

    // Set up TTS error callback
    ttsService.setErrorCallback((error) => {
      console.error("[TTS] Error:", error)
      setTtsStatus(`Error: ${error.message}`)
      setIsTtsProcessing(false)
    })

    // Set up TTS event callback
    ttsService.setEventCallback((event, data) => {
      console.log("[TTS Event]", event, data)
      switch (event) {
        case "task-started":
          setIsTtsProcessing(true)
          setTtsStatus("Synthesis started")
          audioDataBuffer.current = []
          setPlaybackStatus("stopped")
          break
        case "task-finished":
          setTtsStatus("Synthesis finished")
          break
        case "timeout":
          console.warn("[TTS] Timeout detected")
          setTtsStatus("Timeout")
          setIsTtsProcessing(false)
          audioDataBuffer.current = []
          break
        case "error":
          setTtsStatus(`Error: ${data?.message || "Unknown error"}`)
          setIsTtsProcessing(false)
          break
      }
    })

    return () => {
      console.log("[BilingualTranslationDemo] Cleaning up services")
      if (audioProcessorRef.current) {
        audioProcessorRef.current.stopProcessing()
      }
      if (bilingualAsrServiceRef.current) {
        try {
          bilingualAsrServiceRef.current.disconnect()
        } catch (error) {
          console.error("Error cleaning up ASR service:", error)
        }
      }
      if (ttsServiceRef.current) {
        try {
          ttsServiceRef.current.close()
        } catch (error) {
          console.error("Error cleaning up TTS service:", error)
        }
      }
      if (soundRef.current) {
        soundRef.current.release()
        soundRef.current = null
      }
      setPlaybackStatus("stopped")
      setIsTtsProcessing(false)
    }
  }, [micAccess, selectedLanguagePair, useServerCache])

  // Play audio buffer
  const playAudioBuffer = useCallback(async () => {
    if (audioDataBuffer.current.length === 0) {
      console.log("[playAudioBuffer] No audio data to play")
      setPlaybackStatus("stopped")
      return
    }

    console.log(`[playAudioBuffer] Starting playback with ${audioDataBuffer.current.length} chunks`)
    setPlaybackStatus("playing")
    isPlaying.current = true

    try {
      // Combine audio chunks
      const totalLength = audioDataBuffer.current.reduce((acc, chunk) => acc + chunk.byteLength, 0)
      const combinedBuffer = new Uint8Array(totalLength)
      let offset = 0
      for (const chunk of audioDataBuffer.current) {
        combinedBuffer.set(chunk, offset)
        offset += chunk.byteLength
      }

      console.log(`[playAudioBuffer] Combined buffer size: ${combinedBuffer.byteLength} bytes`)

      // Convert to base64
      const base64Data = btoa(String.fromCharCode(...combinedBuffer))

      // Write to temporary file
      const timestamp = Date.now()
      const path = `${FileSystem.cacheDirectory}bilingual_audio_${timestamp}.mp3`

      await FileSystem.writeAsStringAsync(path, base64Data, {
        encoding: FileSystem.EncodingType.Base64,
      })

      console.log(`[playAudioBuffer] Audio file written to: ${path}`)

      // Stop previous playback if any
      if (soundRef.current) {
        soundRef.current.stop()
        soundRef.current.release()
        soundRef.current = null
      }

      // Clear buffer
      audioDataBuffer.current = []

      // Play audio
      const sound = new Sound(path, undefined, (error) => {
        if (error) {
          console.error("[playAudioBuffer] Failed to load audio:", error)
          setIsTtsProcessing(false)
          setPlaybackStatus("stopped")
          isPlaying.current = false
          FileSystem.deleteAsync(path, { idempotent: true }).catch(console.error)
          return
        }

        console.log("[playAudioBuffer] Audio loaded, starting playback")
        sound.play((success) => {
          console.log(`[playAudioBuffer] Playback finished, success: ${success}`)
          sound.release()
          soundRef.current = null
          setPlaybackStatus("stopped")
          setIsTtsProcessing(false)
          isPlaying.current = false
          FileSystem.deleteAsync(path, { idempotent: true }).catch(console.error)
        })
      })

      soundRef.current = sound
    } catch (error) {
      console.error("[playAudioBuffer] Failed to play audio:", error)
      setPlaybackStatus("stopped")
      isPlaying.current = false
      setIsTtsProcessing(false)
      audioDataBuffer.current = []
    }
  }, [])

  // Trigger TTS
  const triggerTTS = async (text: string, language: string) => {
    const ttsService = ttsServiceRef.current

    if (!ttsService) {
      console.error("[TTS] Service not initialized")
      return
    }

    if (!text.trim()) {
      console.log("[TTS] No text to synthesize")
      return
    }

    console.log(`[TTS] Triggering synthesis for: ${text}`)
    setIsTtsProcessing(true)
    setTtsStatus("Connecting...")

    try {
      // Connect and start synthesis
      await ttsService.connect()
      console.log("[TTS] Connected")

      await ttsService.start()
      console.log("[TTS] Task started")

      ttsService.sendText(text, true)
      console.log("[TTS] Text sent")
    } catch (error) {
      console.error("[TTS] Failed to synthesize:", error)
      setTtsStatus(`Failed: ${error instanceof Error ? error.message : String(error)}`)
      setIsTtsProcessing(false)
      audioDataBuffer.current = []
    }
  }

  // Start processing
  const handleStartProcessing = async () => {
    const asrService = bilingualAsrServiceRef.current
    const audioProcessor = audioProcessorRef.current

    if (!asrService || !audioProcessor) {
      console.error("[Start] Services not initialized")
      return
    }

    setIsProcessing(true)
    isProcessingRef.current = true
    setSourceText("")
    setTranslatedText("")
    setDetectedLanguage("")
    setTargetLanguage("")
    setStatus("Connecting to ASR service...")

    try {
      // Start real-time bilingual translation
      console.log("[Start] Starting real-time bilingual translation")
      await asrService.startRealtimeTranslation()
      console.log("[Start] Real-time translation service started")

      setStatus("Recording... speak now!")
      
      // Start audio processing and send audio data to ASR service in real-time
      console.log("[Start] Starting real-time audio processing")
      audioProcessor.startProcessing((processedData) => {
        const isReady = asrService.isReady()
        const isSwitching = isPhaseSwitchingRef.current
        console.log("[Start] Audio callback triggered, isProcessing:", isProcessingRef.current, "hasData:", !!processedData?.data, "isReady:", isReady, "isSwitching:", isSwitching)
        
        // 只在准备就绪且不在切换阶段时发送音频
        if (isProcessingRef.current && processedData && processedData.data && isReady && !isSwitching) {
          console.log("[Start] Sending audio data to ASR service, size:", processedData.data.length)
          try {
            // Cache detection phase audio frames for later use in translation phase
            asrService.cacheDetectionAudioFrame(processedData.data)
            console.log("[Start] Cached detection audio frame")
            
            asrService.sendAudio(processedData.data)
            console.log("[Start] Audio data sent successfully")
          } catch (error) {
            console.error("[Start] Failed to send audio:", error)
          }
        } else {
          if (isSwitching) {
            console.log("[Start] Skipping audio send - phase switching in progress")
          } else {
            console.log("[Start] Skipping audio send - condition not met. isProcessingRef:", isProcessingRef.current, "isReady:", isReady)
          }
        }
      })

    } catch (error) {
      console.error("[Start] Failed to start:", error)
      setIsProcessing(false)
      isProcessingRef.current = false
      setStatus(`Failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  // Stop processing
  const handleStopProcessing = async () => {
    const asrService = bilingualAsrServiceRef.current
    const audioProcessor = audioProcessorRef.current

    if (!asrService || !audioProcessor) return

    console.log("[Stop] Stopping all services")
    setIsProcessing(false)
    isProcessingRef.current = false

    try {
      // Stop audio processor
      audioProcessor.stopProcessing()
      console.log("[Stop] Audio processor stopped")

      // Stop ASR task
      console.log("[Stop] Stopping ASR task")
      try {
        await asrService.stop()
        console.log("[Stop] ASR task stopped")
      } catch (error) {
        console.warn("[Stop] Error stopping ASR task:", error)
      }

      // Disconnect from ASR service
      console.log("[Stop] Disconnecting from ASR service")
      try {
        await asrService.disconnect()
        console.log("[Stop] Disconnected from ASR service")
      } catch (error) {
        console.warn("[Stop] Error disconnecting ASR service:", error)
      }

      // Reset realtime state for next session
      asrService.resetRealtimeState()
      console.log("[Stop] Realtime state reset")

      setStatus("Stopped")
      setSourceText("")
      setTranslatedText("")
    } catch (error) {
      console.error("[Stop] Failed to stop:", error)
      setStatus(`Failed to stop: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  // Render main content
  return micAccess === "granted" ? (
    <ScrollView style={styles.container} ref={scrollViewRef}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Bilingual Translation</Text>
        <Text style={styles.headerSubtitle}>Real-time ASR & Translation</Text>
      </View>

      {/* Language Pair Selection */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Language Pair</Text>
        <Picker
          actions={languagePairOptions}
          onSelect={(pair) => setSelectedLanguagePair(pair as LanguagePairKey)}
          value={selectedLanguagePair}
          disabled={isProcessing}
        >
          <TouchableOpacity style={styles.languageButton}>
            <Text style={styles.languageButtonText}>
              {languagePairOptions.find((p) => p.id === selectedLanguagePair)?.title ||
                selectedLanguagePair}
            </Text>
          </TouchableOpacity>
        </Picker>
      </View>

      {/* Performance Optimization Settings */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Performance Settings</Text>
        <TouchableOpacity
          style={[styles.optionButton, useServerCache && styles.optionButtonActive]}
          onPress={() => setUseServerCache(!useServerCache)}
          disabled={isProcessing}
        >
          <Text style={[styles.optionButtonText, useServerCache && styles.optionButtonTextActive]}>
            {useServerCache ? "✓ Server-side Cache Enabled" : "○ Server-side Cache Disabled"}
          </Text>
          <Text style={[styles.optionButtonSubtext, useServerCache && styles.optionButtonSubtextActive]}>
            Skip re-transmission of audio in translation phase
          </Text>
        </TouchableOpacity>
      </View>

      {/* Control Buttons */}
      <View style={styles.section}>
        <View style={styles.controls}>
          <TouchableOpacity
            style={[styles.button, isProcessing ? styles.stopButton : styles.startButton]}
            onPress={isProcessing ? handleStopProcessing : handleStartProcessing}
          >
            <Text style={styles.buttonText}>{isProcessing ? "Stop" : "Start"}</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Status */}
      <View style={styles.section}>
        <View style={styles.statusContainer}>
          <Text style={styles.statusLabel}>ASR Status:</Text>
          <Text style={[styles.statusValue, { color: isProcessing ? Colors.ok : Colors.secondary }]}>
            {status}
          </Text>
        </View>
        <View style={styles.statusContainer}>
          <Text style={styles.statusLabel}>TTS Status:</Text>
          <Text style={[styles.statusValue, { color: isTtsProcessing ? Colors.ok : Colors.secondary }]}>
            {ttsStatus}
          </Text>
        </View>
      </View>

      {/* Source Text */}
      <View style={styles.section}>
        <Text style={styles.resultTitle}>
          Original Text ({detectedLanguage.toUpperCase() || "—"})
        </Text>
        <View style={styles.resultBox}>
          <Text style={styles.resultText}>{sourceText || "Waiting for input..."}</Text>
        </View>
      </View>

      {/* Translated Text */}
      <View style={styles.section}>
        <Text style={styles.resultTitle}>
          Translated Text ({targetLanguage.toUpperCase() || "—"})
        </Text>
        <View style={styles.resultBox}>
          <Text style={styles.resultText}>{translatedText || "Translation will appear here..."}</Text>
        </View>
      </View>

      {/* Playback Status */}
      {(isTtsProcessing || playbackStatus !== "stopped") && (
        <View style={styles.section}>
          <View style={styles.playbackStatusContainer}>
            <View
              style={[
                styles.playbackIndicator,
                {
                  backgroundColor:
                    playbackStatus === "playing"
                      ? Colors.ok
                      : playbackStatus === "paused"
                        ? Colors.warn
                        : Colors.secondary,
                },
              ]}
            />
            <Text style={styles.playbackStatusText}>
              Playback: {playbackStatus.charAt(0).toUpperCase() + playbackStatus.slice(1)}
            </Text>
          </View>
        </View>
      )}

      {/* Footer spacing */}
      <View style={{ height: 40 }} />
    </ScrollView>
  ) : micAccess === "denied" ? (
    <RequireMicAccess />
  ) : (
    <View style={styles.loadingContainer}>
      <Text style={styles.loadingText}>Requesting microphone access...</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.bgInactive,
    padding: 20,
  },
  header: {
    marginBottom: 30,
    alignItems: "center",
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: "bold",
    color: Colors.primary,
    marginBottom: 8,
  },
  headerSubtitle: {
    fontSize: 16,
    color: Colors.secondary,
  },
  section: {
    backgroundColor: Colors.bgActive,
    borderRadius: 15,
    padding: 15,
    marginBottom: 15,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "bold",
    color: Colors.primary,
    marginBottom: 10,
  },
  controls: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 10,
  },
  button: {
    paddingVertical: 12,
    paddingHorizontal: 30,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    minWidth: 120,
  },
  startButton: {
    backgroundColor: Colors.primary,
  },
  stopButton: {
    backgroundColor: Colors.low,
  },
  buttonText: {
    color: Colors.bgInactive,
    fontWeight: "bold",
    fontSize: 16,
  },
  languageButton: {
    backgroundColor: Colors.bgInactive,
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: Colors.primary,
    alignItems: "center",
  },
  languageButtonText: {
    color: Colors.primary,
    fontWeight: "bold",
    fontSize: 14,
  },
  optionButton: {
    backgroundColor: Colors.bgInactive,
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: Colors.secondary,
    alignItems: "flex-start",
  },
  optionButtonActive: {
    borderColor: Colors.primary,
    backgroundColor: Colors.primary + "15", // Primary with transparency
  },
  optionButtonText: {
    color: Colors.secondary,
    fontWeight: "bold",
    fontSize: 14,
  },
  optionButtonTextActive: {
    color: Colors.primary,
  },
  optionButtonSubtext: {
    color: Colors.secondary,
    fontSize: 12,
    marginTop: 4,
  },
  optionButtonSubtextActive: {
    color: Colors.primary,
  },
  statusContainer: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 10,
    paddingHorizontal: 0,
    borderBottomWidth: 1,
    borderBottomColor: Colors.bgInactive,
  },
  statusContainer_last: {
    borderBottomWidth: 0,
  },
  statusLabel: {
    fontSize: 14,
    fontWeight: "bold",
    color: Colors.primary,
  },
  statusValue: {
    fontSize: 14,
    fontWeight: "500",
    textAlign: "right",
    flex: 1,
    marginLeft: 10,
  },
  resultTitle: {
    fontSize: 16,
    fontWeight: "bold",
    color: Colors.primary,
    marginBottom: 8,
  },
  resultBox: {
    backgroundColor: Colors.bgInactive,
    borderRadius: 10,
    padding: 12,
    minHeight: 80,
    justifyContent: "center",
    borderLeftWidth: 4,
    borderLeftColor: Colors.primary,
  },
  resultText: {
    fontSize: 16,
    color: Colors.primary,
    lineHeight: 24,
  },
  playbackStatusContainer: {
    flexDirection: "row",
    alignItems: "center",
    padding: 12,
    backgroundColor: Colors.bgInactive,
    borderRadius: 10,
  },
  playbackIndicator: {
    width: 12,
    height: 12,
    borderRadius: 6,
    marginRight: 10,
  },
  playbackStatusText: {
    fontSize: 14,
    color: Colors.primary,
    fontWeight: "500",
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: Colors.bgInactive,
  },
  loadingText: {
    fontSize: 18,
    color: Colors.primary,
    marginTop: 10,
  },
})
