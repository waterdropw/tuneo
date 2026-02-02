/**
 * AutoDetectBilingualAsrService 类
 * 实现自动检测输入语言并根据检测结果修改目标语言的双向实时转译
 * 继承自 AliAsrService
 * 
 * 支持任意语言对，通过 BilingualLanguageConfig 配置语言检测和映射规则
 * 
 * 使用场景：双向实时转译
 * 1. 建立 WebSocket 连接（可复用）
 * 2. 发送 run-task，source_language 设为 "auto"，translation_enabled 先设为 false（只做识别，不翻译）
 * 3. 收到 result-generated 后，根据 transcription.text 判断源语言
 * 4. 立即再发一条 run-task（复用同一连接，换一个新的 task_id），把 translation_enabled 设为 true，
 *    并根据第 3 步结果把 translation_target_languages 设为正确的目标语言
 * 5. 把同一段音频重新发一次（或把之前缓存的音频直接重发），即可得到翻译结果
 * 
 * 典型使用流程：
 *   // 中英互译
 *   const config = new GummyConfig();
 *   const langConfig = {
 *     languageMapping: { "zh": "en", "en": "zh" },
 *     detectLanguage: (text) => {
 *       const chineseRegex = /[\u4E00-\u9FFF]/g;
 *       const ratio = (text.match(chineseRegex) || []).length / text.length;
 *       return ratio > 0.3 ? "zh" : "en";
 *     }
 *   };
 *   const service = new AutoDetectBilingualAsrService(config, langConfig);
 *   await service.connect();
 *   const result = await service.processBilingualTranslation(audioData);
 *   await service.disconnect();
 */

import { AliAsrService, AsrConfig, GummyConfig } from "./AliAsrService";
import { WebSocketMessage } from "./BaseWebSocketService";

/**
 * 语言检测和映射配置
 * 定义如何检测源语言以及对应的目标语言映射
 */
export interface BilingualLanguageConfig {
  // 源语言到目标语言的映射
  // 例如: { "zh": "en", "en": "zh" } 表示中文译成英文，英文译成中文
  // 例如: { "ja": "en", "en": "ja" } 表示日文译成英文，英文译成日文
  languageMapping: Record<string, string>;
  
  // 语言检测函数：根据文本判断检测到的语言
  // 返回值应该是 languageMapping 中的某个键
  detectLanguage: (text: string) => string;
}

export interface DetectionResult {
  detectedLanguage: string;  // 检测到的语言代码
  transcriptionText: string;  // 转录文本
  targetLanguage: string;     // 推荐的目标语言代码
}

export interface TranslationResult extends DetectionResult {
  translation: string;        // 翻译文本
}

/**
 * 自动检测双语ASR服务
 * 
 * 支持任意语言对的双向转译。通过在构造时传入语言配置，
 * 可以实现不同的语言对转译（如中英互译、日英互译等）
 * 
 * 支持两种模式：
 * 1. 批处理模式：processBilingualTranslation() - 等待完整音频后处理
 * 2. 实时流式模式：startRealtimeTranslation() + sendAudio() - 持续发送音频，实时获得结果
 */
export class AutoDetectBilingualAsrService extends AliAsrService {
  private audioBuffer: Int16Array | null = null;
  private detectionResultCallback: ((result: DetectionResult) => void) | null = null;
  private translationResultCallback: ((result: TranslationResult) => void) | null = null;
  private phaseSwitchingCallback: ((isSwitching: boolean) => void) | null = null;  // 阶段切换状态回调
  private detectedLanguage: string = "auto";
  private transcriptionText: string = "";
  private isDetectionPhase: boolean = false;
  private isTranslationPhase: boolean = false;
  private isRealtimeMode: boolean = false;  // 标记是否为实时流式模式
  private realtimeSwitched: boolean = false;  // 标记是否已从检测阶段切换到翻译阶段
  
  // 实时模式下的音频缓冲
  private detectionAudioFrames: Int16Array[] = [];  // 检测阶段的所有音频帧
  
  // 语言配置
  private languageConfig: BilingualLanguageConfig;

  /**
   * 构造函数
   * @param config ASR 服务配置
   * @param languageConfig 语言检测和映射配置（可选，默认为中英互译）
   */
  constructor(config: AsrConfig, languageConfig?: BilingualLanguageConfig) {
    super(config);
    
    // 使用提供的语言配置，或默认为中英互译
    this.languageConfig = languageConfig || this._getDefaultChineseEnglishConfig();
  }

