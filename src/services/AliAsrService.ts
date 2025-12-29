/**
 * AliAsrService 类
 * 基于阿里云Paraformer实时语音识别API实现
 * 参考实现：https://github.com/aliyun/alibabacloud-bailian-speech-demo/blob/master/samples/gallery/paraformer-realtime-js/paraformer_realtime_api.js
 */

import MicrophoneStreamModule from "../../modules/microphone-stream";

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
export interface AsrConfig {  
  model: string;         // 模型名称，默认为fun-asr-realtime, 可选值为[fun-asr-realtime, gummy-realtime-v1, gummy-chat-v1, paraformer-realtime-v2,paraformer-realtime-v1,paraformer-realtime-8k-v2, paraformer-realtime-8k-v1, cosyvoice-v3-plus、cosyvoice-v3-flash、cosyvoice-v2、cosyvoice-v1]
  task_group: string;    // 任务组，默认为 audio
  task: string;          // 任务类型，默认为asr, 可选值为[asr, tts]
  function: string;      // 函数名称，默认为recognition, 可选值为[recognition，SpeechSynthesizer]
  input: any;
  parameters: any;
}

export const LanguageOptions = {
  "zh": "中文", // 普通话
  // 方言
  "yue": "粤语",
  "mn": "闽南话",
  "sn": "陕西话",
  "db": "东北话",
  // "gs": "甘肃话",
  // "gz": "贵州话",
  // "hn": "河南话",
  // "hb": "湖北话",
  // "jx": "江西话",
  // "nx": "宁夏话",
  // "sx": "山西话",
  // "sd": "山东话",
  // "sh": "上海话",
  // "sc": "四川话",
  // "tj": "天津话",
  // "yn": "云南话",
  // 外语
  "en": "英文",
  "ja": "日文",
  "ko": "韩文",
  "de": "德语",
  "fr": "法语",
  "ru": "俄语",
  // "es": "西班牙语",
  // "it": "意大利语",
  // "pt": "葡萄牙语",
  // "id": "印尼语",
  // "ar": "阿拉伯语",
  // "th": "泰语",
  // "hi": "印地语",
  // "da": "丹麦语",
  // "ur": "乌尔都语",
  // "tr": "土耳其语",
  // "nl": "荷兰语",
  // "ms": "马来语",
  // "vi": "越南语"
}
const FANYAN_LIST = ["yue", "mn", "sn", "db"];

export class FunConfig implements AsrConfig {
  model: string = "fun-asr-realtime";
  task_group: string = "audio";
  task: string = "asr";
  function: string = "recognition";
  input: any = {};
  parameters: {
    format: "pcm" | "wav" | "mp3" | "opus" | "speex" | "aac" | "amr";        // 音频格式，可选值为[pcm, wav, mp3, opus, speex, aac, amr]，默认为pcm
    sample_rate: 16000 | 48000;   // 采样率，默认为16000，即为16kHz
    heartbeat?: boolean; // 是否开启心跳功能。默认值：false
    vocabulary_id?: string; // 热词ID。默认不设置。
    semantic_punctuation_enabled?: boolean; // 是否开启语义断句。默认值：false
    multi_threshold_mode_enabled?: boolean; // 是否开启防止 VAD 断句过长的功能。开启可避免过长切割。默认值：false
    max_sentence_silence?: number; // VAD静音时长阈值。在 VAD（Voice Activity Detection，语音活动检测）断句中，静音时长超过该阈值即判定句子结束。单位：毫秒（ms）
  } = {
    format: "pcm",
    sample_rate: 16000,
    heartbeat: false,
    semantic_punctuation_enabled: false,
    multi_threshold_mode_enabled: false,
    max_sentence_silence: 800,
  };
}

/**
 * 实时语音识别与翻译模型配置
 */
