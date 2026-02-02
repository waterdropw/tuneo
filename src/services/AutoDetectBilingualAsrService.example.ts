/**
 * AutoDetectBilingualAsrService 使用示例
 * 
 * 该文件展示了如何使用 AutoDetectBilingualAsrService 进行双向实时转译
 */

import { AutoDetectBilingualAsrService, DetectionResult, TranslationResult } from "./AutoDetectBilingualAsrService";
import { GummyConfig } from "./AliAsrService";

/**
 * 示例 1：分步骤使用（推荐用于需要处理中间结果的场景）
 */
export async function example1_StepByStep() {
  console.log("=== Example 1: Step-by-step Processing ===");

  // 创建配置
  const config = new GummyConfig();
  config.parameters.sample_rate = 16000;

  // 创建服务实例
  const service = new AutoDetectBilingualAsrService(config);

  try {
    // 步骤 1: 打开 WebSocket 连接
    console.log("Step 1: Opening WebSocket connection...");
    await service.connect();
    console.log("✓ Connection established");

    // 假设我们有音频数据（Int16Array 格式）
    const audioData = new Int16Array(16000 * 2); // 2 秒的音频
    // ... 填充真实的音频数据 ...

    // 步骤 2: 第一轮 - 检测源语言（不翻译）
    console.log("\nStep 2: Detecting source language...");
    const detectionResult: DetectionResult = await service.detectLanguage(audioData);
    console.log("✓ Detection complete:");
    console.log(`  - Detected Language: ${detectionResult.detectedLanguage}`);
    console.log(`  - Transcription: ${detectionResult.transcriptionText}`);
    console.log(`  - Target Language: ${detectionResult.targetLanguage}`);

    // 步骤 3: 第二轮 - 获取翻译（根据检测结果）
    console.log("\nStep 3: Getting translation...");
    const translationResult: TranslationResult = await service.getTranslation(
      audioData,
      (detectionResult.detectedLanguage as "zh" | "en")
    );
    console.log("✓ Translation complete:");
    console.log(`  - Source Text: ${translationResult.transcriptionText}`);
    console.log(`  - Translation: ${translationResult.translation}`);
    console.log(`  - Target Language: ${translationResult.targetLanguage}`);

    // 步骤 4: 关闭连接
    console.log("\nStep 4: Closing connection...");
    service.disconnect();
    console.log("✓ Connection closed");
  } catch (error) {
    console.error("Error:", error);
    service.disconnect();
  }
}

/**
 * 示例 2：一步到位处理（推荐用于简单场景）
 */
export async function example2_OneShotProcessing() {
  console.log("=== Example 2: One-shot Processing ===");

  // 创建配置
  const config = new GummyConfig();
  config.parameters.sample_rate = 16000;

  // 创建服务实例
  const service = new AutoDetectBilingualAsrService(config);

  try {
    // 假设我们有音频数据（Int16Array 格式）
    const audioData = new Int16Array(16000 * 2); // 2 秒的音频
    // ... 填充真实的音频数据 ...

    // 一步到位处理
    console.log("Processing bilingual translation...");
    const result: TranslationResult = await service.processBilingualTranslation(audioData);

    console.log("✓ Translation result:");
    console.log(`  - Detected Language: ${result.detectedLanguage}`);
    console.log(`  - Source Text: ${result.transcriptionText}`);
    console.log(`  - Target Language: ${result.targetLanguage}`);
    console.log(`  - Translation: ${result.translation}`);

    // 关闭连接
    service.disconnect();
  } catch (error) {
    console.error("Error:", error);
    service.disconnect();
  }
}

/**
 * 示例 3：连接复用处理多段音频
 */
export async function example3_ReuseConnectionForMultipleAudio() {
  console.log("=== Example 3: Reuse Connection for Multiple Audio ===");

  // 创建配置
  const config = new GummyConfig();
  config.parameters.sample_rate = 16000;

  // 创建服务实例
  const service = new AutoDetectBilingualAsrService(config);

  try {
    // 打开一次连接，复用多次
    console.log("Opening WebSocket connection...");
    await service.connect();
    console.log("✓ Connection established");

    // 处理多段音频
    const audioSegments = [
      new Int16Array(16000 * 2), // 第一段音频
      new Int16Array(16000 * 3), // 第二段音频
      new Int16Array(16000 * 1.5), // 第三段音频
    ];
    // ... 填充真实的音频数据 ...

    for (let i = 0; i < audioSegments.length; i++) {
      console.log(`\nProcessing audio segment ${i + 1}...`);
      try {
        const result = await service.processBilingualTranslation(audioSegments[i]);
        console.log(`✓ Segment ${i + 1} complete:`);
        console.log(`  - Source: ${result.transcriptionText}`);
        console.log(`  - Translation: ${result.translation}`);
      } catch (error) {
        console.error(`✗ Segment ${i + 1} failed:`, error);
      }
    }

    // 最后关闭连接
    console.log("\nClosing connection...");
    service.disconnect();
    console.log("✓ Connection closed");
  } catch (error) {
    console.error("Error:", error);
    service.disconnect();
  }
}