  /**
   * 获取默认的中英互译配置
   * @private
   */
  private _getDefaultChineseEnglishConfig(): BilingualLanguageConfig {
    return {
      languageMapping: {
        "zh": "en",  // 中文 → 英文
        "en": "zh",  // 英文 → 中文
      },
      detectLanguage: (text: string) => {
        // 中文字符范围：\u4E00-\u9FFF（CJK统一表意符号）
        const chineseRegex = /[\u4E00-\u9FFF]/g;
        const chineseCharCount = (text.match(chineseRegex) || []).length;
        const ratio = chineseCharCount / text.length;
        // 如果中文字符占比超过 30%，判定为中文
        return ratio > 0.3 ? "zh" : "en";
      }
    };
  }

  /**
   * 获取服务名称（用于日志）
   */
  protected getServiceName(): string {
    return "auto-detect-bilingual-asr";
  }

  /**
   * 处理 WebSocket 消息（覆盖父类实现）
   * 在检测阶段和翻译阶段分别处理消息
   */
  protected onMessage(event: MessageEvent): void {
    if (typeof event.data !== "string") {
      return;
    }
    const message = JSON.parse(event.data);

    // 处理任务启动事件
    if (message.header.event === "task-started") {
      this.isTaskStarted = true;
      console.log(
        "[auto-detect-bilingual-asr] Received task-started for task:",
        message.header.task_id
      );
      if (this.resolveTaskStarted) {
        this.resolveTaskStarted();
      }
    }
    // 处理任务完成事件
    else if (message.header.event === "task-finished") {
      console.log(
        "[auto-detect-bilingual-asr] Received task-finished for task:",
        message.header.task_id
      );
      this.isTaskStarted = false;
    }
    // 处理结果事件
    else if (message.header.event === "result-generated") {
      this._handleDetectionOrTranslationResult(message);
      
      // 在实时模式下，自动从检测阶段切换到翻译阶段
      if (this.isRealtimeMode && !this.realtimeSwitched && this.isDetectionPhase && this.detectedLanguage !== "auto") {
        this._switchToTranslationPhase().catch((error) => {
          console.error("[auto-detect-bilingual-asr] Error in phase switch:", error);
        });
      }
    }
  }

  /**
   * 处理检测或翻译结果
   * @private
   */
  private _handleDetectionOrTranslationResult(message: any): void {
    let asrResult = "";
    let translations: Record<string, string> = {};
    let isSentenceEnd = false;

    // 提取ASR结果 - 处理不同的格式
    if (message.payload.output) {
      if (message.payload.output.text) {
        // gummy-realtime-v1 通用格式
        asrResult = message.payload.output.text;
        isSentenceEnd = true;  // 通用格式默认认为是完整句子
      } else if (message.payload.output.sentence?.text) {
        // 遗留格式
        isSentenceEnd = message.payload.output.sentence.sentence_end || false;
        if (isSentenceEnd) {
          asrResult = message.payload.output.sentence.text;
        }
      } else if (message.payload.output.transcription?.text) {
        // Transcription 格式
        isSentenceEnd = message.payload.output.transcription.sentence_end || false;
        if (isSentenceEnd) {
          asrResult = message.payload.output.transcription.text;
        }
      }

      // 提取翻译结果
      if (message.payload.output.translations) {
        for (const translation of message.payload.output.translations) {
          if (translation.sentence_end) {
            translations[translation.lang || ""] = translation.text || "";
            isSentenceEnd = true;
          }
        }
      } else if (message.payload.output.translation) {
        const translationOutput = message.payload.output.translation;
        if (typeof translationOutput === "object" && translationOutput !== null) {
          const filteredTranslations = Object.fromEntries(
            Object.entries(translationOutput).filter(([_, value]) => {
              const typedValue = value as { sentence_end?: boolean };
              return typedValue?.sentence_end === true;
            })
          );
          Object.entries(filteredTranslations).forEach(([lang, translationObj]) => {
            if (
              translationObj &&
              typeof translationObj === "object" &&
              "text" in translationObj
            ) {
              const typedTranslationObj = translationObj as { text?: string };
              translations[lang] = typedTranslationObj.text || "";
              isSentenceEnd = true;
            }
          });
        }
      }
    }

    // 在检测阶段处理结果 - 只在收到 sentence_end=true 后才判断语言
    if (this.isDetectionPhase && asrResult && isSentenceEnd) {
      this.transcriptionText = asrResult;
      this.detectedLanguage = this.languageConfig.detectLanguage(asrResult);
      const targetLanguage = this.languageConfig.languageMapping[this.detectedLanguage] || "unknown";

      console.log(
        "[auto-detect-bilingual-asr] Language detection result (sentence_end=true):",
        this.detectedLanguage,
        "->",
        targetLanguage,
        "text:",
        asrResult
      );

      const detectionResult: DetectionResult = {
        detectedLanguage: this.detectedLanguage,
        transcriptionText: this.transcriptionText,
        targetLanguage,
      };

      if (this.detectionResultCallback) {
        this.detectionResultCallback(detectionResult);
      }
    }
    // 在翻译阶段处理结果 - 也只处理 sentence_end=true 的完整句子
    else if (this.isTranslationPhase && asrResult && isSentenceEnd) {
      const targetLanguage = this.languageConfig.languageMapping[this.detectedLanguage] || "unknown";

      const translationResult: TranslationResult = {
        detectedLanguage: this.detectedLanguage,
        transcriptionText: asrResult,
        targetLanguage,
        translation: translations[targetLanguage] || "",
      };

      console.log(
        "[auto-detect-bilingual-asr] Translation result (sentence_end=true):",
        translationResult
      );

      if (this.translationResultCallback) {
        this.translationResultCallback(translationResult);
      }
    }
  }

