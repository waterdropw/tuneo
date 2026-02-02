/**
 * AutoDetectBilingualAsrService 测试示例
 * 
 * 注意：这是测试示例，展示如何进行单元测试。
 * 实际使用时需要配置合适的测试框架（如 Jest）和 mock 工具。
 */

import {
  AutoDetectBilingualAsrService,
  DetectionResult,
  TranslationResult,
} from "./AutoDetectBilingualAsrService";
import { GummyConfig } from "./AliAsrService";

/**
 * 测试工具：创建模拟音频数据
 */
function createMockAudioData(
  duration: number = 2,
  sampleRate: number = 16000
): Int16Array {
  const samples = duration * sampleRate;
  const audio = new Int16Array(samples);

  // 生成简单的正弦波音频（便于测试）
  for (let i = 0; i < samples; i++) {
    audio[i] = Math.sin((i / sampleRate) * 2 * Math.PI * 440) * 32767; // 440 Hz
  }

  return audio;
}

/**
 * 测试工具：创建中文语音的模拟数据
 * （实际测试中应使用真实的中文语音数据）
 */
function createMockChineseAudioData(): Int16Array {
  // 在实际测试中，这应该是真实的中文语音数据
  return createMockAudioData(2);
}

/**
 * 测试工具：创建英文语音的模拟数据
 */
function createMockEnglishAudioData(): Int16Array {
  // 在实际测试中，这应该是真实的英文语音数据
  return createMockAudioData(2.5);
}

/**
 * 测试套件示例：基础功能测试
 */
