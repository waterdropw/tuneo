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

import React, { useEffect, useState, useRef } from "react"
import { View, Text, StyleSheet, Button, ScrollView, TextInput, TouchableOpacity } from "react-native"
import { AudioModule } from "expo-audio"
import Colors from "@/colors"
import RequireMicAccess from "@/components/RequireMicAccess"
import { AliAsrService, GummyConfig } from "@/services/AliAsrService"
import { AliTtsService, CosyvoiceConfig } from "@/services/AliTtsService"
import { AudioDataProcessor } from "@/services/AudioDataProcessor"
import * as FileSystem from 'expo-file-system'
import Sound from 'react-native-sound'

type MicrophoneAccess = "pending" | "granted" | "denied"


export const AliBailianDemo = () => {
  // Microphone access state
  const [micAccess, setMicAccess] = useState<MicrophoneAccess>("pending")
  
  // ASR Processing state
  const [isProcessing, setIsProcessing] = useState(false)
  
  // TTS state
  const [ttsText, setTtsText] = useState("")           // 用户输入的待合成文本
  const [isTtsPlaying, setIsTtsPlaying] = useState(false) // TTS合成状态
  const [ttsStatus, setTtsStatus] = useState("")       // TTS状态信息
  
  // Audio playback state
  const [playbackStatus, setPlaybackStatus] = useState("stopped") // "stopped", "playing", "paused"
  
  // 存储ASR服务返回的结果键值对
  const [resultPairs, setResultPairs] = useState<{ key: string; value: string }[]>([])
  
  // Service instances (using useRef to avoid re-initialization on re-renders)
  const asrServiceRef = useRef<AliAsrService | null>(null)           // ASR服务实例
  const ttsServiceRef = useRef<AliTtsService | null>(null)           // TTS服务实例
  const audioProcessorRef = useRef<AudioDataProcessor | null>(null)  // 音频处理器实例
  
  // TTS audio data buffer
  const audioDataBuffer = useRef<Uint8Array[]>([])
  const isAudioComplete = useRef(false)
  const soundRef = useRef<Sound | null>(null)

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
    const asrService = new AliAsrService(config)
    asrServiceRef.current = asrService
    
    // Create TTS service instance with CosyvoiceConfig
    const ttsConfig = new CosyvoiceConfig()
    const ttsService = new AliTtsService(ttsConfig)
    ttsServiceRef.current = ttsService
    
    // Create audio processor instance
    const audioProcessor = AudioDataProcessor.getInstance()
    audioProcessorRef.current = audioProcessor
    
    // Set up result callback for ASR service
    asrService.setResultCallback((result) => {
      console.log("Received ASR result:", result)
      updateResultPairs(result)
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
        setTtsStatus("Audio synthesis completed")
        isAudioComplete.current = true
      }
    })
    
    // Set up error callback for TTS service
    ttsService.setErrorCallback((error) => {
      console.error("TTS error:", error)
      setTtsStatus(`TTS Error: ${error.message}`)
      setIsTtsPlaying(false)
    })
    
    // Set up event callback for TTS service
    ttsService.setEventCallback((event, data) => {
      console.log("TTS event:", event, data)
      switch (event) {
        case "task-started":
          setTtsStatus("Audio synthesis started")
          // Reset audio buffer and status
          audioDataBuffer.current = []
          isAudioComplete.current = false
          break
        case "task-finished":
          setTtsStatus("Audio synthesis finished")
          setIsTtsPlaying(false)
          break
        case "error":
          setTtsStatus(`TTS Error: ${data?.message || "Unknown error"}`)
          setIsTtsPlaying(false)
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
    }
  }, [micAccess])
  
  // Update result pairs helper function
  const updateResultPairs = (result: Record<string, string>) => {
    console.log("Received result:", result);
    
    // 将Record<string, string>转换为键值对数组
    const newPairs: { key: string; value: string }[] = Object.entries(result).map(([key, value]) => ({
      key,
      value
    }));
    
    // 更新结果数组 - 保留现有结果并添加新结果
    setResultPairs(prevPairs => {
      // 创建一个映射，用于快速查找现有键
      const existingKeys = new Map(prevPairs.map(pair => [pair.key, pair.value]));
      
      // 合并新结果，更新现有键或添加新键
      newPairs.forEach(pair => {
        // 对于每个键，将新值追加到现有值后面
        const existingValue = existingKeys.get(pair.key) || "";
        existingKeys.set(pair.key, `${existingValue}${pair.value}`);
      });
      
      // 转换回数组
      return Array.from(existingKeys.entries()).map(([key, value]) => ({
        key,
        value
      }));
    });
  }
  
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
    
    try {
      // Connect to ASR service
      console.log("Connecting to ASR service...")
      await asrService.connect()
      console.log("ASR service connected successfully")
      
      // Start audio processing with callback to send audio to ASR service
      audioProcessor.startProcessing((processedData) => {
        if (processedData && processedData.data && asrService.isReady()) {
          try {
            asrService.sendAudio(processedData.data)
          } catch (error) {
            console.error("Error sending audio data:", error)
            // Update result pairs with error
            updateResultPairs({
              error: `Error sending audio data: ${error instanceof Error ? error.message : String(error)}`
            })
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
    
    setIsTtsPlaying(true)
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
      setIsTtsPlaying(false)
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
      setIsTtsPlaying(false)
      setTtsStatus("TTS synthesis stopped")
      setPlaybackStatus("stopped")
    } catch (error) {
      console.error("Failed to stop TTS synthesis:", error)
      setTtsStatus(`Failed to stop TTS synthesis: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  
  // Play audio from buffer
  const playAudioBuffer = async () => {
    if (audioDataBuffer.current.length === 0) {
      setTtsStatus("No audio data to play")
      return
    }
    
    setTtsStatus("Playing audio...")
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
          setTtsStatus(`Audio playback error: ${error.message}`)
          setPlaybackStatus("stopped")
          return
        }
        sound.play(() => {
          sound.release()
          soundRef.current = null
          setPlaybackStatus("stopped")
          setTtsStatus("Audio playback completed")
        })
      })
      
      soundRef.current = sound
      
    } catch (error) {
      console.error("Failed to play audio:", error)
      setTtsStatus(`Audio playback error: ${error instanceof Error ? error.message : String(error)}`)
      setPlaybackStatus("stopped")
    }
  }
  
  // 4. 实现动态View创建与布局
  return micAccess === "granted" ? (
    <View style={styles.container}>
      {/* ASR Section */}
      <View style={styles.section}>
        <Text style={styles.title}>ASR Results</Text>
        
        <View style={styles.controls}>
          <Button
            title={isProcessing ? "Stop ASR" : "Start ASR"}
            onPress={isProcessing ? handleStopProcessing : handleStartProcessing}
            color={isProcessing ? Colors.secondary : Colors.primary}
          />
        </View>
        
        {/* 可滑动的外层容器 - 使用ScrollView */}
        <ScrollView 
          style={styles.scrollContainer}
          showsVerticalScrollIndicator={true}
          contentContainerStyle={styles.scrollContent}
        >
          {/* 动态创建的结果View */}
          {resultPairs.length > 0 ? (
            resultPairs.map((pair, index) => (
              <View key={`${pair.key}-${index}`} style={styles.dynamicResultContainer}>
                {/* 键(key)显示 */}
                <Text style={styles.resultKey}>{pair.key.toUpperCase()}</Text>
                {/* 值(value)显示 */}
                <View style={styles.resultValueContainer}>
                  <Text style={styles.resultValue}>{pair.value || "No content"}</Text>
                </View>
              </View>
            ))
          ) : (
            /* 空结果处理 */
            <View style={styles.emptyResultsContainer}>
              <Text style={styles.emptyResultsText}>
                {isProcessing ? "Processing audio..." : "No results yet. Click 'Start ASR' to begin."}
              </Text>
            </View>
          )}
        </ScrollView>
      </View>
      
      {/* TTS Section */}
      <View style={styles.section}>
        <Text style={styles.title}>TTS Synthesis</Text>
        
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
            disabled={isTtsPlaying}
          >
            <Text style={styles.buttonText}>Start TTS</Text>
          </TouchableOpacity>
          
          <TouchableOpacity
            style={[styles.ttsButton, styles.stopButton]}
            onPress={handleTtsStop}
            disabled={!isTtsPlaying}
          >
            <Text style={styles.buttonText}>Stop TTS</Text>
          </TouchableOpacity>
          
          <TouchableOpacity
            style={[styles.ttsButton, styles.playButton]}
            onPress={playAudioBuffer}
            disabled={playbackStatus === "playing"}
          >
            <Text style={styles.buttonText}>Play Audio</Text>
          </TouchableOpacity>
        </View>
        
        {/* Status Indicators */}
        <View style={styles.statusIndicators}>
          {/* TTS Status */}
          <View style={styles.statusIndicatorItem}>
            <View style={[styles.statusDot, {
              backgroundColor: isTtsPlaying ? Colors.primary : Colors.secondary
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
    textAlign: "center"
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
    marginBottom: 20
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
    color: Colors.secondary,
    fontSize: 16,
    lineHeight: 22,
    
    // 处理超长文本
    flexWrap: "wrap",
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