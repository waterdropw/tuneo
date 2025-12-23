/**
 * AliTtsService 类
 * 基于阿里云CosyVoice语音合成WebSocket API实现
 * 参考文档：https://help.aliyun.com/zh/model-studio/cosyvoice-websocket-api
 * https://github.com/aliyun/alibabacloud-bailian-speech-demo/blob/master/samples/gallery/cosyvoice-js/cosyvoice_api.js
 */

// 私有：定义WebSocket消息类型
interface WebSocketMessage {
  header: {
    action?: string;
    event?: string;
    task_id?: string;
    streaming?: string;
  };
  payload: any;
}

// 定义配置选项类型
export interface TtsConfig {
  model: string;         // 模型名称
  task_group: string;    // 任务组，默认为 audio
  task: string;          // 任务类型，默认为tts
  function: string;      // 函数名称，默认为SpeechSynthesizer
  input: any;
  parameters: any;
}

/**
 * CosyVoice语音合成模型配置
 */ 
export class CosyvoiceConfig implements TtsConfig {
  model: "cosyvoice-v2" | "cosyvoice-v3-flash" | "cosyvoice-v3-plus" = "cosyvoice-v3-flash";
  task_group: string = "audio";
  task: string = "tts";
  function: string = "SpeechSynthesizer";
  input: any = {};
  parameters: {
    text_type: string; // 文本类型，默认值为plain
    voice: string; // 语音合成所使用的音色。支持系统音色和复刻音色
    format?: "pcm" | "wav" | "mp3" | "opus"; // 音频编码格式。
    sample_rate?: 8000 | 16000 | 22050 | 24000 | 44100 | 48000;
    volume?: number; // 取值范围：[0, 100]。50代表标准音量。音量大小与该值呈线性关系，0为静音，100为最大音量。
    rate?: number;  // 语速，取值范围：[0.5, 2.0]。1.0为标准语速，小于1.0则减慢，大于1.0则加快。
    pitch?: number; // 音高。该值作为音高调节的乘数，但其与听感上的音高变化并非严格的线性或对数关系，建议通过测试选择合适的值。取值范围：[0.5, 2.0]。1.0为音色自然音高。大于1.0则音高变高，小于1.0则音高变低。
    enable_ssml?: boolean; // 是否开启SSML支持。该参数设为 true 后，仅允许发送一次文本（只允许发送一次continue-task指令）。
    bit_rate?: number; // 取值范围：[6, 510]。音频码率（单位kbps）。音频格式为opus时，支持通过bit_rate参数调整码率。
    word_timestamp_enabled?: boolean; // 是否开启单词级时间戳。默认值为false。开启后，返回的音频数据中会包含每个单词的开始时间和结束时间。
    seed?: number; // 取值范围：[0, 65535]。生成时使用的随机数种子，使合成的效果产生变化。在模型版本、文本、音色及其他参数均相同的前提下，使用相同的seed可复现相同的合成结果
    language_hints?: string[]; // 提供语言提示，仅cosyvoice-v3-flash、cosyvoice-v3-plus支持该功能。注意：此参数为数组，但当前版本仅处理第一个元素，因此建议只传入一个值。
    instruction?: string; // 指令，仅cosyvoice-v3-flash、cosyvoice-v3-plus支持该功能。1. 指定小语种（仅限复刻音色）。2. 指定方言（仅限复刻音色）3. 指定情感、场景、角色或身份等：仅部分系统音色支持该功能，且因音色而异
    enable_aigc_tag?: boolean;  // 是否开启AIGC标签。默认值为false。注意：开启后，返回的音频数据中会包含AIGC标签，用于标识生成的音频是否包含AIGC内容。
    aigc_propagator?: string;   // 设置AIGC隐性标识中的 ContentPropagator 字段，用于标识内容的传播者。仅在 enable_aigc_tag 为 true 时生效。默认值：阿里云UID。
    aigc_propagate_id?: string; // 设置AIGC隐性标识中的 PropagateID 字段，用于唯一标识一次具体的传播行为。仅在 enable_aigc_tag 为 true 时生效。默认值：本次语音合成请求Request ID
  } = {
    text_type: "plain",
    voice: "longanhuan",
    format: "mp3",
    sample_rate: 22050,
    volume: 50,
    rate: 1.0,
    pitch: 1.0,
    enable_ssml: false,
    bit_rate: 32,
    word_timestamp_enabled: false,
    seed: 0,
    language_hints: [],
    instruction: "",
    enable_aigc_tag: false,
    aigc_propagator: "",
    aigc_propagate_id: "",
  }
}