export class ParaformerConfig implements AsrConfig {
  model: "paraformer-realtime-v1" | "paraformer-realtime-v2" | "paraformer-realtime-8k-v1" | "paraformer-realtime-8k-v2"= "paraformer-realtime-v2";
  task_group: string = "audio";
  task: string = "asr";
  function: string = "recognition";
  input: any = {};
  parameters: {
    format: "pcm" | "wav" | "mp3" | "opus" | "speex" | "aac" | "amr";        // 音频格式，可选值为[pcm, wav, mp3, opus, speex, aac, amr]，默认为pcm
    sample_rate: 16000;   // 采样率，默认为16000，即为16kHz
    heartbeat?: boolean; // 是否开启心跳功能。默认值：false
    vocabulary_id?: string; // 热词ID。默认不设置。
    disfluency_removal_enabled?: boolean; // 设置是否过滤语气词。默认值：false
    semantic_punctuation_enabled?: boolean; // 是否开启语义断句。默认值：false
    multi_threshold_mode_enabled?: boolean; // 是否开启防止 VAD 断句过长的功能。开启可避免过长切割。默认值：false
    punctuation_prediction_enabled?: boolean; // 设置是否在识别结果中自动添加标点。默认值：true
    inverse_text_normalization_enabled?: boolean; // 设置是否开启ITN（Inverse Text Normalization，逆文本正则化）。默认值：true。该参数仅在模型为v2及更高版本时生效
    max_sentence_silence?: number; // VAD静音时长阈值。在 VAD（Voice Activity Detection，语音活动检测）断句中，静音时长超过该阈值即判定句子结束。单位：毫秒（ms）。参数范围为200ms至6000ms，默认值为800ms。
  } = {
    format: "pcm",
    sample_rate: 16000,
    heartbeat: false,
    semantic_punctuation_enabled: false,
    multi_threshold_mode_enabled: false,
    punctuation_prediction_enabled: true,
    inverse_text_normalization_enabled: true,
    max_sentence_silence: 800,
  };
  resources?: {
    resource_id: string;    // 热词ID，此次语音识别中生效此热词ID对应的热词信息。默认不启用。需和resource_type参数配合使用。注：resource_id对应SDK中的phrase_id字段，phrase_id为v1版本模型热词方案，不支持v2及后续系列模型。
    resource_type: string;  // 固定字符串“asr_phrase”，需和resource_id参数配合使用。
  } = {
    resource_id: "",
    resource_type: "asr_phrase",
  }
}

export class GummyConfig implements AsrConfig {
  model: "gummy-realtime-v1" | "gummy-chat-v1" = "gummy-realtime-v1";
  task_group: string = "audio";
  task: string = "asr";
  function: string = "recognition";
  input: any = {};
  parameters: {
    format: "pcm" | "wav" | "mp3" | "opus" | "speex" | "aac" | "amr";        // 音频格式，可选值为[pcm, wav, mp3, opus, speex, aac, amr]，默认为pcm
    sample_rate: number;   // 采样率，默认为16000，即为16kHz
    transcription_enabled?: boolean; // 是否开启识别功能。注：模型支持识别与翻译功能单独开启或全部开启，但需要至少开启一个能力。重要：语音识别与翻译功能分别计费，费用按各自调用量独立计算。两项服务的单价一致。
    translation_enabled?: boolean; // 是否开启翻译功能，注意需translation_target_languages有效才能正常输出翻译结果。
    source_language?: string;  // 输入语言，默认为zh
    translation_target_languages?: string[];  // 输出语言，默认为zh。注意：此参数为数组，但当前版本仅处理第一个元素，因此建议只传入一个值。
    vocabulary_id?: string; // 热词ID。默认不设置。
    max_end_silence?: number; // VAD静音时长阈值。在 VAD（Voice Activity Detection，语音活动检测）断句中，静音时长超过该阈值即判定句子结束。单位：毫秒（ms）
  } = {
    format: "pcm",
    sample_rate: 16000,
    transcription_enabled: true,
    translation_enabled: true,
    source_language: "zh",
    translation_target_languages: ["en"], // 仅仅支持输出一种语言翻译，不支持多种！
    max_end_silence: 800,
  };
}


