/**
 * AudioProcessingPipelineService 类
 * 端到端实时音频处理链路
 * 1. 音频采集 -> 2. 语音识别与翻译 -> 3. 文本转语音 -> 4. 音频播放
 */

import { AliAsrService, GummyConfig } from "./AliAsrService";
import { AliTtsService, CosyvoiceConfig } from "./AliTtsService";
import { AudioService } from "./AudioService";

// 定义流水线状态
export type PipelineState = "idle" | "running" | "error";

// 定义流水线事件类型
export type PipelineEventType = 
  | "onPipelineStart" 
  | "onPipelineStop" 
  | "onPipelineError" 
  | "onAsrResult" 
  | "onTranslationResult" 
  | "onTtsResult" 
  | "onAudioPlayback";

// 定义流水线事件回调
export type PipelineEventCallback = (
  data?: any, 
  error?: Error
) => void;

// 定义流水线配置
export interface PipelineConfig {
  // ASR 配置
  asrConfig?: GummyConfig;
  // TTS 配置
  ttsConfig?: CosyvoiceConfig;
  // 语言配置
  sourceLanguage?: string;
  targetLanguage?: string;
  // 音频配置
  sampleRate?: number;
  format?: string;
  // 延迟控制
  enableLowLatency?: boolean;
}

/**
 * 音频处理流水线服务
 * 负责协调各个服务组件，实现端到端的音频处理链路
 */
export class AudioProcessingPipelineService {
  // 单例实例
  private static instance: AudioProcessingPipelineService;
  
  // 流水线状态
  private state: PipelineState = "idle";
  
  // 配置信息
  private config: PipelineConfig;
  
  // 服务组件
  private asrService: AliAsrService;
  private ttsService: AliTtsService;
  private audioService: AudioService;
  
  // 事件监听器
  private eventListeners: Map<PipelineEventType, Set<PipelineEventCallback>> = new Map();
  
  // 音频缓冲区ID，用于同步
  private bufferId: number = 0;
  
  // 单例模式：私有构造函数
  private constructor(config: PipelineConfig) {
    this.config = {
      // 默认配置
      sourceLanguage: "zh",
      targetLanguage: "en",
      sampleRate: 16000,
      format: "pcm",
      enableLowLatency: true,
      // 合并用户配置
      ...config
    };
    
    // 初始化ASR服务
    this.asrService = new AliAsrService(
      this.config.asrConfig || new GummyConfig()
    );
    
    // 初始化TTS服务
    this.ttsService = new AliTtsService(
      this.config.ttsConfig || new CosyvoiceConfig()
    );
    
    // 初始化音频服务
    this.audioService = AudioService.getInstance();
    
    // 设置服务间的连接
    this.setupServiceConnections();
  }
  
  // 单例模式：获取实例
  public static getInstance(config: PipelineConfig = {}): AudioProcessingPipelineService {
    if (!AudioProcessingPipelineService.instance) {
      AudioProcessingPipelineService.instance = new AudioProcessingPipelineService(config);
    }
    return AudioProcessingPipelineService.instance;
  }
  
  // 设置服务间的连接
  private setupServiceConnections(): void {
    // 1. ASR结果处理
    this.asrService.setResultCallback((result: Record<string, string>) => {
      console.log("ASR Result:", result);
      this.emitEvent("onAsrResult", result);
      
      // 提取翻译结果
      const asrText = result.asr || "";
      const translationText = result[this.config.targetLanguage || "en"] || "";
      
      if (translationText) {
        this.emitEvent("onTranslationResult", {
          asr: asrText,
          translation: translationText,
          language: this.config.targetLanguage || "en"
        });
        
        // 2. 将翻译结果发送到TTS服务
        this.sendToTts(translationText);
      }
    });
    
    // 3. TTS音频处理
    this.ttsService.setAudioCallback((audioData, metadata) => {
      if (audioData) {
        this.emitEvent("onTtsResult", {
          audioData,
          metadata
        });
        
        // 4. 将TTS音频发送到AudioService进行播放
        this.audioService.addAudioData(audioData).catch(error => {
          this.handleError(error instanceof Error ? error : new Error(String(error)), "Failed to add audio data to player");
        });
        this.emitEvent("onAudioPlayback", {
          bufferSize: audioData.byteLength,
          isFinal: metadata?.isFinal || false
        });
      }
    });
    
    // 错误处理
    this.asrService.setErrorCallback((error) => {
      this.handleError(error, "ASR Service Error");
    });
    
    this.ttsService.setErrorCallback((error) => {
      this.handleError(error, "TTS Service Error");
    });
  }
  