/**
 * 示例 4：使用回调处理流式结果
 */
export async function example4_WithCallbacks() {
  console.log("=== Example 4: With Callbacks ===");

  // 创建配置
  const config = new GummyConfig();
  config.parameters.sample_rate = 16000;

  // 创建服务实例
  const service = new AutoDetectBilingualAsrService(config);

  // 设置检测结果回调
  service.setDetectionResultCallback((result: DetectionResult) => {
    console.log("[Detection Callback] Language detected:", result.detectedLanguage);
    console.log("[Detection Callback] Text:", result.transcriptionText);
  });

  // 设置翻译结果回调
  service.setTranslationResultCallback((result: TranslationResult) => {
    console.log("[Translation Callback] Translation received:", result.translation);
  });

  // 设置错误回调
  service.setErrorCallback((error: Error) => {
    console.error("[Error Callback]", error.message);
  });

  try {
    // 假设我们有音频数据
    const audioData = new Int16Array(16000 * 2);
    // ... 填充真实的音频数据 ...

    console.log("Starting bilingual translation with callbacks...");
    const result = await service.processBilingualTranslation(audioData);

    console.log("\nFinal result:");
    console.log(`  - Source: ${result.transcriptionText}`);
    console.log(`  - Translation: ${result.translation}`);

    service.disconnect();
  } catch (error) {
    console.error("Error:", error);
    service.disconnect();
  }
}

/**
 * 示例 5：仅检测语言（不需要翻译）
 */
export async function example5_LanguageDetectionOnly() {
  console.log("=== Example 5: Language Detection Only ===");

  // 创建配置
  const config = new GummyConfig();
  config.parameters.sample_rate = 16000;

  // 创建服务实例
  const service = new AutoDetectBilingualAsrService(config);

  try {
    // 打开连接
    await service.connect();

    // 假设我们有音频数据
    const audioData = new Int16Array(16000 * 2);
    // ... 填充真实的音频数据 ...

    // 仅进行语言检测
    console.log("Detecting language...");
    const detectionResult = await service.detectLanguage(audioData);

    console.log("✓ Language detection result:");
    console.log(`  - Detected Language: ${detectionResult.detectedLanguage}`);
    console.log(`  - Transcription: ${detectionResult.transcriptionText}`);

    // 可以根据检测结果进行其他处理...
    if (detectionResult.detectedLanguage === "zh") {
      console.log("→ Source is Chinese, will translate to English");
    } else {
      console.log("→ Source is English, will translate to Chinese");
    }

    service.disconnect();
  } catch (error) {
    console.error("Error:", error);
    service.disconnect();
  }
}

/**
 * 示例 6：实际应用场景 - 实时双向转译应用
 */
export async function example6_RealtimeBilingualApp() {
  console.log("=== Example 6: Real-time Bilingual Translation App ===");

  // 创建配置（使用 Gummy 模型以支持翻译）
  const config = new GummyConfig();
  config.parameters.sample_rate = 16000;
  config.parameters.transcription_enabled = true;

  // 创建服务实例
  const service = new AutoDetectBilingualAsrService(config);

  try {
    // 建立一次连接
    console.log("Initializing service...");
    await service.connect();
    console.log("✓ Ready for real-time translation");

    // 模拟处理多段音频（来自麦克风、文件等）
    const audioChunks = [
      { id: 1, data: new Int16Array(16000 * 1.5), description: "Chinese speech" },
      { id: 2, data: new Int16Array(16000 * 2), description: "English speech" },
      { id: 3, data: new Int16Array(16000 * 1.2), description: "Another Chinese speech" },
    ];

    for (const chunk of audioChunks) {
      console.log(`\n[Audio ${chunk.id}] Processing ${chunk.description}...`);
      try {
        const result = await service.processBilingualTranslation(chunk.data);

        console.log(`[Audio ${chunk.id}] Results:`);
        console.log(`  Original (${result.detectedLanguage}): ${result.transcriptionText}`);
        console.log(`  Translation (${result.targetLanguage}): ${result.translation}`);
      } catch (error) {
        console.error(`[Audio ${chunk.id}] Processing failed:`, error);
      }
    }

    // 清理资源
    console.log("\nCleaning up...");
    service.disconnect();
    console.log("✓ Service closed");
  } catch (error) {
    console.error("Initialization error:", error);
    service.disconnect();
  }
}
