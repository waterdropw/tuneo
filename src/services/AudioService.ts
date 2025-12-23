/**
 * AudioPlayerService 类
 * 音频播放服务，用于播放TTS生成的音频数据
 */

// 引入expo-audio-stream模块
import { 
  ExpoPlayAudioStream, 
  EncodingTypes, 
  PlaybackModes 
} from "expo-audio-stream";

// 定义播放器状态
export type PlayerState = "idle" | "running" | "error";
// 定义音频流事件回调
export type AudioStreamCallback = (event: any) => Promise<void>;

/**
 * 音频播放器服务
 * 负责管理音频播放、录制和实时流数据处理
 */
export class AudioService {
  private static instance: AudioService;
  
  // 播放器状态
  private state: PlayerState = "idle";
  
  // 音频流队列，用于存储待播放的音频数据
  private audioStreamQueue: ArrayBuffer[] = [];
  
  // 录制订阅
  private recordingSubscription: any = null;
  
  // 单例模式：私有构造函数
  private constructor() {
    // 初始化配置
    this.initialize();
  }
  
  // 初始化播放器配置
  private async initialize(): Promise<void> {
    try {
      // 配置声音播放设置
      await ExpoPlayAudioStream.setSoundConfig({
        sampleRate: 44100,
        playbackMode: PlaybackModes.VOICE_PROCESSING,
      });
      
      console.log("Audio player initialized");
    } catch (error) {
      console.error("Failed to initialize audio player config:", error);
      this.state = "error";
    }
  }
  
  // 获取单例实例
  public static getInstance(): AudioService {
    if (!AudioService.instance) {
      AudioService.instance = new AudioService();
    }
    return AudioService.instance;
  }
  
  /**
   * 添加音频数据到播放队列
   * @param audioData ArrayBuffer格式的音频数据
   */
  public async addAudioData(audioData: ArrayBuffer): Promise<void> {
    if (!audioData || audioData.byteLength === 0) {
      return;
    }
    
    try {
      this.audioStreamQueue.push(audioData);
      
      // 如果播放器处于运行状态，自动处理队列
      if (this.state === "running") {
        this.processAudioQueue();
      }
    } catch (error) {
      console.error("[audio] Failed to add audio data:", error);
      this.state = "error";
      throw error;
    }
  }
  
  /**
   * 处理音频队列
   */
  private async processAudioQueue(): Promise<void> {
    if (this.audioStreamQueue.length === 0) {
      return;
    }
    
    try {
      while (this.audioStreamQueue.length > 0 && this.state === "running") {
        const audioData = this.audioStreamQueue.shift();
        if (!audioData) break;
        
        // 将ArrayBuffer转换为Base64字符串
        const base64Audio = this.arrayBufferToBase64(audioData);
        
        // 使用expo-audio-stream播放音频数据
        await ExpoPlayAudioStream.playSound(
          base64Audio,
          `audio-${Date.now()}`,
          EncodingTypes.PCM_S16LE
        );
      }
    } catch (error) {
      console.error("[audio] Failed to process audio queue:", error);
      this.state = "error";
    }
  }
  