  /**
   * 缓存音频数据
   * @private
   */
  private _cacheAudioData(audioData: Int16Array): void {
    this.audioBuffer = new Int16Array(audioData);
  }

  /**
   * 获取缓存的音频数据
   * @private
   */
  private _getCachedAudioData(): Int16Array | null {
    return this.audioBuffer;
  }

  /**
   * 在实时模式下缓存检测阶段的音频帧
   * @public
   */
  public cacheDetectionAudioFrame(audioFrame: Int16Array): void {
    if (this.isRealtimeMode && this.isDetectionPhase && !this.realtimeSwitched) {
      this.detectionAudioFrames.push(new Int16Array(audioFrame));
      console.log("[auto-detect-bilingual-asr] Cached detection audio frame, total frames:", this.detectionAudioFrames.length);
    }
  }

  /**
   * 获取所有缓存的检测阶段音频数据
   * @private
   */
  private _getCachedDetectionAudioData(): Int16Array | null {
    if (this.detectionAudioFrames.length === 0) {
      return null;
    }

    // 合并所有音频帧
    const totalLength = this.detectionAudioFrames.reduce((sum, frame) => sum + frame.length, 0);
    const combinedAudio = new Int16Array(totalLength);
    let offset = 0;
    for (const frame of this.detectionAudioFrames) {
      combinedAudio.set(frame, offset);
      offset += frame.length;
    }

    console.log("[auto-detect-bilingual-asr] Combined detection audio, total samples:", totalLength, "from", this.detectionAudioFrames.length, "frames");
    return combinedAudio;
  }

  /**
   * 清空检测阶段的音频缓存
   * @private
   */
  private _clearDetectionAudioCache(): void {
    this.detectionAudioFrames = [];
    console.log("[auto-detect-bilingual-asr] Cleared detection audio cache");
  }

