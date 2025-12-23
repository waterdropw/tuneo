import MicrophoneStreamModule, { AudioBuffer } from "@/../modules/microphone-stream"

/**
 * 音频数据处理器类
 * 负责接收MicrophoneStreamModule的onAudioBuffer数据，进行格式转换、预处理和特征提取
 */
export class AudioDataProcessor {
  private static instance: AudioDataProcessor | null = null;
  private isProcessing: boolean = false;
  private audioBufferHandler: ((processedData: any) => void) | null = null;
  
  // 单例模式，确保全局只有一个实例
  public static getInstance(): AudioDataProcessor {
    if (!AudioDataProcessor.instance) {
      AudioDataProcessor.instance = new AudioDataProcessor();
    }
    return AudioDataProcessor.instance;
  }
  
  private constructor() {
    // 私有构造函数，防止外部实例化
  }
  
  /**
   * 开始处理音频数据
   * @param callback 处理结果回调函数
   */
  public startProcessing(callback: (processedData: any) => void): void {
    if (this.isProcessing) {
      console.warn("Audio processing is already running");
      return;
    }
    
    this.audioBufferHandler = callback;
    this.isProcessing = true;
    
    // 开始录音
    MicrophoneStreamModule.startRecording();
    
    // 获取并验证实际采样率
    const actualSampleRate = MicrophoneStreamModule.getSampleRate();
    console.log(`Microphone actual sample rate: ${actualSampleRate} Hz`);
    
    // 验证采样率是否为16000 Hz（gummy-realtime-v1模型要求）
    if (actualSampleRate !== 16000) {
      console.warn(`WARNING: Microphone sample rate (${actualSampleRate} Hz) does not match the required 16000 Hz for gummy-realtime-v1 model.`);
      console.warn(`This may cause recognition to fail. Please check microphone settings.`);
    } else {
      console.log("✓ Sample rate matches required 16000 Hz for the model.");
    }
    
    // 获取缓冲区每秒数量
    console.log(`Buffers per second: ${MicrophoneStreamModule.BUF_PER_SEC}`);
    
    // 监听麦克风音频缓冲区
    MicrophoneStreamModule.addListener(
      "onAudioBuffer",
      (buffer: AudioBuffer) => {
        // console.log("Received audio buffer:", buffer.samples.length, "samples");
        this.processAudioBuffer(buffer);
      }
    );
    
    console.log("Audio data processing started");
  }
  
  /**
   * 停止处理音频数据
   */
  public stopProcessing(): void {
    if (!this.isProcessing) {
      console.warn("Audio processing is not running");
      return;
    }
    
    // 停止录音
    MicrophoneStreamModule.stopRecording();
    
    // 移除监听器
    // 注意：这里需要根据MicrophoneStreamModule的实际API来移除监听器
    // 目前的MicrophoneStreamModule实现可能没有提供移除监听器的方法
    
    this.isProcessing = false;
    this.audioBufferHandler = null;
    console.log("Audio data processing stopped");
  }
  
  /**
   * 处理音频缓冲区数据
   */
  private processAudioBuffer(buffer: AudioBuffer): void {
    if (!this.isProcessing || !this.audioBufferHandler) {
      return;
    }
    
    try {
      // 1. 格式转换：将Float数组转换为Int16Array
      const int16Array = this.floatToInt16(buffer.samples);
      
      // 2. 预处理：对音频数据进行降噪、滤波等处理
      const preprocessedData = this.preprocessAudio(int16Array);
      
      // 3. 特征提取：提取音频的时域和频域特征
      // const features = this.extractFeatures(preprocessedData);
      
      // 4. 应用算法模型：这里可以集成各种音频处理算法
      // const result = this.applyModel(features);
      const result = {
        data: int16Array,
        features: []
      }
      // 5. 输出结果
      // this.audioBufferHandler(result);
      this.audioBufferHandler(result);
    } catch (error) {
      console.error("Error processing audio buffer:", error);
    }
  }
  
  /**
   * 将Float数组转换为Int16Array
   * @param floatArray Float数组，范围为[-1.0, 1.0]
   * @returns Int16Array，范围为[-32768, 32767]
   */
  private floatToInt16(floatArray: number[]): Int16Array {
    const int16Array = new Int16Array(floatArray.length);
    
    for (let i = 0; i < floatArray.length; i++) {
      // 将Float值(-1.0到1.0)转换为Int16值(-32768到32767)
      const floatValue = floatArray[i];
      const intValue = Math.max(-32768, Math.min(32767, Math.floor(floatValue * 32768)));
      int16Array[i] = intValue;
    }
    
    return int16Array;
  }
  
  /**
   * 预处理音频数据
   * @param audioData 原始音频数据
   * @returns 预处理后的音频数据
   */
  private preprocessAudio(audioData: Int16Array): Int16Array {
    // 这里可以实现各种预处理算法，如：
    // - 降噪处理
    // - 滤波处理
    // - 增益调整
    // - 帧划分
    
    // 简化实现，直接返回原始数据
    return audioData;
  }
  
  /**
   * 提取音频特征
   * @param audioData 预处理后的音频数据
   * @returns 提取的音频特征
   */
  private extractFeatures(audioData: Int16Array): any {
    // 提取时域特征
    const timeDomainFeatures = this.extractTimeDomainFeatures(audioData);
    
    // 提取频域特征
    const freqDomainFeatures = this.extractFrequencyDomainFeatures(audioData);
    
    return {
      timeDomain: timeDomainFeatures,
      frequencyDomain: freqDomainFeatures
    };
  }
  
  /**
   * 提取时域特征
   * @param audioData 音频数据
   * @returns 时域特征
   */
  private extractTimeDomainFeatures(audioData: Int16Array): any {
    let sum = 0;
    let sumSquares = 0;
    let max = 0;
    
    for (let i = 0; i < audioData.length; i++) {
      const sample = audioData[i];
      sum += sample;
      sumSquares += sample * sample;
      max = Math.max(max, Math.abs(sample));
    }
    
    const mean = sum / audioData.length;
    const rms = Math.sqrt(sumSquares / audioData.length);
    const variance = sumSquares / audioData.length - mean * mean;
    const stdDev = Math.sqrt(variance);
    
    return {
      mean,
      rms,
      max,
      variance,
      stdDev
    };
  }
  
  /**
   * 提取频域特征
   * @param audioData 音频数据
   * @returns 频域特征
   */
  private extractFrequencyDomainFeatures(audioData: Int16Array): any {
    // 这里可以实现FFT变换，提取频谱特征
    // 简化实现，返回空对象
    return {};
  }
  
  /**
   * 应用算法模型处理特征数据
   * @param features 音频特征
   * @returns 处理结果
   */
  private applyModel(features: any): any {
    // 这里可以集成各种音频处理算法，如：
    // - 语音识别
    // - 音频分类
    // - 异常检测
    
    // 简化实现，直接返回特征数据
    return {
      timestamp: Date.now(),
      features,
      processedResult: "Sample processed result"
    };
  }
}