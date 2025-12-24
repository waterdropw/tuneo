/**
 * AliBailianDemo 组件
 * 演示阿里云语音识别(ASR)和文本转语音(TTS)功能的集成
 * 
 * 重构亮点：
 * 1. 集成了阿里云TTS服务，实现文本到语音的转换
 * 2. 采用双音频文件架构，分离音频读取与写入操作
 * 3. 实现双缓冲技术，确保音频数据处理的流畅性和连续性
 * 4. 设计了合理的缓冲管理策略，避免音频播放卡顿或延迟
 * 5. 实现了完整的音频播放控制逻辑和状态管理
 * 
 * 组件结构：
 * - ASR Section: 处理语音识别功能
 * - TTS Section: 处理文本转语音功能，包括双缓冲区状态显示
 */

import React, { useEffect, useState, useRef, useCallback } from "react"
import { View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity } from "react-native"
import { AudioModule } from "expo-audio"
import Colors from "@/colors"
import RequireMicAccess from "@/components/RequireMicAccess"
import { AliAsrService, GummyConfig, LanguageOptions } from "@/services/AliAsrService"
import { AliTtsService, CosyvoiceConfig, FangyanOptions, YinseOptions } from "@/services/AliTtsService"
import { AudioSource } from "@/services/AudioSource"
import * as FileSystem from 'expo-file-system'
import Sound from 'react-native-sound'
import { Picker } from "@/components/Picker"
import { MenuAction } from "@react-native-menu/menu"

type MicrophoneAccess = "pending" | "granted" | "denied"