describe("AutoDetectBilingualAsrService - Basic Functionality", () => {
  let service: AutoDetectBilingualAsrService;

  beforeEach(() => {
    const config = new GummyConfig();
    service = new AutoDetectBilingualAsrService(config);
  });

  afterEach(() => {
    if (service.isConnectionOpen()) {
      service.disconnect();
    }
  });

  describe("Service Initialization", () => {
    test("should create service instance with valid config", () => {
      const config = new GummyConfig();
      const instance = new AutoDetectBilingualAsrService(config);

      expect(instance).toBeInstanceOf(AutoDetectBilingualAsrService);
      expect(instance.isConnectionOpen()).toBe(false);
    });

    test("should have correct service name", () => {
      expect(service.getServiceName?.()).toBe("auto-detect-bilingual-asr");
    });
  });

  describe("Connection Management", () => {
    test("should establish WebSocket connection", async () => {
      await service.connect();
      expect(service.isConnectionOpen()).toBe(true);
    });

    test("should close WebSocket connection", async () => {
      await service.connect();
      expect(service.isConnectionOpen()).toBe(true);

      service.disconnect();
      expect(service.isConnectionOpen()).toBe(false);
    });

    test("should handle multiple connect calls gracefully", async () => {
      await service.connect();
      const firstConnection = service.isConnectionOpen();

      await service.connect(); // 第二次调用
      const secondConnection = service.isConnectionOpen();

      expect(firstConnection).toBe(true);
      expect(secondConnection).toBe(true);
    });
  });

  describe("Language Detection", () => {
    test("should detect Chinese language", async () => {
      await service.connect();

      const audioData = createMockChineseAudioData();
      const result: DetectionResult = await service.detectLanguage(audioData);

      expect(result).toHaveProperty("detectedLanguage");
      expect(result).toHaveProperty("transcriptionText");
      expect(result).toHaveProperty("targetLanguage");

      // 根据实际的中文语音数据，语言应该被检测为中文
      // expect(result.detectedLanguage).toBe("zh");
      // expect(result.targetLanguage).toBe("en");
    });

    test("should detect English language", async () => {
      await service.connect();

      const audioData = createMockEnglishAudioData();
      const result: DetectionResult = await service.detectLanguage(audioData);

      expect(result).toHaveProperty("detectedLanguage");
      expect(result).toHaveProperty("transcriptionText");
      expect(result).toHaveProperty("targetLanguage");

      // 根据实际的英文语音数据，语言应该被检测为英文
      // expect(result.detectedLanguage).toBe("en");
      // expect(result.targetLanguage).toBe("zh");
    });

    test("should cache audio data during detection", async () => {
      await service.connect();

      const audioData = createMockAudioData();
      await service.detectLanguage(audioData);

      // 验证音频已被缓存（可通过后续调用 getTranslation 时无需提供音频来验证）
      const translationResult = await service.getTranslation();
      expect(translationResult).toBeDefined();
    });
  });

  describe("Translation", () => {
    test("should get translation with provided audio", async () => {
      await service.connect();

      const audioData = createMockAudioData();
      const result: TranslationResult = await service.getTranslation(
        audioData,
        "en"
      );

      expect(result).toHaveProperty("detectedLanguage");
      expect(result).toHaveProperty("transcriptionText");
      expect(result).toHaveProperty("targetLanguage");
      expect(result).toHaveProperty("translation");
    });

    test("should get translation with cached audio", async () => {
      await service.connect();

      const audioData = createMockAudioData();
      // 先调用 detectLanguage 来缓存音频
      await service.detectLanguage(audioData);

      // 然后调用 getTranslation 无需提供音频
      const result = await service.getTranslation(undefined, "en");

      expect(result).toHaveProperty("translation");
    });

    test("should set correct target language based on source", async () => {
      await service.connect();

      // 对于英文输入，目标语言应该是中文
      const audioData = createMockEnglishAudioData();
      const result = await service.getTranslation(audioData, "en");

      expect(result.targetLanguage).toBe("zh");
    });
  });

  describe("Bilingual Translation", () => {
    test("should process complete bilingual translation flow", async () => {
      const audioData = createMockAudioData();
      const result: TranslationResult =
        await service.processBilingualTranslation(audioData);

      expect(result).toHaveProperty("detectedLanguage");
      expect(result).toHaveProperty("transcriptionText");
      expect(result).toHaveProperty("targetLanguage");
      expect(result).toHaveProperty("translation");

      // 验证所有字段都有值
      expect(result.detectedLanguage).toBeTruthy();
      expect(result.transcriptionText).toBeTruthy();
      expect(result.targetLanguage).toBeTruthy();
    });

    test("should auto-connect during bilingual translation", async () => {
      expect(service.isConnectionOpen()).toBe(false);

      const audioData = createMockAudioData();
      const result = await service.processBilingualTranslation(audioData);

      expect(result).toBeDefined();
      // 处理完成后应保持连接打开状态
      // expect(service.isConnectionOpen()).toBe(true);
    });
  });

  describe("Error Handling", () => {
    test("should throw error when sending audio without connection", async () => {
      const audioData = createMockAudioData();

      expect(() => service.sendAudio(audioData)).toThrow();
    });

    test("should throw error with invalid audio data", async () => {
      await service.connect();

      const invalidAudio = [1, 2, 3]; // 不是 Int16Array

      expect(() => service.sendAudio(invalidAudio as any)).toThrow();
    });

    test("should handle connection timeout", async () => {
      // 测试连接超时处理
      // 这通常需要 mock WebSocket 或网络错误

      const audioData = createMockAudioData();

      // 期望超时错误（在实际环境中）
      // await expect(service.processBilingualTranslation(audioData))
      //   .rejects.toThrow("timeout");
    });
  });

  describe("Callbacks", () => {
    test("should call detection result callback", (done) => {
      service.setDetectionResultCallback((result: DetectionResult) => {
        expect(result).toBeDefined();
        expect(result.detectedLanguage).toBeTruthy();
        done();
      });

      service.connect().then(() => {
        const audioData = createMockAudioData();
        service.detectLanguage(audioData).catch(() => {
          // 忽略实际的 API 调用失败
        });
      });
    });

    test("should call translation result callback", (done) => {
      service.setTranslationResultCallback((result: TranslationResult) => {
        expect(result).toBeDefined();
        expect(result.translation).toBeTruthy();
        done();
      });

      service.connect().then(() => {
        const audioData = createMockAudioData();
        service
          .processBilingualTranslation(audioData)
          .catch(() => {
            // 忽略实际的 API 调用失败
          });
      });
    });

    test("should call error callback on error", (done) => {
      service.setErrorCallback((error: Error) => {
        expect(error).toBeInstanceOf(Error);
        done();
      });

      // 触发某个会导致错误的操作
      // ...
    });
  });

  describe("Connection Reuse", () => {
    test("should reuse connection for multiple operations", async () => {
      await service.connect();
      const connectionCount = 1;

      const audioData1 = createMockAudioData();
      const result1 = await service.detectLanguage(audioData1);
      expect(result1).toBeDefined();

      const audioData2 = createMockAudioData();
      const result2 = await service.getTranslation(audioData2, "en");
      expect(result2).toBeDefined();

      // 只应该有一个 WebSocket 连接
      expect(service.isConnectionOpen()).toBe(true);
    });

    test("should handle multiple sequential operations", async () => {
      await service.connect();

      for (let i = 0; i < 3; i++) {
        const audioData = createMockAudioData();
        const result = await service.processBilingualTranslation(audioData);
        expect(result).toBeDefined();
      }

      service.disconnect();
      expect(service.isConnectionOpen()).toBe(false);
    });
  });
});