/**
 * 语音合成服务回调类型定义
 */
export type TtsResultCallback = (
  audioData: ArrayBuffer | null, // 音频数据，null表示结束
  metadata?: { isFinal?: boolean; timestamp?: number } // 元数据
) => void;

export type TtsErrorCallback = (
  error: Error
) => void;

export type TtsEventCallback = (
  event: "task-started" | "task-finished" | "error",
  data?: any
) => void;

/**
 * 语音合成服务类
 */
export class AliTtsService {
  private config: TtsConfig;

  private wsUrl: string;
  private socket: WebSocket | null = null;
  private taskId: string = this.generateUUID();
  private isConnected: boolean = false;
  private isTaskStarted: boolean = false;
  private isTaskFinished: boolean = false;
  private messageQueue: any[] = [];
  private resolveTaskStarted: ((value: void | PromiseLike<void>) => void) | null = null;
  private resolveTaskFinished: ((value: void | PromiseLike<void>) => void) | null = null;
  
  // 回调函数
  private audioCallback: TtsResultCallback | null = null;
  private errorCallback: TtsErrorCallback | null = null;
  private eventCallback: TtsEventCallback | null = null;
  
  /**
   * 构造函数
   * @param config 配置选项
   */
  constructor(config: TtsConfig) {
    const apiKey = process.env.EXPO_PUBLIC_DASHSCOPE_API_KEY || process.env.DASHSCOPE_API_KEY || '';
    if (!apiKey) {
      throw new Error("DASHSCOPE_API_KEY is not set in environment variables.");
    }
    this.wsUrl = `wss://dashscope.aliyuncs.com/api-ws/v1/inference?api_key=${apiKey}`;
    this.config = config;
  }
  
  /**
   * 连接到WebSocket服务并发送run-task消息
   * @returns Promise<void>
   */
  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.resolveTaskStarted = resolve;
      
      // 重置状态
      this.isConnected = false;
      this.isTaskStarted = false;
      this.isTaskFinished = false;
      this.messageQueue = [];
      
