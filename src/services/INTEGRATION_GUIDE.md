# AutoDetectBilingualAsrService 集成指南

## 快速开始

### 1. 基础使用

```typescript
import { AutoDetectBilingualAsrService } from "./services/AutoDetectBilingualAsrService";
import { GummyConfig } from "./services/AliAsrService";

// 创建配置和服务实例
const config = new GummyConfig();
const service = new AutoDetectBilingualAsrService(config);

// 执行双向转译
const result = await service.processBilingualTranslation(audioData);
console.log(`源文本 (${result.detectedLanguage}): ${result.transcriptionText}`);
console.log(`翻译 (${result.targetLanguage}): ${result.translation}`);

// 清理资源
service.disconnect();
```

### 2. 完整流程（分步骤）

```typescript
import { AutoDetectBilingualAsrService } from "./services/AutoDetectBilingualAsrService";
import { GummyConfig } from "./services/AliAsrService";

const config = new GummyConfig();
const service = new AutoDetectBilingualAsrService(config);

try {
  // 打开连接
  await service.connect();
  
  // 第一步：检测语言
  const detectionResult = await service.detectLanguage(audioData);
  console.log(`检测到语言: ${detectionResult.detectedLanguage}`);
  
  // 第二步：获取翻译
  const translationResult = await service.getTranslation(
    audioData,
    detectionResult.detectedLanguage
  );
  console.log(`翻译结果: ${translationResult.translation}`);
  
} finally {
  service.disconnect();
}
```

### 3. 处理多段音频（连接复用）

```typescript
const service = new AutoDetectBilingualAsrService(config);

try {
  await service.connect(); // 打开一次连接
  
  // 处理多段音频
  for (const audioChunk of audioChunks) {
    const result = await service.processBilingualTranslation(audioChunk);
    // 处理结果
  }
} finally {
  service.disconnect(); // 最后关闭
}
```

## 环境配置

### 必需的环境变量

确保设置了阿里云 DashScope API Key：

```bash
# 在 .env.local 或 .env 文件中
EXPO_PUBLIC_DASHSCOPE_API_KEY=your_api_key_here

# 或者
DASHSCOPE_API_KEY=your_api_key_here
```

### 项目配置

确保项目支持 WebSocket：

```typescript
// 如果在 React Native 中使用，WebSocket 通常已内置
// 如果在 Web 中使用，大多数浏览器已原生支持
```

## 实际应用场景

### 场景 1：实时对话翻译

用于支持多语言的实时聊天或会议应用：

```typescript
class RealtimeTranslationManager {
  private service: AutoDetectBilingualAsrService;
  
  constructor() {
    const config = new GummyConfig();
    this.service = new AutoDetectBilingualAsrService(config);
    
    this.service.setTranslationResultCallback((result) => {
      this.handleTranslationResult(result);
    });
  }
  
  async processAudioChunk(audioData: Int16Array) {
    try {
      const result = await this.service.processBilingualTranslation(audioData);
      return result;
    } catch (error) {
      console.error("Translation failed:", error);
      throw error;
    }
  }
  
  private handleTranslationResult(result: TranslationResult) {
    // 更新 UI，显示翻译结果
    this.updateTranslationUI({
      source: {
        language: result.detectedLanguage,
        text: result.transcriptionText
      },
      target: {
        language: result.targetLanguage,
        text: result.translation
      }
    });
  }
  
  cleanup() {
    this.service.disconnect();
  }
}
```

### 场景 2：支持双语的语音命令处理

```typescript
class BilingualVoiceCommandProcessor {
  private service: AutoDetectBilingualAsrService;
  
  constructor() {
    const config = new GummyConfig();
    this.service = new AutoDetectBilingualAsrService(config);
  }
  
  async processVoiceCommand(audioData: Int16Array) {
    try {
      // 仅检测语言和识别，不需要翻译
      const detectionResult = await this.service.detectLanguage(audioData);
      
      // 根据识别文本和检测到的语言处理命令
      const command = this.parseCommand(
        detectionResult.transcriptionText,
        detectionResult.detectedLanguage
      );
      
      return command;
    } catch (error) {
      console.error("Voice command processing failed:", error);
      throw error;
    } finally {
      this.service.disconnect();
    }
  }
  
  private parseCommand(text: string, language: string) {
    // 根据语言和文本解析命令
    // ...
  }
}
```

### 场景 3：音频文件批量处理