/**
 * 实时语音识别处理器
 */
export class AliAsrService {
  private config: AsrConfig;

  private wsUrl: string;
  private socket: WebSocket | null = null;
  private taskId: string = this.generateUUID();
  private isConnected: boolean = false;
  private isTaskStarted: boolean = false;
  private messageQueue: any[] = [];
  private resolveTaskStarted: ((value: void | PromiseLike<void>) => void) | null = null;
  private resolveTaskFinished: ((value: void | PromiseLike<void>) => void) | null = null;
  private resultCallback: ((result: Record<string, string>) => void) | null = null;
  private errorCallback: ((error: Error) => void) | null = null;
  
  // Audio configuration
  private actualSampleRate: number = 16000;
  
  /**
   * 构造函数
   * @param config 配置选项
   */
  constructor(config: AsrConfig) {
    const apiKey = process.env.EXPO_PUBLIC_DASHSCOPE_API_KEY || process.env.DASHSCOPE_API_KEY || '';
    if (!apiKey) {
      throw new Error("DASHSCOPE_API_KEY is not set in environment variables.");
    }
    this.wsUrl = `wss://dashscope.aliyuncs.com/api-ws/v1/inference?api_key=${apiKey}`;
    this.config = config;
    // 获取并验证实际采样率
    const actualSampleRate = MicrophoneStreamModule.getSampleRate();
    console.log(`Microphone actual sample rate: ${actualSampleRate} Hz`);
    this.config.parameters.sample_rate = actualSampleRate;
    if (FANYAN_LIST.includes(this.config.parameters.translation_target_languages?.[0])) {
      this.config.parameters.translation_target_languages = ["zh"];
    }
  }
  
  /**
   * 连接到WebSocket服务并发送run-task消息
   * @returns Promise<void>
   */
  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.resolveTaskStarted = resolve;
      