      try {
        console.log('[tts] Connecting to WebSocket service...');
        this.socket = new WebSocket(this.wsUrl);
        
        this.socket.binaryType = 'arraybuffer'; // 明确设置二进制类型
        
        this.socket.onopen = () => {
          console.log("[tts] WebSocket connection established.");
          this.isConnected = true;
          
          // 生成随机任务ID
          this.taskId = this.generateUUID();
          
          // 发送run-task消息
          const runTaskMessage: WebSocketMessage = {
            header: {
              action: "run-task",
              task_id: this.taskId,
              streaming: "duplex"
            },
            payload: this.config
          };
          
          try {
            this.socket?.send(JSON.stringify(runTaskMessage));
            console.log('[tts] Sent run-task message:', runTaskMessage);
          } catch (error) {
            console.error('[tts] Failed to send run-task message:', error);
            this.handleError(new Error(`[tts] Failed to send run-task message: ${error}`));
            reject(error);
          }
        };
        
        this.socket.onmessage = (event) => {
          // 处理二进制音频流和JSON事件
          if (event.data instanceof ArrayBuffer) {
            // 处理音频数据
            this.handleAudioData(event.data);
          } else if (typeof event.data === 'string') {
            // 处理JSON事件
            try {
              const message = JSON.parse(event.data);
              // console.log("[tts] Received TTS message:", message);
              this.handleTextMessage(message);
            } catch (error) {
              console.error("[tts] Failed to parse TTS message:", error, "Raw message:", event.data);
              this.handleError(new Error(`[tts] Failed to parse message: ${error}`));
            }
          } else {
            console.warn("[tts] Received unexpected message type:", typeof event.data);
          }
        };
        
        this.socket.onerror = (error) => {
          const errorObj = error instanceof Error ? error : new Error(String(error));
          console.error("[tts] WebSocket error:", errorObj);
          this.handleError(errorObj);
          reject(errorObj);
        };
        
        this.socket.onclose = (event) => {
          console.log("[tts] WebSocket connection closed. Code: ${event.code}, Reason: ${event.reason}");
          
          const wasConnected = this.isConnected;
          this.isConnected = false;
          this.isTaskStarted = false;
          this.isTaskFinished = true;
          
          // 只有在连接已建立但任务未开始时才reject
          if (wasConnected && !this.isTaskStarted && this.resolveTaskStarted) {
            reject(new Error(`[tts] WebSocket closed unexpectedly. Code: ${event.code}, Reason: ${event.reason}`));
          }
          
          // 通知音频结束
          this.notifyAudioEnd();
        };
      } catch (error) {
        const errorObj = error instanceof Error ? error : new Error(String(error));
        console.error("[tts] Failed to initialize TTS WebSocket:", errorObj);
        this.handleError(errorObj);
        reject(errorObj);
      }
    });
  }
  
  /**
   * 处理文本消息
   */
  private handleTextMessage(message: any): void {
    if (message.header?.event === "task-started") {
      this.isTaskStarted = true;
      console.log('[tts] Received task-started event');
      
      // 通知任务开始
      this.notifyEvent("task-started");
      
      if (this.resolveTaskStarted) {
        this.resolveTaskStarted();
      }
    } else if (message.header?.event === "task-finished") {
      this.isTaskFinished = true;
      this.isTaskStarted = false;
      console.log('[tts] Received task-finished event');
      
      // 通知任务结束
      this.notifyEvent("task-finished");
      
      if (this.resolveTaskFinished) {
        this.resolveTaskFinished();
      }
      
      // 通知音频结束
      this.notifyAudioEnd();
    } else if (message.header?.event === "result-generated") {
      // console.log('[tts] Received result-generated event:', message.payload);
      // 处理结果生成事件（如果有）
    } else if (message.header?.event === "error") {
      console.error('[tts] Received error event:', message.payload);
      this.handleError(new Error(`[tts] TTS Service Error: ${message.payload?.message || 'Unknown error'}`));
      this.notifyEvent("error", message.payload);
    }
  }
  
  /**
   * 处理音频数据
   */
  private handleAudioData(audioData: ArrayBuffer): void {
    if (this.audioCallback) {
      this.audioCallback(audioData, {
        isFinal: this.isTaskFinished,
        timestamp: Date.now()
      });
    }
  }
  
  /**
   * 通知音频结束
   */
  private notifyAudioEnd(): void {
    if (this.audioCallback) {
      this.audioCallback(null, {
        isFinal: true,
        timestamp: Date.now()
      });
    }
  }
  
  /**
   * 发送待合成文本
   * @param text 待合成的文本
   * @param isFinal 是否为最终文本
   */
  sendText(text: string, isFinal: boolean = false): void {
    // 参数验证
    if (typeof text !== 'string') {
      throw new TypeError("Text must be a string.");
    }
    
    // 检查连接状态
    if (!this.isConnected || !this.isTaskStarted || !this.socket) {
      throw new Error("TTS WebSocket is not connected or task has not started.");
    }
    
    // 检查文本长度限制（根据API文档，单次发送不超过2000字符）
    if (text.length > 2000) {
      console.warn('[tts] Text length (${text.length}) exceeds recommended limit of 2000 characters.');
    }
    
    // 发送continue-task指令
    const continueTaskMessage: WebSocketMessage = {
      header: {
        action: "continue-task",
        task_id: this.taskId,
        streaming: "duplex"
      },
      payload: {
        input: {
          text: text
        }
      }
    };
    
    try {
      this.socket.send(JSON.stringify(continueTaskMessage));
      console.log('[tts] Sent continue-task message:', continueTaskMessage);
    } catch (error) {
      const errorObj = error instanceof Error ? error : new Error(String(error));
      console.error('[tts] Failed to send continue-task message:', errorObj);
      this.handleError(new Error(`[tts] Failed to send continue-task message: ${errorObj.message}`));
      throw errorObj;
    }
    
    // 如果是最终文本，发送finish-task指令
    if (isFinal) {
      this.stop().catch(error => {
        console.error('[tts] Failed to stop TTS task:', error);
      });
    }
  }
  
  /**
   * 停止任务并等待task-finished消息
   * @returns Promise<void>
   */
  stop(): Promise<void> {
    // 检查状态
    if (!this.isConnected || !this.isTaskStarted || !this.socket || !this.taskId) {
      throw new Error("TTS WebSocket is not connected or task has not started.");
    }
        
    return new Promise((resolve, reject) => {
      // 设置超时处理
      const timeoutId = setTimeout(() => {
        console.error('[tts] Stop task timed out after 5 seconds');
        reject(new Error('[tts] Stop task timed out'));
        
        // 超时后强制关闭连接
        this.close();
      }, 5000);
      
      this.resolveTaskFinished = () => {
        clearTimeout(timeoutId);
        resolve();
      };
      
      // 发送finish-task指令
      const finishTaskMessage: WebSocketMessage = {
        header: {
          action: "finish-task",
          task_id: this.taskId,
          streaming: "duplex"
        },
        payload: {
          input: {}
        }
      };
      
      try {
        this.socket?.send(JSON.stringify(finishTaskMessage));
        console.log('[tts] Sent finish-task message:', finishTaskMessage);
      } catch (error) {
        const errorObj = error instanceof Error ? error : new Error(String(error));
        clearTimeout(timeoutId);
        console.error('[tts] Failed to send finish-task message:', errorObj);
        this.handleError(new Error(`[tts] Failed to send finish-task message: ${errorObj.message}`));
        reject(errorObj);
      }
    });
  }
  
  /**
   * 关闭WebSocket连接
   */
  close(): void {
    console.log('[tts] Closing TTS WebSocket connection...');
    
    // 清理回调函数引用，避免内存泄漏
    this.audioCallback = null;
    this.errorCallback = null;
    this.eventCallback = null;
    this.resolveTaskStarted = null;
    this.resolveTaskFinished = null;
    
    // 关闭WebSocket连接
    if (this.socket) {
      try {
        this.socket.close(1000, "Normal closure");
      } catch (error) {
        console.error('[tts] Failed to close WebSocket:', error);
      }
      this.socket = null;
    }
    
    // 重置状态
    this.isConnected = false;
    this.isTaskStarted = false;
    this.isTaskFinished = true;
    this.messageQueue = [];
  }
  
  /**
   * 生成UUID
   * @returns UUID字符串
   */
  private generateUUID(): string {
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === "x" ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }
  
  /**
   * 设置音频数据回调
   * @param callback 音频数据回调函数
   */
  setAudioCallback(callback: TtsResultCallback): void {
    this.audioCallback = callback;
  }
  
  /**
   * 设置错误回调
   * @param callback 错误回调函数
   */
  setErrorCallback(callback: TtsErrorCallback): void {
    this.errorCallback = callback;
  }
  
  /**
   * 设置事件回调
   * @param callback 事件回调函数
   */
  setEventCallback(callback: TtsEventCallback): void {
    this.eventCallback = callback;
  }
  
  /**
   * 处理错误
   */
  private handleError(error: Error): void {
    console.error("TTS error:", error);
    if (this.errorCallback) {
      this.errorCallback(error);
    }
  }
  
  /**
   * 通知事件
   */
  private notifyEvent(event: "task-started" | "task-finished" | "error", data?: any): void {
    if (this.eventCallback) {
      this.eventCallback(event, data);
    }
  }
  
  /**
   * 获取连接状态
   * @returns 是否已连接
   */
  isReady(): boolean {
    return this.isConnected && this.isTaskStarted;
  }
  
  /**
   * 获取当前任务ID
   * @returns 任务ID
   */
  getTaskId(): string | null {
    return this.taskId;
  }
}