```typescript
class AudioBatchProcessor {
  private service: AutoDetectBilingualAsrService;
  private results: TranslationResult[] = [];
  
  constructor() {
    const config = new GummyConfig();
    this.service = new AutoDetectBilingualAsrService(config);
  }
  
  async processBatch(audioFiles: AudioFile[]): Promise<TranslationResult[]> {
    this.results = [];
    
    try {
      // 建立一次连接，处理所有文件
      await this.service.connect();
      
      for (const file of audioFiles) {
        try {
          const audioData = await this.loadAudioFile(file);
          const result = await this.service.processBilingualTranslation(audioData);
          this.results.push(result);
          
          // 定期保存进度
          if (this.results.length % 10 === 0) {
            await this.saveProgress();
          }
        } catch (error) {
          console.error(`Failed to process ${file.name}:`, error);
          // 继续处理下一个文件
        }
      }
      
      return this.results;
    } finally {
      this.service.disconnect();
    }
  }
  
  private async loadAudioFile(file: AudioFile): Promise<Int16Array> {
    // 加载音频文件并转换为 Int16Array
    // ...
  }
  
  private async saveProgress() {
    // 保存处理进度到本地存储或数据库
    // ...
  }
}
```

## 集成到现有组件

### React Hook 集成

```typescript
import { useCallback, useEffect, useRef, useState } from "react";
import {
  AutoDetectBilingualAsrService,
  TranslationResult,
} from "./services/AutoDetectBilingualAsrService";
import { GummyConfig } from "./services/AliAsrService";

function useAutoDetectTranslation() {
  const serviceRef = useRef<AutoDetectBilingualAsrService | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [result, setResult] = useState<TranslationResult | null>(null);

  useEffect(() => {
    // 初始化服务
    const config = new GummyConfig();
    serviceRef.current = new AutoDetectBilingualAsrService(config);

    // 清理
    return () => {
      serviceRef.current?.disconnect();
    };
  }, []);

  const processAudio = useCallback(async (audioData: Int16Array) => {
    if (!serviceRef.current) return;

    setLoading(true);
    setError(null);

    try {
      const result = await serviceRef.current.processBilingualTranslation(
        audioData
      );
      setResult(result);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      setError(error);
      console.error("Translation error:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  return { processAudio, loading, error, result };
}

// 使用示例
export function TranslationComponent() {
  const { processAudio, loading, error, result } = useAutoDetectTranslation();

  const handleAudioData = async (audioData: Int16Array) => {
    await processAudio(audioData);
  };

  return (
    <div>
      {loading && <p>处理中...</p>}
      {error && <p style={{ color: "red" }}>错误: {error.message}</p>}
      {result && (
        <div>
          <p>源语言 ({result.detectedLanguage}): {result.transcriptionText}</p>
          <p>翻译 ({result.targetLanguage}): {result.translation}</p>
        </div>
      )}
      <button onClick={() => handleAudioData(audioData)}>翻译音频</button>
    </div>
  );
}
```

### React Native 集成

```typescript
import {
  AutoDetectBilingualAsrService,
  TranslationResult,
} from "./services/AutoDetectBilingualAsrService";
import { GummyConfig } from "./services/AliAsrService";
import { useCallback, useEffect, useRef, useState } from "react";

export const BilingualTranslationScreen = () => {
  const serviceRef = useRef<AutoDetectBilingualAsrService | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<TranslationResult | null>(null);

  useEffect(() => {
    const config = new GummyConfig();
    serviceRef.current = new AutoDetectBilingualAsrService(config);

    return () => {
      serviceRef.current?.disconnect();
    };
  }, []);

  const handleRecordingFinished = useCallback(
    async (audioData: Int16Array) => {
      if (!serviceRef.current) return;

      setLoading(true);
      try {
        const result = await serviceRef.current.processBilingualTranslation(
          audioData
        );
        setResult(result);
      } catch (error) {
        console.error("Translation failed:", error);
      } finally {
        setLoading(false);
      }
    },
    []
  );

  return (
    // UI 实现
    <></>
  );
};
```

## 性能优化建议

### 1. 连接复用

```typescript
// ❌ 不好：为每个请求创建新连接
for (const audio of audios) {
  const service = new AutoDetectBilingualAsrService(config);
  const result = await service.processBilingualTranslation(audio);
  service.disconnect();
}

// ✅ 好：复用单一连接
const service = new AutoDetectBilingualAsrService(config);
await service.connect();
for (const audio of audios) {
  const result = await service.processBilingualTranslation(audio);
}
service.disconnect();
```

### 2. 错误恢复

```typescript
async function processWithRetry(
  audioData: Int16Array,
  maxRetries: number = 3
) {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const service = new AutoDetectBilingualAsrService(new GummyConfig());
      const result = await service.processBilingualTranslation(audioData);
      service.disconnect();
      return result;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      console.log(`Attempt ${attempt} failed, retrying...`);

      if (attempt < maxRetries) {
        // 指数退避
        await new Promise((resolve) =>
          setTimeout(resolve, Math.pow(2, attempt - 1) * 1000)
        );
      }
    }
  }

  throw lastError;
}
```

### 3. 超时管理

```typescript
function createServiceWithTimeout(
  timeoutMs: number = 30000
): AutoDetectBilingualAsrService {
  const service = new AutoDetectBilingualAsrService(new GummyConfig());

  const originalProcess = service.processBilingualTranslation.bind(service);
  service.processBilingualTranslation = async (audioData: Int16Array) => {
    return Promise.race([
      originalProcess(audioData),
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error("Translation timeout")),
          timeoutMs
        )
      ),
    ]);
  };

  return service as AutoDetectBilingualAsrService;
}
```