      try {
        console.log('[asr] Connecting to WebSocket');
        this.socket = new WebSocket(this.wsUrl);
        
        this.socket.onopen = () => {
          console.log("[asr] WebSocket connection established.");
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
          
          this.socket?.send(JSON.stringify(runTaskMessage));
          console.log('[asr] Sent message:', runTaskMessage);
        };
        
        this.socket.onmessage = (event) => {
          const message = JSON.parse(event.data);
          // console.log("[asr] Received message:", message);
          
          if (message.header.event === "task-started") {
            this.isTaskStarted = true;
            console.log('[asr] Received task-started');
            if (this.resolveTaskStarted) {
              this.resolveTaskStarted();
            }
            resolve(); // 在接收到task-started后resolve Promise
          } else if (message.header.event === "task-finished") {
            console.log('Received task-finished');
            if (this.resolveTaskFinished) {
              this.resolveTaskFinished();
            }
          } else if (message.header.event === 'result-generated') {
            // console.log('[asr] Received result-generated:', JSON.stringify(message.payload));

            // Handle different response formats based on model
            let asrResult = "";
            let translations: Record<string, string> = {};

            // Extract ASR result - handle different formats
            if (message.payload.output) {
              if (message.payload.output.text) {
                // Common format for gummy-realtime-v1
                asrResult = message.payload.output.text;
              } else if (message.payload.output.sentence?.text) {
                // Legacy format
                // 只处理 sentence_end 为 true 的翻译,避免获得重复翻译结果
                if (message.payload.output.sentence.sentence_end) {
                  asrResult = message.payload.output.sentence.text;
                }
              } else if (message.payload.output.transcription?.text) {
                // Transcription format
                // 只处理 sentence_end 为 true 的翻译,避免获得重复翻译结果
                if (message.payload.output.transcription.sentence_end) {
                  asrResult = message.payload.output.transcription.text;
                }
              }

              // Extract translations
              if (message.payload.output.translations) {
                for (const translation of message.payload.output.translations) {
                  // 只处理 sentence_end 为 true 的翻译,避免获得重复翻译结果
                  if (translation.sentence_end) {
                    translations[translation.lang || ""] = translation.text || "";
                  }
                }
              } else if (message.payload.output.translation) {
                // Handle gummy-realtime-v1 translation format if different
                const translationOutput = message.payload.output.translation;
                if (typeof translationOutput === 'object' && translationOutput !== null) {
                  // 过滤出 sentence_end 为 true 的翻译
                  const filteredTranslations = Object.fromEntries(
                    Object.entries(translationOutput)
                      .filter(([_, value]) => {
                        // Type assertion to handle unknown type
                        const typedValue = value as { sentence_end?: boolean };
                        return typedValue?.sentence_end === true;
                      })
                  );
                  Object.entries(filteredTranslations).forEach(([lang, translationObj]) => {
                    // Check if translationObj has a text property and use that
                    if (translationObj && typeof translationObj === 'object' && 'text' in translationObj) {
                      // Type assertion to handle unknown type
                      const typedTranslationObj = translationObj as { text?: string };
                      translations[lang] = typedTranslationObj.text || "";
                    }
                  });
                }
              } else if (this.config.parameters.translation_target_languages[0] === "zh") {
                // 返回识别结果，便于统一处理中文方言的TTS
                translations["zh"] = asrResult;
              }
            }

            // Call callbacks if we have results
            if (asrResult && this.resultCallback) {
              this.resultCallback({ asr: asrResult, ...translations });
            }
            
            // Log if no results were extracted but we received a result-generated event
            // if (!asrResult && Object.keys(translations).length === 0) {
            //   console.warn('[asr] No results extracted from result-generated event:', message.payload);
            // }
          }
        };
        
        this.socket.onerror = (error) => {
          console.error("[asr] WebSocket error:", error);
          reject(error); // 如果发生错误，reject Promise
        };
        
        this.socket.onclose = (event) => {
          console.log(`[asr] WebSocket connection closed. Code: ${event.code}, Reason: ${event.reason}`);
          this.isConnected = false;
          if (!this.isTaskStarted) {
            reject(new Error("[asr] WebSocket closed before task started."));
          }
          this.isTaskStarted = false;
        };
      } catch (error) {
        console.error("[asr] Failed to initialize WebSocket:", error);
        reject(error);
      }
    });
  }
  
  /**
   * 发送音频数据
   * @param audioData Int16Array格式的音频数据
   */
  sendAudio(audioData: Int16Array): void {
    if (!this.isConnected || !this.isTaskStarted || !this.socket) {
      throw new Error("[asr] WebSocket is not connected or task has not started.");
    }
    
    if (!(audioData instanceof Int16Array)) {
      throw new TypeError("[asr] Audio data must be an Int16Array.");
    }
    console.log('[asr] Sending audio data:',audioData.length, audioData[0], audioData[500], audioData[1000]);
    this.socket.send(audioData);
  }
  
  /**
   * 停止任务并等待task-finished消息
   * @returns Promise<void>
   */
  stop(): Promise<void> {
    if (!this.isConnected || !this.isTaskStarted || !this.socket || !this.taskId) {
      throw new Error("WebSocket is not connected or task has not started.");
    }
    
    return new Promise((resolve) => {
      this.resolveTaskFinished = resolve;
      
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
      
      this.socket?.send(JSON.stringify(finishTaskMessage));
      console.log('[asr] Sent message:', finishTaskMessage);
    });
  }
  
  /**
   * 关闭WebSocket连接
   */
  close(): void {
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
    
    this.isConnected = false;
    this.isTaskStarted = false;
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
   * 设置结果回调
   * @param callback 结果回调函数
   */
  setResultCallback(callback: (result: Record<string, string>) => void): void {
    this.resultCallback = callback;
  }
  
  /**
   * 设置错误回调
   * @param callback 错误回调函数
   */
  setErrorCallback(callback: (error: Error) => void): void {
    this.errorCallback = callback;
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
