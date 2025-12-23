import React, { useEffect, useState } from "react"
import { View, Text, StyleSheet, Button, ScrollView } from "react-native"
import { AudioModule } from "expo-audio"
import Colors from "@/colors"
import RequireMicAccess from "@/components/RequireMicAccess"
import { useTranslation } from "@/configHooks"
import { 
  AudioProcessingPipelineService, 
  PipelineState,
  PipelineEventType
} from "@/services/AudioProcessingPipelineService"

type MicrophoneAccess = "pending" | "granted" | "denied"

export const AliBailianDemo = () => {
  const t = useTranslation()
  
  // Microphone access state
  const [micAccess, setMicAccess] = useState<MicrophoneAccess>("pending")
  
  // Processing state
  const [isProcessing, setIsProcessing] = useState(false)
  const [pipelineState, setPipelineState] = useState<PipelineState>("idle")
  
  // 1. 使用动态结果数组替代固定结果状态
  // 存储resultCallback返回的所有键值对
  const [resultPairs, setResultPairs] = useState<Array<{ key: string; value: string }>>([])
  
  // Pipeline service instance
  const [pipeline, setPipeline] = useState<AudioProcessingPipelineService | null>(null)

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
  
  // Initialize pipeline service
  useEffect(() => {
    if (micAccess !== "granted") return
    
    // Create pipeline instance
    const audioPipeline = AudioProcessingPipelineService.getInstance({
      enableLowLatency: true,
      sourceLanguage: "zh",
      targetLanguage: "en"
    })
    setPipeline(audioPipeline)
    
    // Set up event listeners for pipeline events
    const handleAsrResult = (data: any) => {
      if (data && typeof data === 'object') {
        updateResultPairs(data)
      }
    }
    
    const handleTranslationResult = (data: any) => {
      if (data && data.translation) {
        updateResultPairs({
          translation: data.translation,
          language: data.language
        })
      }
    }
    
    const handleTtsResult = (data: any) => {
      if (data && data.metadata) {
        updateResultPairs({
          tts: "Audio generated",
          tts_metadata: JSON.stringify(data.metadata)
        })
      }
    }
    
    const handlePipelineError = (data: any, error?: Error) => {
      if (error) {
        console.error("Pipeline error:", error)
        updateResultPairs({
          error: error.message
        })
      }
    }
    
    // Add event listeners
    audioPipeline.addEventListener("onAsrResult", handleAsrResult)
    audioPipeline.addEventListener("onTranslationResult", handleTranslationResult)
    audioPipeline.addEventListener("onTtsResult", handleTtsResult)
    audioPipeline.addEventListener("onPipelineError", handlePipelineError)
    
    return () => {
      // Cleanup
      console.log("Cleaning up pipeline")
      audioPipeline.removeAllListeners()
      audioPipeline.cleanup()
    }
  }, [micAccess])
  
  // Update result pairs helper function
  const updateResultPairs = (result: Record<string, string>) => {
    console.log("Received result:", result);
    
    // 将Record<string, string>转换为键值对数组
    const newPairs: Array<{ key: string; value: string }> = Object.entries(result).map(([key, value]) => ({
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
    if (!pipeline) {
      console.error("Pipeline not initialized")
      return
    }
    
    setIsProcessing(true)
    // 重置动态结果数组
    setResultPairs([])
    
    try {
      // Start the pipeline
      console.log("Starting audio processing pipeline...")
      await pipeline.startPipeline()
      setPipelineState(pipeline.getState())
      console.log("Audio processing pipeline started successfully")
    } catch (error) {
      console.error("Failed to start pipeline:", error)
      setIsProcessing(false)
      setPipelineState("error")
    }
  }
  
  // Stop processing
  const handleStopProcessing = async () => {
    if (!pipeline) return
    
    console.log("Stopping processing")
    setIsProcessing(false)
    
    try {
      // Stop the pipeline
      await pipeline.stopPipeline()
      setPipelineState(pipeline.getState())
    } catch (error) {
      console.error("Failed to stop pipeline:", error)
      setPipelineState("error")
    }
  }
  
  // 4. 实现动态View创建与布局
  return micAccess === "granted" ? (
    <View style={styles.container}>
      <Text style={styles.title}>识别及翻译内容</Text>
      
      <View style={styles.controls}>
        <Button
          title={isProcessing ? "Stop Processing" : "Start Processing"}
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
              {isProcessing ? "Processing audio..." : "No results yet. Click 'Start Processing' to begin."}
            </Text>
          </View>
        )}
      </ScrollView>
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
  }
})