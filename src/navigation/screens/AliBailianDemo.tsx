/**
 * AliBailianDemo 组件
 * 演示阿里云语音识别(ASR)和文本转语音(TTS)功能的集成
 * 功能：
 * 1. 实时语音识别（ASR）：通过麦克风输入，将语音转换为文本
 * 2. 文本转语音（TTS）：将用户输入的文本转换为语音播放
 * 
 * 重构亮点：
 * 1. 集成了阿里云TTS服务，实现文本到语音的转换
 * 2. 采用双音频文件架构，分离音频读取与写入操作
 * 3. 实现双缓冲技术，确保音频数据处理的流畅性和连续性
 * 4. 设计了合理的缓冲管理策略，避免音频播放卡顿或延迟
 * 5. 实现了完整的音频播放控制逻辑和状态管理
 * 6. 引入了双缓冲区状态显示，实时展示当前音频处理状态
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
import { AliTtsService, CosyvoiceConfig, YinseOptions } from "@/services/AliTtsService"
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
  
  
  // 存储ASR服务返回的结果键值对
  const [resultPairs, setResultPairs] = useState<{ key: string; value: string }[]>([])
  // 存储最新的ASR识别文本，用于自动TTS
  const [latestAsrText, setLatestAsrText] = useState("")
  // 存储已处理的结果对哈希，避免重复触发TTS
  const [processedResultHash, setProcessedResultHash] = useState("")
  
  // 翻译目标语言状态
  const [targetLanguage, setTargetLanguage] = useState<string>("en")
  // TTS音色状态
  const [voice, setVoice] = useState<string>("loongcindy_v2")

  
  // 支持的翻译语言列表
  const languageOptions: MenuAction[] = Object.entries(LanguageOptions).map(([id, title]) => ({
    id,
    title: `${title} (${id})`
  }))
  // 支持的音色列表（动态计算，根据语言过滤）
  const [yinseOptions, setYinseOptions] = useState<MenuAction[]>(() => {
    // 初始加载时，根据默认的targetLanguage生成音色选项
    const initialTargetLangs = ["en"]; // 默认目标语言是英语
    return Object.entries(YinseOptions)
      .filter(([id, info]) => {
        return initialTargetLangs.some(targetLang => info.langs.includes(targetLang));
      })
      .map(([id, info]) => ({
        id,
        title: `${info.name} (${info.attr})`
      }));
  })
  
  // 根据targetLanguage过滤音色选项
  useEffect(() => {
    // 构建目标语言列表，包括目标语言和方言
    const targetLangs = [targetLanguage];
    
    // 过滤音色，只保留支持目标语言或方言的音色
    const filteredYinseOptions = Object.entries(YinseOptions)
      .filter(([id, info]) => {
        // 检查音色的langs数组是否包含任何目标语言
        return targetLangs.some(targetLang => info.langs.includes(targetLang));
      })
      .map(([id, info]) => ({
        id,
        title: `${info.name} (${info.attr})`
      }));
    
    setYinseOptions(filteredYinseOptions);
    
    // 如果当前选中的voice不在过滤后的列表中，自动选择第一个可用音色
    if (filteredYinseOptions.length > 0) {
      const voiceExists = filteredYinseOptions.some(option => option.id === voice);
      if (!voiceExists) {
        setVoice(filteredYinseOptions[0].id);
      }
    }
  }, [targetLanguage])
  
  // ScrollView ref for auto-scrolling to latest results
  const scrollViewRef = useRef<ScrollView>(null)

  // Auto scroll to bottom when latestAsrText updates
  useEffect(() => {
    // 使用 setTimeout 确保在 DOM 更新后执行滚动
    const timer = setTimeout(() => {
      scrollViewRef.current?.scrollToEnd({ animated: true })
    }, 100)

    return () => clearTimeout(timer)
  }, [latestAsrText])
  
  // Service instances (using useRef to avoid re-initialization on re-renders)
  const asrServiceRef = useRef<AliAsrService | null>(null)           // ASR服务实例
  const ttsServiceRef = useRef<AliTtsService | null>(null)           // TTS服务实例
  const audioProcessorRef = useRef<AudioSource | null>(null)         // 音频处理器实例
  
  // TTS audio data buffer
  const audioDataBuffer = useRef<Uint8Array[]>([])
  const isAudioComplete = useRef(false)
  const soundRef = useRef<Sound | null>(null)
  const isPlaying = useRef(false)
  
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
      console.log("[playAudioBuffer] No audio data to play")
      setPlaybackStatus("stopped")
      return
    }
    
    console.log(`[playAudioBuffer] Starting playback with ${audioDataBuffer.current.length} chunks`)
    setPlaybackStatus("playing")
    isPlaying.current = true
    
    try {
      // Combine audio data chunks
      const totalLength = audioDataBuffer.current.reduce((acc, chunk) => acc + chunk.byteLength, 0)
      const combinedBuffer = new Uint8Array(totalLength)
      let offset = 0
      for (const chunk of audioDataBuffer.current) {
        combinedBuffer.set(chunk, offset)
        offset += chunk.byteLength
      }
      
      console.log(`[playAudioBuffer] Combined buffer size: ${combinedBuffer.byteLength} bytes`)
      
      // Convert Uint8Array to base64 string
      const base64Data = btoa(String.fromCharCode(...combinedBuffer))
      
      // Write to temporary file with unique name to avoid conflicts
      const timestamp = Date.now()
      const path = `${FileSystem.cacheDirectory}temp_audio_${timestamp}.mp3`
      
      await FileSystem.writeAsStringAsync(path, base64Data, {
        encoding: FileSystem.EncodingType.Base64
      })
      
      console.log(`[playAudioBuffer] Audio file written to: ${path}`)
      
      // If sound is already playing, stop it first
      if (soundRef.current) {
        console.log("[playAudioBuffer] Stopping previous playback")
        soundRef.current.stop()
        soundRef.current.release()
        soundRef.current = null
      }
      
      // 清空缓冲区，避免下次播放时重复
      audioDataBuffer.current = []
      console.log("[playAudioBuffer] Audio buffer cleared after playback")
      
      // Play the file
      const sound = new Sound(path, undefined, (error) => {
        if (error) {
          console.error('[playAudioBuffer] Failed to load audio:', error)
          setIsTtsProcessing(false)
          setPlaybackStatus("stopped")
          isPlaying.current = false
          // 清理失败的临时文件
          FileSystem.deleteAsync(path, { idempotent: true }).catch(console.error)
          return
        }
        console.log("[playAudioBuffer] Audio loaded successfully, starting playback")
        sound.play((success) => {
          console.log(`[playAudioBuffer] Playback finished, success: ${success}`)
          sound.release()
          soundRef.current = null
          setPlaybackStatus("stopped")
          setIsTtsProcessing(false)
          isPlaying.current = false
          
          // 清理播放完成的临时文件
          FileSystem.deleteAsync(path, { idempotent: true }).catch(console.error)
        })
      })
      
      soundRef.current = sound
      
    } catch (error) {
      console.error("[playAudioBuffer] Failed to play audio:", error)
      setPlaybackStatus("stopped")
      isPlaying.current = false
      setIsTtsProcessing(false)
      // 清空缓冲区以避免下次尝试播放损坏的数据
      audioDataBuffer.current = []
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
    
    // Update TTS service configuration instead of creating a new instance
    const oldTtsService = ttsServiceRef.current;
    if (oldTtsService) {
      // 关闭旧的TTS服务连接
      try {
        oldTtsService.close();
      } catch (error) {
        console.error("Error closing old TTS service:", error);
      }
      ttsServiceRef.current = null;
    }
    
    // Create new TTS service instance with updated configuration
    const ttsConfig = new CosyvoiceConfig()
    ttsConfig.parameters.language_hints = [targetLanguage]
    ttsConfig.parameters.voice = voice
    if (targetLanguage !== "en") {
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
      // console.log("Received TTS audio data:", metadata)
      
      if (metadata?.isFinal) {
        // Audio stream ended
        console.log(`[TTS Audio Callback] Audio stream ended. Buffer has ${audioDataBuffer.current.length} chunks`)
        isAudioComplete.current = true
        // Auto play audio when synthesis is finished
        playAudioBuffer()
      } else if (audioData) {
        // Convert ArrayBuffer to Uint8Array and add to buffer
        const chunk = new Uint8Array(audioData)
        audioDataBuffer.current.push(chunk)
        console.log(`[TTS Audio Callback] Received chunk ${audioDataBuffer.current.length}, size: ${chunk.byteLength} bytes`)
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
      console.log("[TTS Event]", event, data)
      switch (event) {
        case "task-started":
          setIsTtsProcessing(true)
          setTtsStatus("TTS synthesis started")
          // 停止当前播放的音频（如果有）
          if (soundRef.current) {
            console.log("[TTS Event] Stopping previous playback before new synthesis")
            soundRef.current.stop()
            soundRef.current.release()
            soundRef.current = null
          }
          // Reset audio buffer and status - 确保在开始合成时清空缓冲区
          console.log(`[TTS Event] Clearing buffer (had ${audioDataBuffer.current.length} chunks) for new synthesis`)
          audioDataBuffer.current = []
          isAudioComplete.current = false
          setPlaybackStatus("stopped")
          break
        case "task-finished":
          setTtsStatus("TTS synthesis finished")
          // 注意：不在这里设置 setIsTtsProcessing(false)，因为可能还在播放中
          // 播放完成后会自动设置为 false
          console.log("[TTS Event] Synthesis finished, waiting for playback to complete")
          break
        case "timeout":
          console.warn("[TTS Event] TTS timeout detected, connection closed automatically")
          setTtsStatus(`TTS Timeout: ${data?.message || "No audio data received"}`)
          setIsTtsProcessing(false)
          // 清空缓冲区
          audioDataBuffer.current = []
          isAudioComplete.current = false
          setPlaybackStatus("stopped")
          // 停止播放
          if (soundRef.current) {
            soundRef.current.stop()
            soundRef.current.release()
            soundRef.current = null
          }
          break
        case "error":
          setTtsStatus(`TTS Error: ${data?.message || "Unknown error"}`)
          setIsTtsProcessing(false)
          // 清空缓冲区
          audioDataBuffer.current = []
          isAudioComplete.current = false
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
        // Ensure we close the task and connection if they're still open
        try {
          // First try to stop the task if it's running
          if (asrServiceRef.current.isReady()) {
            asrServiceRef.current.stop().catch(console.error)
          }
          // Then close the WebSocket connection
          asrServiceRef.current.disconnect()
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
  }, [micAccess, targetLanguage, voice, playAudioBuffer, updateResultPairs])
  
  // Auto trigger TTS when ASR result is updated
  useEffect(() => {
    const triggerTTS = async () => {
      const ttsService = ttsServiceRef.current;
      if (!ttsService) {
        console.error("[Auto TTS] TTS service not initialized");
        return;
      }
      if (!resultPairs.length || resultPairs.length < 2) {
        // console.log("[Auto TTS] No sufficient ASR result to synthesize");
        return;
      }
      
      // Generate a hash of the result pairs to check if we've already processed this result
      const resultHash = JSON.stringify(resultPairs);
      
      // Check if we've already processed this result
      if (resultHash === processedResultHash) {
        console.log("[Auto TTS] Skipping duplicate TTS trigger for the same result");
        return; // 修复：实际跳过重复触发
      }
      
      console.log("[Auto TTS] Triggering TTS synthesis for new ASR result");
      setIsTtsProcessing(true)
      setTtsStatus("Connecting to TTS service...");
      
      try {
        // Connect to TTS service (open WebSocket connection)
        await ttsService.connect();
        console.log("[Auto TTS] TTS service connected successfully");
        
        // Start TTS task (send run-task message)
        await ttsService.start();
        console.log("[Auto TTS] TTS task started successfully");
        
        // Send resultPairs[1] text for synthesis, if empty send resultPairs[0]
        const textToSynthesize = resultPairs[1].value.trim();
        ttsService.sendText(textToSynthesize, true);
        console.log("[Auto TTS] Text sent for synthesis:", textToSynthesize);
        
        // Update the processed hash to avoid duplicate triggers
        setProcessedResultHash(resultHash);
      } catch (error) {
        console.error("[Auto TTS] Failed to trigger TTS synthesis:", error);
        setTtsStatus(`Failed to auto-trigger TTS: ${error instanceof Error ? error.message : String(error)}`);
        setIsTtsProcessing(false)
        // 清空缓冲区以避免播放损坏的数据
        audioDataBuffer.current = []
        isAudioComplete.current = false
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
      // Connect to ASR service (open WebSocket connection)
      console.log("Connecting to ASR service...")
      await asrService.connect()
      console.log("ASR service connected successfully")
      
      // Start ASR task (send run-task message)
      console.log("Starting ASR task...")
      await asrService.start()
      console.log("ASR task started successfully")
      
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
      
      // Then stop ASR task
      if (asrService.isReady()) {
        await asrService.stop()
        console.log("ASR task stopped")
      }
      
      // Finally close the WebSocket connection
      asrService.disconnect()
      console.log("ASR connection closed")
      
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
      console.error("[Manual TTS] TTS service not initialized")
      return
    }
    
    if (!ttsText.trim()) {
      setTtsStatus("Please enter text to synthesize")
      return
    }
    
    console.log("[Manual TTS] Starting TTS synthesis")
    setIsTtsProcessing(true)
    setTtsStatus("Connecting to TTS service...")
    
    try {
      // Connect to TTS service (open WebSocket connection)
      await ttsService.connect()
      console.log("[Manual TTS] TTS service connected successfully")
      
      // Start TTS task (send run-task message)
      await ttsService.start()
      console.log("[Manual TTS] TTS task started successfully")
      
      // Send text for synthesis
      ttsService.sendText(ttsText, true)
      console.log("[Manual TTS] Text sent for synthesis:", ttsText)
      
    } catch (error) {
      console.error("[Manual TTS] Failed to start TTS synthesis:", error)
      setTtsStatus(`Failed to start TTS synthesis: ${error instanceof Error ? error.message : String(error)}`)
      setIsTtsProcessing(false)
      // 清空缓冲区以避免播放损坏的数据
      audioDataBuffer.current = []
      isAudioComplete.current = false
    }
  }
  
  // Handle TTS stop
  const handleTtsStop = async () => {
    const ttsService = ttsServiceRef.current
    
    if (!ttsService) return
    
    console.log("[TTS Stop] Stopping TTS synthesis and playback")
    
    try {
      // Stop playback first if active
      if (soundRef.current) {
        console.log("[TTS Stop] Stopping audio playback")
        soundRef.current.stop()
        soundRef.current.release()
        soundRef.current = null
      }
      
      // Then stop TTS task if it's running
      if (ttsService.isReady()) {
        await ttsService.stop()
        console.log("[TTS Stop] TTS task stopped")
      }
      
      // Finally close the WebSocket connection
      ttsService.disconnect()
      console.log("[TTS Stop] TTS connection closed")
      
      // Clear audio buffer
      console.log(`[TTS Stop] Clearing audio buffer (had ${audioDataBuffer.current.length} chunks)`)
      audioDataBuffer.current = []
      isAudioComplete.current = false
      
      setIsTtsProcessing(false)
      setTtsStatus("TTS synthesis stopped")
      setPlaybackStatus("stopped")
      console.log("[TTS Stop] TTS stopped successfully")
    } catch (error) {
      console.error("[TTS Stop] Failed to stop TTS synthesis:", error)
      setTtsStatus(`Failed to stop TTS synthesis: ${error instanceof Error ? error.message : String(error)}`)
      setIsTtsProcessing(false)
      // 即使失败也清空缓冲区
      audioDataBuffer.current = []
      isAudioComplete.current = false
      setPlaybackStatus("stopped")
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
              disabled={isProcessing}
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
            ref={scrollViewRef}
            style={styles.resultTextScroll} 
            showsVerticalScrollIndicator={true}
            // 自动滚动到底部，显示最新结果
            onContentSizeChange={(width, height) => {
              scrollViewRef.current?.scrollToEnd({ animated: true })
            }}
            // 当最新ASR文本更新时也滚动到底部
            onLayout={() => {
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
        <View style={styles.collapsibleHeader}>
          <View style={styles.titleWithLanguage}>
            <Text style={styles.title}>TTS</Text>
            
            {/* TTS Voice Selection */}
            <View style={styles.titlePickerContainer}>
              <Picker
                actions={yinseOptions}
                onSelect={(v) => setVoice(v)}
                value={voice}
                disabled={isProcessing}
              >
                <TouchableOpacity style={styles.titleLanguageButton}>
                  <Text style={styles.titleLanguageButtonText}>
                    {yinseOptions.find(v => v.id === voice)?.title || voice}
                  </Text>
                </TouchableOpacity>
              </Picker>
            </View>
          </View>
          
          {/* Collapse/Expand Icon - Only this area will trigger collapse/expand */}
          <TouchableOpacity 
            style={styles.collapseIconContainer}
            onPress={() => setIsTtsCollapsed(!isTtsCollapsed)}
          >
            <Text style={styles.collapseIcon}>
              {isTtsCollapsed ? "▼" : "▲"}
            </Text>
          </TouchableOpacity>
        </View>
        
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
    minHeight: 100
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