  // 开始流水线
  public async startPipeline(): Promise<void> {
    if (this.state === "running") return;
    
    try {
      this.state = "running";
      
      // 初始化各个服务
      await Promise.all([
        // 1. 连接ASR服务
        this.asrService.connect(),
        // 2. 连接TTS服务
        this.ttsService.connect(),
        // 3. 启动音频服务播放功能
        this.audioService.start()
      ]);
      
      // 4. 开始麦克风录音，将音频数据发送到ASR服务
      await this.audioService.startRecording(async (event) => {
        if (event && event.audioData) {
          try {
            // 将录制的音频数据发送到ASR服务
            await this.asrService.sendAudio(event.audioData);
          } catch (error) {
            this.handleError(error instanceof Error ? error : new Error(String(error)), "Failed to send audio to ASR service");
          }
        }
      });
      
      this.emitEvent("onPipelineStart");
      console.log("Audio processing pipeline started");
    } catch (error) {
      this.state = "error";
      this.handleError(error instanceof Error ? error : new Error(String(error)), "Failed to start pipeline");
    }
  }
  
  // 停止流水线
  public async stopPipeline(): Promise<void> {
    if (this.state === "idle") return;
    
    try {
      // 停止各个服务
      await this.audioService.stopRecording();
      await this.audioService.stop();
      await this.asrService.stop();
      await this.ttsService.stop();
      
      this.state = "idle";
      this.emitEvent("onPipelineStop");
      console.log("Audio processing pipeline stopped");
    } catch (error) {
      this.handleError(error instanceof Error ? error : new Error(String(error)), "Failed to stop pipeline");
    }
  }
  
  // 发送文本到TTS服务
  private sendToTts(text: string): void {
    try {
      this.ttsService.sendText(text, false);
    } catch (error) {
      this.handleError(error instanceof Error ? error : new Error(String(error)), "Failed to send text to TTS service");
    }
  }
  
  // 获取流水线状态
  public getState(): PipelineState {
    return this.state;
  }
  
  // 获取配置
  public getConfig(): PipelineConfig {
    return this.config;
  }
  
  // 更新配置
  public updateConfig(config: Partial<PipelineConfig>): void {
    this.config = {
      ...this.config,
      ...config
    };
  }
  
  // 事件管理
  public addEventListener(
    eventType: PipelineEventType,
    callback: PipelineEventCallback
  ): void {
    if (!this.eventListeners.has(eventType)) {
      this.eventListeners.set(eventType, new Set());
    }
    this.eventListeners.get(eventType)!.add(callback);
  }
  
  public removeEventListener(
    eventType: PipelineEventType,
    callback: PipelineEventCallback
  ): void {
    if (this.eventListeners.has(eventType)) {
      this.eventListeners.get(eventType)!.delete(callback);
      if (this.eventListeners.get(eventType)!.size === 0) {
        this.eventListeners.delete(eventType);
      }
    }
  }
  
  public removeAllListeners(eventType?: PipelineEventType): void {
    if (eventType) {
      this.eventListeners.delete(eventType);
    } else {
      this.eventListeners.clear();
    }
  }
  
  private emitEvent(
    eventType: PipelineEventType,
    data?: any,
    error?: Error
  ): void {
    if (this.eventListeners.has(eventType)) {
      const listeners = this.eventListeners.get(eventType)!;
      const listenersCopy = new Set(listeners);
      listenersCopy.forEach(callback => {
        try {
          callback(data, error);
        } catch (callbackError) {
          console.error(`Error in ${eventType} listener:`, callbackError);
        }
      });
    }
  }
  
  // 错误处理
  private handleError(error: Error, context: string): void {
    console.error(`${context}:`, error);
    this.state = "error";
    this.emitEvent("onPipelineError", undefined, error);
  }
  
  // 清理资源
  public async cleanup(): Promise<void> {
    this.removeAllListeners();
    await this.stopPipeline();
    
    // 清理各个服务
    await this.audioService.cleanup();
    this.asrService.close();
    this.ttsService.close();
    
    console.log("Audio processing pipeline cleaned up");
  }
}