  /**
   * 在实时模式下从检测阶段切换到翻译阶段
   * @private
   */
  private async _switchToTranslationPhase(): Promise<void> {
    if (!this.isRealtimeMode || this.realtimeSwitched) {
      return;
    }

    try {
      // 通知 UI 正在进行阶段切换（暂停音频发送）
      if (this.phaseSwitchingCallback) {
        this.phaseSwitchingCallback(true);
      }

      console.log("[auto-detect-bilingual-asr] Switching from detection to translation phase, detected language:", this.detectedLanguage);
      
      // 获取检测阶段的缓存音频
      const cachedDetectionAudio = this._getCachedDetectionAudioData();
      console.log("[auto-detect-bilingual-asr] Retrieved cached detection audio:", cachedDetectionAudio ? cachedDetectionAudio.length + " samples" : "null");
      
      // 标记阶段转换
      this.isDetectionPhase = false;
      this.isTranslationPhase = true;
      this.realtimeSwitched = true;

      // 保存当前的 taskId 用于 stop 操作
      const detectionTaskId = this.taskId;
      console.log("[auto-detect-bilingual-asr] Saved detection task ID:", detectionTaskId);

      // 更新配置为翻译模式
      const targetLanguage = this.languageConfig.languageMapping[this.detectedLanguage] || "unknown";
      
      const translationConfig: AsrConfig = {
        ...this.config,
        parameters: {
          ...this.config.parameters,
          source_language: this.detectedLanguage,
          translation_enabled: true,
          transcription_enabled: true,
          translation_target_languages: [targetLanguage],
        },
      };

      // 停止当前任务（使用保存的 taskId）
      console.log("[auto-detect-bilingual-asr] Stopping detection task...");
      await this.stop();
      console.log("[auto-detect-bilingual-asr] Detection task stopped");

      // 更新配置和生成新的 taskId
      this.config = translationConfig;
      this.taskId = this.generateUUID();
      console.log("[auto-detect-bilingual-asr] Generated new translation task ID:", this.taskId);
      
      console.log("[auto-detect-bilingual-asr] Starting translation task with config:", {
        source_language: this.config.parameters.source_language,
        translation_enabled: this.config.parameters.translation_enabled,
        translation_target_languages: this.config.parameters.translation_target_languages,
      });
      
      // 启动翻译任务
      await this.start();
      console.log("[auto-detect-bilingual-asr] Translation task started, ready to receive audio");

      // 等待一小段时间确保任务状态已完全初始化
      await new Promise(resolve => setTimeout(resolve, 50));
      console.log("[auto-detect-bilingual-asr] Translation task ready, current isTaskStarted state:", this.isTaskStarted);

      // 通知 UI 阶段切换完成（恢复音频发送）
      if (this.phaseSwitchingCallback) {
        this.phaseSwitchingCallback(false);
      }

      // 如果有缓存的音频数据，立即发送给翻译任务
      if (cachedDetectionAudio && cachedDetectionAudio.length > 0) {
        console.log("[auto-detect-bilingual-asr] Sending cached detection audio to translation task:", cachedDetectionAudio.length, "samples");
        try {
          this.sendAudio(cachedDetectionAudio);
          console.log("[auto-detect-bilingual-asr] Cached detection audio sent successfully");
        } catch (error) {
          console.error("[auto-detect-bilingual-asr] Failed to send cached detection audio:", error);
        }
      }
    } catch (error) {
      console.error("[auto-detect-bilingual-asr] Failed to switch phases:", error);
      this.isRealtimeMode = false;
      // 确保通知 UI 阶段切换已完成（或失败）
      if (this.phaseSwitchingCallback) {
        this.phaseSwitchingCallback(false);
      }
    }
  }

  /**
   * 第一轮：检测语言（不翻译）
   * 发送音频进行语言检测
   * @param audioData 音频数据（Int16Array格式）
   * @returns Promise<DetectionResult>
   */
  async detectLanguage(audioData: Int16Array): Promise<DetectionResult> {
    return new Promise(async (resolve, reject) => {
      try {
        // 缓存音频数据以便第二轮使用
        this._cacheAudioData(audioData);

        // 检查连接
        if (!this.isConnected || !this.socket) {
          console.log(
            "[auto-detect-bilingual-asr] WebSocket not connected, opening connection first"
          );
          await this.connect();
        }

        // 设置检测结果回调
        this.detectionResultCallback = (result) => {
          resolve(result);
        };

        this.isDetectionPhase = true;
        this.isTranslationPhase = false;

        // 获取当前配置并修改为检测模式
        const detectionConfig: AsrConfig = {
          ...this.config,
          parameters: {
            ...this.config.parameters,
            source_language: "auto", // 自动检测源语言
            translation_enabled: false, // 仅做识别，不翻译
          },
        };

        // 生成新的任务ID
        this.taskId = this.generateUUID();

        // 发送 run-task 消息
        const runTaskMessage: WebSocketMessage = {
          header: {
            action: "run-task",
            task_id: this.taskId,
            streaming: "duplex",
          },
          payload: detectionConfig,
        };

        this.resolveTaskStarted = () => {
          // 任务启动后立即发送音频
          console.log(
            "[auto-detect-bilingual-asr] Detection task started, sending audio"
          );
          try {
            this.sendAudio(audioData);
          } catch (error) {
            console.error(
              "[auto-detect-bilingual-asr] Failed to send audio:",
              error
            );
            reject(error);
          }
        };

        this.socket?.send(JSON.stringify(runTaskMessage));
        console.log(
          "[auto-detect-bilingual-asr] Sent run-task message for detection:",
          runTaskMessage
        );

        // 设置超时
        const timeout = setTimeout(() => {
          reject(new Error("Detection timeout"));
        }, 10000);

        const originalCallback = this.detectionResultCallback;
        this.detectionResultCallback = (result) => {
          clearTimeout(timeout);
          this.isDetectionPhase = false;

          // 停止检测任务
          this.stop()
            .then(() => {
              if (originalCallback) {
                originalCallback(result);
              }
            })
            .catch((error) => {
              console.error(
                "[auto-detect-bilingual-asr] Failed to stop detection task:",
                error
              );
              if (originalCallback) {
                originalCallback(result);
              }
            });
        };
      } catch (error) {
        console.error("[auto-detect-bilingual-asr] Detection failed:", error);
        reject(error);
      }
    });
  }