  /**
   * 将ArrayBuffer转换为Base64字符串
   */
  private arrayBufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }
  
  /**
   * 开始播放
   */
  public async start(): Promise<void> {
    try {
      if (this.state === "running") {
        return;
      }
      
      // 初始化配置
      await this.initialize();
      
      // 直接转换到running状态
      this.state = "running";
      console.log("[audio] Audio player started in running state");
      // 开始处理音频队列
      this.processAudioQueue();
    } catch (error) {
      console.error("[audio] Failed to start audio player:", error);
      this.state = "error";
      throw error;
    }
  }
  
  /**
   * 停止播放
   */
  public async stop(): Promise<void> {
    try {
      if (this.state === "idle") {
        return;
      }
      
      // 中断当前播放
      await ExpoPlayAudioStream.interruptSound();
      
      // 清空音频队列
      this.audioStreamQueue = [];
      
      // 直接转换到idle状态
      this.state = "idle";
      console.log("[audio] Audio player stopped");
    } catch (error) {
      console.error("[audio] Failed to stop audio player:", error);
      this.state = "error";
      throw error;
    }
  }
  
  /**
   * 开始录制音频
   * @param callback 音频流回调函数
   */
  public async startRecording(callback: AudioStreamCallback): Promise<void> {
    try {
      if (this.state === "running") {
        return;
      }
      
      // Configure sound playback with optimized voice processing settings
      await ExpoPlayAudioStream.setSoundConfig({
        sampleRate: 44100,
        playbackMode: PlaybackModes.VOICE_PROCESSING,
      });

      // Start microphone with voice processing
      const { subscription } = 
        await ExpoPlayAudioStream.startMicrophone({
          enableProcessing: true,
          onAudioStream: callback,
        });
      
      this.recordingSubscription = subscription;
      
      // 转换到运行状态
      this.state = "running";
      
      console.log("[audio] Audio recording started");
    } catch (error) {
      console.error("[audio] Failed to start recording:", error);
      this.state = "error";
      throw error;
    }
  }
  
  /**
   * 停止录制音频
   */
  public async stopRecording(): Promise<void> {
    try {
      if (this.state !== "running") {
        return;
      }
      
      // Stop microphone recording
      await ExpoPlayAudioStream.stopMicrophone();
      
      // Clean up
      if (this.recordingSubscription) {
        this.recordingSubscription.remove();
        this.recordingSubscription = null;
      }
      
      // 回到idle状态
      this.state = "idle";
      
      console.log("[audio] Audio recording stopped");
    } catch (error) {
      console.error("[audio] Failed to stop recording:", error);
      this.state = "error";
      throw error;
    }
  }
  
  /**
   * 开始麦克风录制（用于同时录制和播放）
   * @param callback 音频流回调函数
   * @param enableProcessing 是否启用语音处理
   */
  public async startMicrophone(callback: AudioStreamCallback, enableProcessing: boolean = false): Promise<void> {
    try {
      if (this.state === "running") {
        return;
      }
      
      // 配置声音播放设置，使用语音处理模式
      await ExpoPlayAudioStream.setSoundConfig({
        sampleRate: 44100,
        playbackMode: PlaybackModes.VOICE_PROCESSING,
      });
      
      // 开始麦克风录制
      const { subscription } = await ExpoPlayAudioStream.startMicrophone({
        enableProcessing,
        onAudioStream: callback,
      });
      
      this.recordingSubscription = subscription;
      
      // 转换到运行状态
      this.state = "running";
      
      console.log("[audio] Microphone recording started");
    } catch (error) {
      console.error("[audio] Failed to start microphone recording:", error);
      this.state = "error";
      throw error;
    }
  }
  
  /**
   * 停止麦克风录制
   */
  public async stopMicrophone(): Promise<void> {
    try {
      if (this.state !== "running") {
        return;
      }
      
      // 停止麦克风录制
      await ExpoPlayAudioStream.stopMicrophone();
      
      // 清理订阅
      if (this.recordingSubscription) {
        this.recordingSubscription.remove();
        this.recordingSubscription = null;
      }
      
      // 回到idle状态
      this.state = "idle";
      
      console.log("[audio] Microphone recording stopped");
    } catch (error) {
      console.error("[audio] Failed to stop microphone recording:", error);
      this.state = "error";
      throw error;
    }
  }
  

  
  /**
   * 清理特定turnId的音频队列
   * @param turnId 音频turnId
   */
  public async clearQueueByTurnId(turnId: string): Promise<void> {
    try {
      await ExpoPlayAudioStream.clearSoundQueueByTurnId(turnId);
      console.log("[audio] Audio queue cleared for turnId: ${turnId}");
    } catch (error) {
      console.error("[audio] Failed to clear queue for turnId ${turnId}:", error);
      this.state = "error";
      throw error;
    }
  }
  
  /**
   * 播放完整的WAV文件
   * @param wavBase64Data Base64编码的WAV文件数据
   */
  public async playWav(wavBase64Data: string): Promise<void> {
    try {
      await ExpoPlayAudioStream.playWav(wavBase64Data);
      console.log("[audio] WAV file played");
    } catch (error) {
      console.error("[audio] Failed to play WAV file:", error);
      this.state = "error";
      throw error;
    }
  }
  
  /**
   * 获取当前播放器状态
   */
  public getState(): PlayerState {
    return this.state;
  }
  
  /**
   * 清理资源
   */
  public async cleanup(): Promise<void> {
    try {
      // 停止播放
      await this.stop();
      
      // 停止录制
      if (this.recordingSubscription) {
        this.recordingSubscription.remove();
        this.recordingSubscription = null;
      }
      
      // 清空队列
      this.audioStreamQueue = [];
      
      // 销毁音频流实例
      await ExpoPlayAudioStream.destroy();
      
      this.state = "idle";
      
      console.log("[audio] Audio player service cleaned up");
    } catch (error) {
      console.error("[audio] Failed to cleanup audio player:", error);
    }
  }
}