export const AliBailianDemo = () => {
  // Microphone access state
  const [micAccess, setMicAccess] = useState<MicrophoneAccess>("pending")
  
  // ASR Processing state
  const [isProcessing, setIsProcessing] = useState(false)
  
  // TTS state
  const [ttsText, setTtsText] = useState("")           // 用户输入的待合成文本
  const [isTtsProcessing, setIsTtsProcessing] = useState(false) // TTS处理状态
  const [ttsStatus, setTtsStatus] = useState("")       // TTS状态信息
  // TTS Section collapse state
  const [isTtsCollapsed, setIsTtsCollapsed] = useState(true) // 默认折叠状态
  
  // Audio playback state
  const [playbackStatus, setPlaybackStatus] = useState("stopped") // "stopped", "playing", "paused"
  
  // 使用useRef存储最新的playbackStatus，确保回调函数能访问到最新值
  const playbackStatusRef = useRef(playbackStatus)
  
  // 当playbackStatus变化时，更新ref
  useEffect(() => {
    playbackStatusRef.current = playbackStatus
  }, [playbackStatus])
  
  
  // 当playbackStatus变化时更新ref
  useEffect(() => {
    playbackStatusRef.current = playbackStatus
  }, [playbackStatus])
  
  // 存储ASR服务返回的结果键值对
  const [resultPairs, setResultPairs] = useState<{ key: string; value: string }[]>([])
  // 存储最新的ASR识别文本，用于自动TTS
  const [latestAsrText, setLatestAsrText] = useState("")
  // 存储已处理的结果对哈希，避免重复触发TTS
  const [processedResultHash, setProcessedResultHash] = useState("")
  
  // 翻译目标语言状态
  const [targetLanguage, setTargetLanguage] = useState<string>("en")
  // 中文的方言状态
  const [dialect, setDialect] = useState<string>("bj")
  // TTS音色状态
  const [voice, setVoice] = useState<string>("longanyang")
  
  // 支持的翻译语言列表
  const languageOptions: MenuAction[] = Object.entries(LanguageOptions).map(([id, title]) => ({
    id,
    title: `${title} (${id})`
  }))
  // 支持的方言列表
  const fangyanOptions: MenuAction[] = Object.entries(FangyanOptions).map(([id, title]) => ({
    id,
    title
  }))
  // 支持的音色列表
  const yinseOptions: MenuAction[] = Object.entries(YinseOptions).map(([id, title]) => ({
    id,
    title
  }))
  
  // ScrollView ref for auto-scrolling to latest results
  const scrollViewRef = useRef<ScrollView>(null)
  
  // Service instances (using useRef to avoid re-initialization on re-renders)
  const asrServiceRef = useRef<AliAsrService | null>(null)           // ASR服务实例
  const ttsServiceRef = useRef<AliTtsService | null>(null)           // TTS服务实例
  const audioProcessorRef = useRef<AudioSource | null>(null)         // 音频处理器实例
  
  // TTS audio data buffer
  const audioDataBuffer = useRef<Uint8Array[]>([])
  const isAudioComplete = useRef(false)
  const soundRef = useRef<Sound | null>(null)
  
  // Update result pairs helper function - 使用useCallback确保引用稳定
  const updateResultPairs = useCallback((result: Record<string, string>) => {
    // 将Record<string, string>转换为键值对数组
    const newPairs: { key: string; value: string }[] = Object.entries(result).map(([key, value]) => ({
      key,
      value
    }));
    
    // 直接设置最新结果，完全丢弃所有旧结果
    setResultPairs(newPairs);
  }, [])
  
  // Play audio from buffer - 使用useCallback确保引用稳定
  const playAudioBuffer = useCallback(async () => {
    if (audioDataBuffer.current.length === 0) {
      setPlaybackStatus("No audio data to play")
      return
    }
    
    setPlaybackStatus("playing")
    
    try {
      // Combine audio data chunks
      const totalLength = audioDataBuffer.current.reduce((acc, chunk) => acc + chunk.byteLength, 0)
      const combinedBuffer = new Uint8Array(totalLength)
      let offset = 0
      for (const chunk of audioDataBuffer.current) {
        combinedBuffer.set(chunk, offset)
        offset += chunk.byteLength
      }
      
      // Convert Uint8Array to base64 string
      const base64Data = btoa(String.fromCharCode(...combinedBuffer))
      
      // Write to temporary file and play
      const path = `${FileSystem.cacheDirectory}temp_audio.mp3`
      
      // Write to temporary file
      await FileSystem.writeAsStringAsync(path, base64Data, {
        encoding: FileSystem.EncodingType.Base64
      })
      
      // Play the file
      const sound = new Sound(path, '', (error) => {
        if (error) {
          console.log('加载失败', error)
          setIsTtsProcessing(false)
          setPlaybackStatus("stopped")
          return
        }
        sound.play(() => {
          sound.release()
          soundRef.current = null
          setPlaybackStatus("stopped")
          setIsTtsProcessing(false)
        })
      })
      
      soundRef.current = sound
      
    } catch (error) {
      console.error("Failed to play audio:", error)
      setPlaybackStatus("stopped")
    }
  }, [])

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
  
  // Initialize ASR service, TTS service and audio processor
  useEffect(() => {
    if (micAccess !== "granted") return
    
    // Create ASR service instance with GummyConfig for translation
    const config = new GummyConfig()
    // Set the translation target language based on user selection
    config.parameters.translation_target_languages = [targetLanguage]
    const asrService = new AliAsrService(config)
    asrServiceRef.current = asrService
    
    // Create TTS service instance with CosyvoiceConfig
    const ttsConfig = new CosyvoiceConfig()
    ttsConfig.parameters.language_hints = [targetLanguage]
    ttsConfig.parameters.voice = voice
    if (targetLanguage === "zh") {
      const selectedDialect = fangyanOptions.find(option => option.id === dialect);
      ttsConfig.parameters.instruction = `请用${selectedDialect?.title || "中文"}表达。`
    } else if (targetLanguage !== "en") {
      const selectedLanguage = LanguageOptions[targetLanguage as keyof typeof LanguageOptions];
      ttsConfig.parameters.instruction = `你会用${selectedLanguage || "该语言"}说出来。` 
    }
    const ttsService = new AliTtsService(ttsConfig)
    ttsServiceRef.current = ttsService
    
    // Create audio processor instance
    const audioProcessor = AudioSource.getInstance()
    audioProcessorRef.current = audioProcessor
    
    // Set up result callback for ASR service
    asrService.setResultCallback((result) => {
      console.log("Received ASR result:", result)
      
      // Ensure result is a valid object
      if (typeof result === 'object' && result !== null) {
        updateResultPairs(result)
        
        // Extract the recognized text from the result
        const textResult = Object.values(result).find(value => value.trim()) || "";
        if (textResult.trim()) {
          // 新结果拼接到旧结果后面，形成完整内容
          setLatestAsrText(prevText => {
            // 检查是否已经包含当前结果，避免重复拼接
            if (prevText.includes(textResult)) {
              return prevText;
            }
            return prevText + textResult;
          });
        }
      } else {
        console.error("Invalid ASR result format:", result)
      }
    })
    
    // Set up error callback for ASR service
    asrService.setErrorCallback((error) => {
      console.error("ASR error:", error)
      updateResultPairs({
        error: error.message
      })
    })
    
    // Set up audio callback for TTS service
    ttsService.setAudioCallback((audioData, metadata) => {
      console.log("Received TTS audio data:", audioData ? audioData.byteLength : "end")
      
      if (audioData) {
        // Convert ArrayBuffer to Uint8Array and add to buffer
        audioDataBuffer.current.push(new Uint8Array(audioData))
      } else {
        // Audio stream ended
        isAudioComplete.current = true
      }
    })
    
    // Set up error callback for TTS service
    ttsService.setErrorCallback((error) => {
      console.error("TTS error:", error)
      setTtsStatus(`TTS Error: ${error.message}`)
      setIsTtsProcessing(false)
    })
    
    // Set up event callback for TTS service
    ttsService.setEventCallback((event, data) => {
      console.log("TTS event:", event, data)
      switch (event) {
        case "task-started":
          setIsTtsProcessing(true)
          setTtsStatus("TTS synthesis started")
          // Reset audio buffer and status - 确保在开始合成时清空缓冲区
          audioDataBuffer.current = []
          isAudioComplete.current = false
          break
        case "task-finished":
          setTtsStatus("TTS synthesis finished")
          setIsTtsProcessing(false)
          // Auto play audio when synthesis is finished
          playAudioBuffer()
          break
        case "error":
          setTtsStatus(`TTS Error: ${data?.message || "Unknown error"}`)
          setIsTtsProcessing(false)
          break
      }
    })
    
    return () => {
      // Cleanup
      console.log("Cleaning up ASR service, TTS service, audio processor")
      if (audioProcessorRef.current) {
        audioProcessorRef.current.stopProcessing()
      }
      if (asrServiceRef.current) {
        // Ensure we close the connection if it's still open
        try {
          asrServiceRef.current.stop().catch(console.error)
        } catch (error) {
          console.error("Error stopping ASR service:", error)
        }
      }
      if (ttsServiceRef.current) {
        // Ensure we close the TTS connection if it's still open
        try {
          ttsServiceRef.current.close()
        } catch (error) {
          console.error("Error closing TTS service:", error)
        }
      }
      // Release sound if it exists
      if (soundRef.current) {
        soundRef.current.release()
        soundRef.current = null
      }
      // Reset playback status
      setPlaybackStatus("stopped")
      setIsTtsProcessing(false)
      setTtsStatus("Ready")
    }
  }, [micAccess, targetLanguage, dialect, playAudioBuffer, updateResultPairs])
  
  // Auto trigger TTS when ASR result is updated
  useEffect(() => {
    const triggerTTS = async () => {
      const ttsService = ttsServiceRef.current;
      if (!ttsService) {
        console.error("TTS service not initialized");
        return;
      }
      if (!resultPairs.length || resultPairs.length < 2) {
        console.error("No ASR result to synthesize");
        return;
      }
      
      // Generate a hash of the result pairs to check if we've already processed this result
      const resultHash = JSON.stringify(resultPairs);
      
      // Check if we've already processed this result
      if (resultHash === processedResultHash) {
        console.log("Skipping duplicate TTS trigger for the same result");
        return;
      }
      setIsTtsProcessing(true)
      setTtsStatus("Connecting to TTS service...");
      
      try {
        // Connect to TTS service
        await ttsService.connect();
        console.log("TTS service connected successfully for auto-trigger");
        
        // Send resultPairs[1] text for synthesis, if empty send resultPairs[0]
        const textToSynthesize = resultPairs[1].value.trim();
        ttsService.sendText(textToSynthesize, true);
        console.log("ASR text sent for synthesis:", textToSynthesize);
        
        // Update the processed hash to avoid duplicate triggers
        setProcessedResultHash(resultHash);
      } catch (error) {
        console.error("Failed to auto-trigger TTS synthesis:", error);
        setTtsStatus(`Failed to auto-trigger TTS: ${error instanceof Error ? error.message : String(error)}`);
        setIsTtsProcessing(false)
      }
    };
    
    triggerTTS();
  }, [resultPairs, processedResultHash]);
  
  // 3. 更新开始处理函数，重置动态结果数组
  const handleStartProcessing = async () => {
    const asrService = asrServiceRef.current
    const audioProcessor = audioProcessorRef.current
    
    if (!asrService || !audioProcessor) {
      console.error("ASR service or audio processor not initialized")
      return
    }
    
    setIsProcessing(true)
    // 重置动态结果数组
    setResultPairs([])
    // 重置latestAsrText，开始新的会话
    setLatestAsrText("")
    // 重置已处理结果哈希，允许新结果触发TTS
    setProcessedResultHash("")
    setIsTtsProcessing(false)
    setTtsStatus("Ready")
    
    try {
      // Connect to ASR service
      console.log("Connecting to ASR service...")
      await asrService.connect()
      console.log("ASR service connected successfully")
      
      // Start audio processing with callback to send audio to ASR service
      audioProcessor.startProcessing((processedData) => {
        if (processedData && processedData.data && asrService.isReady() && playbackStatusRef.current === "stopped") {
          try {
            asrService.sendAudio(processedData.data)
          } catch (error) {
            console.error("Error sending audio data:", error)
          }
        }
      })
      
      console.log("Audio processing started successfully")
    } catch (error) {
      console.error("Failed to start processing:", error)
      setIsProcessing(false)
      updateResultPairs({
        error: `Failed to start processing: ${error instanceof Error ? error.message : String(error)}`
      })
    }
  }
  
  // Stop processing
  const handleStopProcessing = async () => {
    const asrService = asrServiceRef.current
    const audioProcessor = audioProcessorRef.current
    
    if (!asrService || !audioProcessor) return
    
    console.log("Stopping processing")
    setIsProcessing(false)
    
    try {
      // Stop audio processing first
      audioProcessor.stopProcessing()
      console.log("Audio processing stopped")
      
      // Then stop ASR service
      await asrService.stop()
      console.log("ASR service stopped")
      
    } catch (error) {
      console.error("Failed to stop processing:", error)
      updateResultPairs({
        error: `Failed to stop processing: ${error instanceof Error ? error.message : String(error)}`
      })
    }
  }
  
  // Handle TTS synthesis
  const handleTtsSynthesis = async () => {
    const ttsService = ttsServiceRef.current
    
    if (!ttsService) {
      console.error("TTS service not initialized")
      return
    }
    
    if (!ttsText.trim()) {
      setTtsStatus("Please enter text to synthesize")
      return
    }
    
    setIsTtsProcessing(true)
    setTtsStatus("Connecting to TTS service...")
    
    try {
      // Connect to TTS service
      await ttsService.connect()
      console.log("TTS service connected successfully")
      
      // Send text for synthesis
      ttsService.sendText(ttsText, true)
      console.log("Text sent for synthesis")
      
    } catch (error) {
      console.error("Failed to start TTS synthesis:", error)
      setTtsStatus(`Failed to start TTS synthesis: ${error instanceof Error ? error.message : String(error)}`)
      setIsTtsProcessing(false)
    }
  }
  
  // Handle TTS stop
  const handleTtsStop = async () => {
    const ttsService = ttsServiceRef.current
    
    if (!ttsService) return
    
    try {
      await ttsService.stop()
      // Clear audio buffer
      audioDataBuffer.current = []
      isAudioComplete.current = false
      // Stop playback if active
      if (soundRef.current) {
        soundRef.current.stop()
        soundRef.current.release()
        soundRef.current = null
      }
      setIsTtsProcessing(false)
      setTtsStatus("TTS synthesis stopped")
      setPlaybackStatus("stopped")
    } catch (error) {
      console.error("Failed to stop TTS synthesis:", error)
      setTtsStatus(`Failed to stop TTS synthesis: ${error instanceof Error ? error.message : String(error)}`)
      setIsTtsProcessing(false)
    }
  }
  
  // 4. 实现动态View创建与布局
  return micAccess === "granted" ? (
    <View style={styles.container}>
      {/* ASR Section */}
      <View style={styles.section}>
        <Text style={styles.title}>ASR Recognition</Text>
        
        <View style={styles.controls}>
          <TouchableOpacity
            style={[styles.asrButton, isProcessing ? styles.stopButton : styles.startButton]}
            onPress={isProcessing ? handleStopProcessing : handleStartProcessing}
          >
            <Text style={styles.buttonText}>
              {isProcessing ? "Stop ASR" : "Start ASR"}
            </Text>
          </TouchableOpacity>
          
          <View style={styles.pickerContainer}>
            <Picker
              actions={languageOptions}
              onSelect={(lang) => setTargetLanguage(lang)}
              value={targetLanguage}
            >
              <TouchableOpacity style={styles.languageButton}>
                <Text style={styles.languageButtonText}>
                  {languageOptions.find(lang => lang.id === targetLanguage)?.title || targetLanguage}
                </Text>
              </TouchableOpacity>
            </Picker>
          </View>
        </View>
        
        {/* 固定永久显示的文本框，内容可上下滚动 */}
        <View style={styles.resultTextContainer}>
          {/* 标题 */}
          <Text style={styles.resultTextTitle}>ASR Result</Text>
          {/* 可滚动的文本内容 */}
          <ScrollView 
            style={styles.resultTextScroll} 
            showsVerticalScrollIndicator={true}
            // 自动滚动到底部，显示最新结果
            onContentSizeChange={(width, height) => {
              scrollViewRef.current?.scrollToEnd({ animated: true })
            }}
          >
            {/* 显示最新结果 */}
            <Text style={styles.resultTextContent}>
              {latestAsrText.trim() || (isProcessing ? "Processing audio..." : "No results yet. Click 'Start ASR' to begin.")}
            </Text>
          </ScrollView>
          {/* 自动TTS提示 */}
          {latestAsrText.trim() && (
            <View style={styles.autoTtsIndicator}>
              <Text style={styles.autoTtsText}>🔊 Auto TTS triggered</Text>
            </View>
          )}
        </View>
      </View>
      
      {/* TTS Section */}
      <View style={styles.section}>
        {/* TTS Collapsible Header */}
        <TouchableOpacity 
          style={styles.collapsibleHeader} 
          onPress={() => setIsTtsCollapsed(!isTtsCollapsed)}
        >
          <View style={styles.titleWithLanguage}>
            <Text style={styles.title}>TTS</Text>
            
            {/* TTS Language Selection */}
            <View style={styles.titlePickerContainer}>
              <Picker
                actions={fangyanOptions}
                onSelect={(lang) => setDialect(lang)}
                value={dialect}
              >
                <TouchableOpacity style={styles.titleLanguageButton}>
                  <Text style={styles.titleLanguageButtonText}>
                    {fangyanOptions.find(lang => lang.id === dialect)?.title || dialect}
                  </Text>
                </TouchableOpacity>
              </Picker>
            </View>
            
            {/* TTS Voice Selection */}
            <View style={styles.titlePickerContainer}>
              <Picker
                actions={yinseOptions}
                onSelect={(v) => setVoice(v)}
                value={voice}
              >
                <TouchableOpacity style={styles.titleLanguageButton}>
                  <Text style={styles.titleLanguageButtonText}>
                    {yinseOptions.find(v => v.id === voice)?.title || voice}
                  </Text>
                </TouchableOpacity>
              </Picker>
            </View>
          </View>
          
          {/* Collapse/Expand Icon */}
          <View style={styles.collapseIconContainer}>
            <Text style={styles.collapseIcon}>
              {isTtsCollapsed ? "▼" : "▲"}
            </Text>
          </View>
        </TouchableOpacity>
        
        {/* Collapsible TTS Content */}
        {!isTtsCollapsed && (
          <View style={styles.collapsibleContent}>
            {/* Text Input for TTS */}
            <TextInput
              style={styles.textInput}
              placeholder="Enter text to synthesize"
              value={ttsText}
              onChangeText={setTtsText}
              multiline
              numberOfLines={3}
              placeholderTextColor={Colors.secondary}
            />
            
            {/* TTS Controls */}
            <View style={styles.ttsControls}>
              <TouchableOpacity
                style={[styles.ttsButton, styles.startButton]}
                onPress={handleTtsSynthesis}
                disabled={isTtsProcessing || playbackStatus === "playing"}
              >
                <Text style={styles.buttonText}>Start TTS</Text>
              </TouchableOpacity>
              
              <TouchableOpacity
                style={[styles.ttsButton, styles.stopButton]}
                onPress={handleTtsStop}
                disabled={!isTtsProcessing && playbackStatus !== "playing"}
              >
                <Text style={styles.buttonText}>Stop TTS</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
        
        {/* Status Indicators - Always Visible */}
        <View style={styles.statusIndicators}>
          {/* Audio Status */}
          <View style={styles.statusIndicatorItem}>
            <View style={[styles.statusDot, {
              backgroundColor: isTtsProcessing ? Colors.primary : Colors.secondary
            }]} />
            <Text style={styles.statusLabel}>TTS:</Text>
            <Text style={styles.statusText}>{ttsStatus || "Ready"}</Text>
          </View>
          
          {/* Playback Status */}
          <View style={styles.statusIndicatorItem}>
            <View style={[styles.statusDot, {
              backgroundColor: playbackStatus === "playing" ? Colors.ok : 
                             playbackStatus === "paused" ? Colors.warn : Colors.secondary
            }]} />
            <Text style={styles.statusLabel}>Playback:</Text>
            <Text style={[styles.statusText, {
              color: playbackStatus === "playing" ? Colors.ok : 
                     playbackStatus === "paused" ? Colors.warn : Colors.secondary
            }]}>
              {playbackStatus.charAt(0).toUpperCase() + playbackStatus.slice(1)}
            </Text>
          </View>
        </View>
      </View>
    </View>
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
    padding: 20
  },
  title: {
    fontSize: 24,
    fontWeight: "bold",
    color: Colors.primary,
    marginBottom: 20,
    textAlign: "center",
    flex: 1
  },
  titleWithLanguage: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 20,
    gap: 10
  },
  titlePickerContainer: {
    flex: 1,
    maxWidth: 200
  },
  titleLanguageButton: {
    backgroundColor: Colors.bgInactive,
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 12,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: Colors.primary
  },
  titleLanguageButtonText: {
    color: Colors.primary,
    fontWeight: "bold",
    fontSize: 14
  },
  section: {
    marginBottom: 30,
    backgroundColor: Colors.bgActive,
    borderRadius: 15,
    padding: 20,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3
  },
  controls: {
    marginBottom: 20,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 15
  },
  pickerContainer: {
    flex: 1
  },
  languageButton: {
    backgroundColor: Colors.bgInactive,
    borderRadius: 10,
    padding: 15,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: Colors.primary
  },
  languageButtonText: {
    color: Colors.primary,
    fontWeight: "bold",
    fontSize: 16
  },
  
  // 5. 新增样式：可滑动容器
  scrollContainer: {
    flex: 1,
    backgroundColor: Colors.bgInactive,
    borderRadius: 10,
    overflow: "hidden"
  },
  scrollContent: {
    paddingBottom: 20
  },
  
  // 6. 新增样式：动态结果容器
  dynamicResultContainer: {
    marginBottom: 15,
    backgroundColor: Colors.bgActive,
    borderRadius: 10,
    padding: 15,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
    
    // 确保在不同屏幕尺寸上的良好显示
    maxWidth: "100%",
    alignSelf: "stretch"
  },
  
  // 键(key)样式
  resultKey: {
    fontSize: 14,
    fontWeight: "bold",
    color: Colors.primary,
    marginBottom: 8,
    textTransform: "uppercase",
    letterSpacing: 0.5
  },
  
  // 值(value)容器样式
  resultValueContainer: {
    backgroundColor: Colors.bgInactive,
    borderRadius: 5,
    padding: 12,
    minHeight: 80,
    justifyContent: "center"
  },
  
  // 值(value)文本样式
  resultValue: {
    color: Colors.primary,
    fontSize: 18,
    lineHeight: 26,
    fontWeight: "500",
    
    // 处理超长文本
    flexWrap: "wrap",
    textAlign: "left"
  },
  
  // 自动TTS提示样式
  autoTtsIndicator: {
    marginTop: 8,
    padding: 6,
    backgroundColor: Colors.ok + "30",
    borderRadius: 4,
    alignSelf: "flex-start"
  },
  autoTtsText: {
    color: Colors.ok,
    fontSize: 12,
    fontWeight: "bold"
  },
  
  // 固定结果文本框样式
  resultTextContainer: {
    backgroundColor: Colors.bgActive,
    borderRadius: 10,
    padding: 15,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
    minHeight: 200
  },
  resultTextTitle: {
    fontSize: 16,
    fontWeight: "bold",
    color: Colors.primary,
    marginBottom: 10
  },
  resultTextScroll: {
    maxHeight: 100,
    marginBottom: 10
  },
  resultTextContent: {
    color: Colors.primary,
    fontSize: 18,
    lineHeight: 26,
    fontWeight: "500",
    textAlign: "left"
  },
  
  // 7. 新增样式：空结果状态
  emptyResultsContainer: {
    padding: 40,
    justifyContent: "center",
    alignItems: "center",
    minHeight: 200
  },
  emptyResultsText: {
    color: Colors.secondary,
    fontSize: 16,
    fontStyle: "italic",
    textAlign: "center"
  },
  
  // 加载状态样式保持不变
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: Colors.bgInactive
  },
  loadingText: {
    fontSize: 18,
    color: Colors.primary,
    marginTop: 10
  },
  
  // TTS Section Styles
  textInput: {
    backgroundColor: Colors.bgInactive,
    borderRadius: 10,
    padding: 15,
    marginBottom: 20,
    color: Colors.primary,
    fontSize: 16,
    minHeight: 100,
    textAlignVertical: "top"
  },
  ttsControls: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 20,
    gap: 10
  },
  ttsButton: {
    flex: 1,
    padding: 15,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center"
  },
  asrButton: {
    padding: 15,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    minWidth: 150
  },
  startButton: {
    backgroundColor: Colors.primary
  },
  stopButton: {
    backgroundColor: Colors.low
  },
  playButton: {
    backgroundColor: Colors.ok
  },
  pauseButton: {
    backgroundColor: Colors.warn
  },
  buttonText: {
    color: Colors.bgInactive,
    fontWeight: "bold",
    fontSize: 16
  },
  statusContainer: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 10,
    paddingVertical: 8,
    paddingHorizontal: 15,
    backgroundColor: Colors.bgInactive,
    borderRadius: 8
  },
  statusLabel: {
    fontWeight: "bold",
    color: Colors.primary,
    fontSize: 14
  },
  statusText: {
    color: Colors.secondary,
    fontSize: 14,
    flex: 1,
    textAlign: "right"
  },
  
  // Status Indicators Styles
  statusIndicators: {
    marginBottom: 20,
    padding: 15,
    backgroundColor: Colors.bgInactive,
    borderRadius: 10
  },
  statusIndicatorItem: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 10
  },
  statusDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    marginRight: 10
  },
  
  // Collapsible Section Styles
  collapsibleHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 10,
    paddingHorizontal: 5,
    borderRadius: 10,
    marginBottom: 10
  },
  collapseIconContainer: {
    padding: 5,
    borderRadius: 5
  },
  collapseIcon: {
    color: Colors.primary,
    fontSize: 18,
    fontWeight: "bold"
  },
  collapsibleContent: {
    marginTop: 5,
    paddingTop: 15,
    borderTopWidth: 1,
    borderTopColor: Colors.bgInactive
  },
  
  // Buffer Status Styles
  bufferStatusContainer: {
    marginTop: 20,
    padding: 15,
    backgroundColor: Colors.bgInactive,
    borderRadius: 10
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "bold",
    color: Colors.primary,
    marginBottom: 15,
    textAlign: "center"
  },
  bufferInfoContainer: {
    marginBottom: 15,
    padding: 10,
    backgroundColor: Colors.bgActive,
    borderRadius: 8
  },
  bufferTitle: {
    fontSize: 16,
    fontWeight: "bold",
    color: Colors.primary,
    marginBottom: 8
  },
  bufferDetails: {
    flexDirection: "row",
    justifyContent: "space-between",
    flexWrap: "wrap"
  },
  bufferDetailText: {
    fontSize: 14,
    color: Colors.secondary,
    marginBottom: 4,
    flex: 1,
    textAlign: "center"
  },
  bufferUsageContainer: {
    marginTop: 10
  },
  bufferUsageBar: {
    height: 20,
    backgroundColor: Colors.bgActive,
    borderRadius: 10,
    overflow: "hidden",
    flexDirection: "row"
  },
  bufferUsageFill0: {
    height: "100%",
    backgroundColor: Colors.primary,
    borderTopLeftRadius: 10,
    borderBottomLeftRadius: 10
  },
  bufferUsageFill1: {
    height: "100%",
    backgroundColor: Colors.secondary
  },
  bufferUsageText: {
    fontSize: 14,
    color: Colors.primary,
    textAlign: "center",
    marginTop: 8
  }
})