  /**
   * 第二轮：获取翻译
   * 根据检测结果发送音频进行翻译
   * @param audioData 音频数据（Int16Array格式），如不提供则使用缓存的音频
   * @param detectedLanguage 检测到的语言（由 detectLanguage 返回）
   * @returns Promise<TranslationResult>
   */
  async getTranslation(
    audioData?: Int16Array,
    detectedLanguage?: string
  ): Promise<TranslationResult> {
    return new Promise(async (resolve, reject) => {
      try {
        // 使用缓存的音频或提供的音频
        let audioToSend = audioData || this._getCachedAudioData();
        if (!audioToSend) {
          throw new Error(
            "No audio data provided and no cached audio available"
          );
        }

        // 使用提供的语言或已检测的语言
        if (detectedLanguage) {
          this.detectedLanguage = detectedLanguage;
        }

        // 检查连接
        if (!this.isConnected || !this.socket) {
          console.log(
            "[auto-detect-bilingual-asr] WebSocket not connected, opening connection first"
          );
          await this.connect();
        }

        // 设置翻译结果回调
        this.translationResultCallback = (result) => {
          resolve(result);
        };

        this.isDetectionPhase = false;
        this.isTranslationPhase = true;

        // 计算目标语言
        const targetLanguage = this.languageConfig.languageMapping[this.detectedLanguage] || "unknown";

        // 获取当前配置并修改为翻译模式
        const translationConfig: AsrConfig = {
          ...this.config,
          parameters: {
            ...this.config.parameters,
            source_language: this.detectedLanguage, // 根据检测结果设置源语言
            transcription_enabled: true,
            translation_enabled: true, // 启用翻译
            translation_target_languages: [targetLanguage], // 根据源语言设置目标语言
          },
        };

        // 生成新的任务ID
        this.taskId = this.generateUUID();

        // 发送 run-task 消息
        const runTaskMessage: WebSocketMessage = {
          header: {
            action: "run-task",
            task_id: this.taskId,
            streaming: "duplex",
          },
          payload: translationConfig,
        };

        this.resolveTaskStarted = () => {
          // 任务启动后立即发送音频
          console.log(
            "[auto-detect-bilingual-asr] Translation task started, sending audio"
          );
          try {
            this.sendAudio(audioToSend!);
          } catch (error) {
            console.error(
              "[auto-detect-bilingual-asr] Failed to send audio:",
              error
            );
            reject(error);
          }
        };

        this.socket?.send(JSON.stringify(runTaskMessage));
        console.log(
          "[auto-detect-bilingual-asr] Sent run-task message for translation:",
          runTaskMessage
        );

        // 设置超时
        const timeout = setTimeout(() => {
          reject(new Error("Translation timeout"));
        }, 10000);

        const originalCallback = this.translationResultCallback;
        this.translationResultCallback = (result) => {
          clearTimeout(timeout);
          this.isTranslationPhase = false;

          // 停止翻译任务
          this.stop()
            .then(() => {
              if (originalCallback) {
                originalCallback(result);
              }
            })
            .catch((error) => {
              console.error(
                "[auto-detect-bilingual-asr] Failed to stop translation task:",
                error
              );
              if (originalCallback) {
                originalCallback(result);
              }
            });
        };
      } catch (error) {
        console.error("[auto-detect-bilingual-asr] Translation failed:", error);
        reject(error);
      }
    });
  }