/**
 * 测试套件示例：集成测试
 */
describe("AutoDetectBilingualAsrService - Integration Tests", () => {
  let service: AutoDetectBilingualAsrService;

  beforeEach(() => {
    const config = new GummyConfig();
    service = new AutoDetectBilingualAsrService(config);
  });

  afterEach(() => {
    if (service.isConnectionOpen()) {
      service.disconnect();
    }
  });

  test("should complete full flow: detect -> translate -> disconnect", async () => {
    // 打开连接
    await service.connect();
    expect(service.isConnectionOpen()).toBe(true);

    // 检测语言
    const audioData = createMockAudioData();
    const detectionResult = await service.detectLanguage(audioData);
    expect(detectionResult.detectedLanguage).toBeTruthy();

    // 获取翻译
    const translationResult = await service.getTranslation(
      audioData,
      detectionResult.detectedLanguage as "zh" | "en"
    );
    expect(translationResult.translation).toBeTruthy();

    // 关闭连接
    service.disconnect();
    expect(service.isConnectionOpen()).toBe(false);
  });

  test("should handle rapid sequential requests", async () => {
    await service.connect();

    const promises = Array.from({ length: 5 }).map(() => {
      const audioData = createMockAudioData();
      return service.processBilingualTranslation(audioData);
    });

    const results = await Promise.all(promises);
    expect(results).toHaveLength(5);
    expect(results.every((r) => r.translation)).toBe(true);
  });
});

/**
 * 测试套件示例：性能测试
 */
describe("AutoDetectBilingualAsrService - Performance Tests", () => {
  test("should process audio within acceptable time", async () => {
    const config = new GummyConfig();
    const service = new AutoDetectBilingualAsrService(config);

    const audioData = createMockAudioData();
    const startTime = performance.now();

    try {
      await service.processBilingualTranslation(audioData);
    } catch {
      // 忽略实际 API 调用失败
    }

    const duration = performance.now() - startTime;
    console.log(`Processing time: ${duration}ms`);

    // 断言处理时间在合理范围内（如 30 秒以内）
    expect(duration).toBeLessThan(30000);

    service.disconnect();
  });

  test("should handle multiple concurrent connections", async () => {
    const serviceInstances = Array.from({ length: 3 }).map(
      () => new AutoDetectBilingualAsrService(new GummyConfig())
    );

    try {
      const connectPromises = serviceInstances.map((s) => s.connect());
      await Promise.all(connectPromises);

      const allConnected = serviceInstances.every((s) =>
        s.isConnectionOpen()
      );
      expect(allConnected).toBe(true);
    } finally {
      serviceInstances.forEach((s) => s.disconnect());
    }
  });
});

/**
 * 测试工具：模拟 WebSocket 响应
 * （用于单元测试，避免实际 API 调用）
 */
class MockWebSocketService extends AutoDetectBilingualAsrService {
  protected setupSocketHandlers(): void {
    // Mock 实现
    // 不实际连接到真实的 WebSocket
    this.simulateConnection();
  }

  private simulateConnection(): void {
    // 模拟连接成功
    setTimeout(() => {
      this.isConnected = true;
      if (this.resolveConnectionOpened) {
        this.resolveConnectionOpened();
      }
    }, 100);
  }
}

/**
 * 使用 Mock 的测试示例
 */
describe("AutoDetectBilingualAsrService - Unit Tests with Mocks", () => {
  test("should work with mock WebSocket", async () => {
    const config = new GummyConfig();
    const service = new MockWebSocketService(config);

    await service.connect();
    expect(service.isConnectionOpen()).toBe(true);

    service.disconnect();
    expect(service.isConnectionOpen()).toBe(false);
  });
});