## 故障排除

### 问题 1：连接失败

**症状**：`WebSocket connection failed` 错误

**解决方案**：
- 检查 API Key 是否正确设置
- 检查网络连接
- 验证 DashScope 服务是否可用

```typescript
try {
  const config = new GummyConfig();
  const service = new AutoDetectBilingualAsrService(config);
  await service.connect();
  console.log("✓ Connection successful");
} catch (error) {
  console.error("✗ Connection failed:", error);
  // 检查 API Key 和网络
}
```

### 问题 2：识别失败（无结果）

**症状**：`result-generated` 事件不返回任何文本

**解决方案**：
- 检查音频格式是否正确（必须是 Int16Array）
- 检查采样率是否为 16000 Hz
- 确保音频包含实际的语音数据

```typescript
// 验证音频格式
function validateAudioData(audioData: Int16Array) {
  if (!(audioData instanceof Int16Array)) {
    throw new Error("Audio must be Int16Array");
  }

  if (audioData.length === 0) {
    throw new Error("Audio is empty");
  }

  // 检查是否有非零的音频数据
  const hasAudio = Array.from(audioData).some((sample) => Math.abs(sample) > 100);
  if (!hasAudio) {
    console.warn("Audio appears to be silent");
  }

  return true;
}

// 使用验证
const audioData = new Int16Array(/* ... */);
validateAudioData(audioData);
const result = await service.processBilingualTranslation(audioData);
```

### 问题 3：语言检测不准确

**症状**：检测到错误的语言

**解决方案**：
- 语言检测基于启发式算法（中文字符 > 30%）
- 如果需要更准确的检测，可以自定义检测逻辑

```typescript
// 自定义语言检测（如需要）
class CustomLanguageDetector {
  static detect(text: string): "zh" | "en" {
    // 自定义检测逻辑
    // 例如：使用 ML 模型、外部 API 等

    // 回退到默认启发式
    const chineseRegex = /[\u4E00-\u9FFF]/g;
    const ratio = (text.match(chineseRegex) || []).length / text.length;
    return ratio > 0.3 ? "zh" : "en";
  }
}
```

### 问题 4：翻译结果为空

**症状**：获得转录文本但没有翻译

**解决方案**：
- 确保 `translation_enabled` 已设置为 `true`（服务会自动设置）
- 检查是否配置了目标语言
- 验证翻译模型是否支持源语言和目标语言对

```typescript
// 调试翻译配置
async function debugTranslation() {
  const config = new GummyConfig();
  console.log("Translation config:", {
    translation_enabled: config.parameters.translation_enabled,
    source_language: config.parameters.source_language,
    target_languages: config.parameters.translation_target_languages,
  });

  const service = new AutoDetectBilingualAsrService(config);
  const result = await service.processBilingualTranslation(audioData);

  console.log("Translation result:", result);
  if (!result.translation) {
    console.warn("No translation received");
  }
}
```

## 最佳实践

1. **始终关闭连接**：使用 try-finally 确保资源释放

```typescript
const service = new AutoDetectBilingualAsrService(config);
try {
  await service.connect();
  // 执行操作
} finally {
  service.disconnect();
}
```

2. **处理错误**：为所有异步操作添加错误处理

```typescript
try {
  const result = await service.processBilingualTranslation(audioData);
} catch (error) {
  if (error instanceof Error) {
    if (error.message.includes("timeout")) {
      // 处理超时
    } else if (error.message.includes("connection")) {
      // 处理连接错误
    } else {
      // 处理其他错误
    }
  }
}
```

3. **验证输入**：确保音频数据有效

```typescript
function validateAndProcess(audioData: unknown) {
  if (!(audioData instanceof Int16Array)) {
    throw new TypeError("Audio must be Int16Array");
  }

  if (audioData.length < 16000) {
    console.warn("Audio is very short, may not provide good results");
  }

  return audioData;
}
```

4. **监控性能**：记录处理时间和成功率

```typescript
async function processWithMetrics(audioData: Int16Array) {
  const startTime = Date.now();

  try {
    const result = await service.processBilingualTranslation(audioData);
    const duration = Date.now() - startTime;

    console.log(`✓ Success in ${duration}ms`);
    return result;
  } catch (error) {
    const duration = Date.now() - startTime;
    console.log(`✗ Failed after ${duration}ms:`, error);
    throw error;
  }
}
```

## 参考资源

- [AliAsrService API 文档](./AliAsrService.ts)
- [BaseWebSocketService 文档](./BaseWebSocketService.ts)
- [阿里云 DashScope API 文档](https://dashscope.aliyun.com)
- [使用示例](./AutoDetectBilingualAsrService.example.ts)
- [详细 API 文档](./AutoDetectBilingualAsrService.api.md)