  /**
   * 完整的双向转译流程（一步到位）
   * 自动执行检测和翻译两个阶段
   * @param audioData 音频数据（Int16Array格式）
   * @returns Promise<TranslationResult>
   */
  async processBilingualTranslation(
    audioData: Int16Array
  ): Promise<TranslationResult> {
    try {
      // 第一步：检测语言
      console.log("[auto-detect-bilingual-asr] Starting detection phase...");
      const detectionResult = await this.detectLanguage(audioData);
      console.log(
        "[auto-detect-bilingual-asr] Detection complete:",
        detectionResult
      );

      // 第二步：获取翻译
      console.log("[auto-detect-bilingual-asr] Starting translation phase...");
      const translationResult = await this.getTranslation(
        audioData,
        detectionResult.detectedLanguage
      );
      console.log(
        "[auto-detect-bilingual-asr] Translation complete:",
        translationResult
      );

      return translationResult;
    } catch (error) {
      console.error("[auto-detect-bilingual-asr] Bilingual translation failed:", error);
      throw error;
    }
  }

  /**
   * 设置检测结果回调
   * @param callback 检测结果回调函数
   */
  setDetectionResultCallback(
    callback: (result: DetectionResult) => void
  ): void {
    this.detectionResultCallback = callback;
  }

  /**
   * 设置翻译结果回调
   * @param callback 翻译结果回调函数
   */
  setTranslationResultCallback(
    callback: (result: TranslationResult) => void
  ): void {
    this.translationResultCallback = callback;
  }

  /**
   * 设置阶段切换回调（仅在实时模式下）
   * @param callback 阶段切换回调函数，参数表示是否正在切换
   */
  setPhaseSwitchingCallback(
    callback: (isSwitching: boolean) => void
  ): void {
    this.phaseSwitchingCallback = callback;
  }

  /**
   * 获取是否在实时模式下
   * @public
   */
  public isInRealtimeMode(): boolean {
    return this.isRealtimeMode;
  }

  /**
   * 获取是否已从检测阶段切换到翻译阶段
   * @public
   */
  public hasRealtimeSwitched(): boolean {
    return this.realtimeSwitched;
  }

  /**
   * 重置实时模式状态（用于开始新的实时转译周期）
   * @public
   */
  public resetRealtimeState(): void {
    console.log("[auto-detect-bilingual-asr] Resetting realtime state");
    this.isRealtimeMode = false;
    this.realtimeSwitched = false;
    this.isDetectionPhase = false;
    this.isTranslationPhase = false;
    this.detectedLanguage = "auto";
    this.transcriptionText = "";
    this._clearDetectionAudioCache();
  }

  /**
   * 启动实时双向转译（流式模式）
   * 自动启用两阶段处理：先检测语言，再翻译
   * @returns Promise<void>
   */
  async startRealtimeTranslation(): Promise<void> {
    console.log("[auto-detect-bilingual-asr] Starting real-time translation mode");
    
    try {
      // 启用实时模式标志
      this.isRealtimeMode = true;
      this.realtimeSwitched = false;
      this.isDetectionPhase = true;
      this.isTranslationPhase = false;
      
      // 以自动检测语言模式启动，translation_enabled 为 false
      // 第一阶段：检测语言
      const detectionConfig: AsrConfig = {
        ...this.config,
        parameters: {
          ...this.config.parameters,
          source_language: "auto",
          translation_enabled: false,
        },
      };

      // 使用父类的 start 方法，但通过覆盖配置
      const originalConfig = { ...this.config };
      this.config = detectionConfig;

      console.log("[auto-detect-bilingual-asr] Calling super.start() with detection config");
      await super.start();
      console.log("[auto-detect-bilingual-asr] Real-time translation mode started, task is ready");
    } catch (error) {
      // 恢复实时模式标志
      this.isRealtimeMode = false;
      console.error("[auto-detect-bilingual-asr] Failed to start real-time translation:", error);
      throw error;
    }
  }
}
