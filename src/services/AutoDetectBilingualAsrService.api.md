# AutoDetectBilingualAsrService API 文档

## 概述

`AutoDetectBilingualAsrService` 是一个继承自 `AliAsrService` 的高级服务类，用于实现自动检测输入语言并根据检测结果进行双向实时转译。该服务通过两轮请求实现完整的转译流程：

1. **第一轮（检测阶段）**：设置 `source_language` 为 `"auto"` 并禁用翻译，仅进行语言识别
2. **第二轮（翻译阶段）**：根据检测结果设置正确的源语言和目标语言，启用翻译功能

## 类定义

```typescript
export class AutoDetectBilingualAsrService extends AliAsrService {
  // 主要方法
  async detectLanguage(audioData: Int16Array): Promise<DetectionResult>
  async getTranslation(audioData?: Int16Array, detectedLanguage?: "zh" | "en"): Promise<TranslationResult>
  async processBilingualTranslation(audioData: Int16Array): Promise<TranslationResult>
  
  // 连接管理（继承自父类）
  async connect(): Promise<void>
  disconnect(): void
  isConnectionOpen(): boolean
  
  // 回调设置
  setDetectionResultCallback(callback: (result: DetectionResult) => void): void
  setTranslationResultCallback(callback: (result: TranslationResult) => void): void
  setErrorCallback(callback: (error: Error) => void): void
  setResultCallback(callback: (result: Record<string, string>) => void): void
}
```

## 数据类型

### DetectionResult
```typescript
interface DetectionResult {
  detectedLanguage: "zh" | "en" | "auto";  // 检测到的源语言
  transcriptionText: string;                 // 源语言的转录文本
  targetLanguage: "zh" | "en";              // 推荐的目标语言（自动计算）
}
```

### TranslationResult
```typescript
interface TranslationResult extends DetectionResult {
  translation: string;                      // 目标语言的翻译文本
}
```

## 核心方法详解

### 1. connect()
**继承自父类，打开 WebSocket 连接**

```typescript
async connect(): Promise<void>
```

**说明**：
- 建立与阿里云 DashScope API 的 WebSocket 连接
- 该连接可以复用于多次任务请求
- 自动处理连接失败和重试

**使用示例**：
```typescript
const service = new AutoDetectBilingualAsrService(config);
await service.connect();
```

### 2. disconnect()
**继承自父类，关闭 WebSocket 连接**

```typescript
disconnect(): void
```

**说明**：
- 关闭 WebSocket 连接
- 释放相关资源
- 连接关闭后无法再发送消息，需要重新调用 `connect()`

**使用示例**：
```typescript
service.disconnect();
```

### 3. detectLanguage(audioData)
**第一轮：检测源语言（不进行翻译）**

```typescript
async detectLanguage(audioData: Int16Array): Promise<DetectionResult>
```

**参数**：
- `audioData: Int16Array` - 音频数据，PCM 格式，16-bit 有符号整数

**返回值**：
- `Promise<DetectionResult>` - 包含检测到的语言和转录文本的结果

**流程**：
1. 自动打开连接（如未连接）
2. 发送 `run-task` 消息，配置 `source_language: "auto"` 和 `translation_enabled: false`
3. 发送音频数据
4. 接收 `result-generated` 事件
5. 根据转录文本自动检测语言（中文 > 30% 中文字符判定为中文，否则为英文）
6. 自动停止任务
7. 返回检测结果

**使用示例**：
```typescript
const audioData = new Int16Array(/* 真实音频数据 */);
const result = await service.detectLanguage(audioData);
console.log(`检测语言: ${result.detectedLanguage}`);
console.log(`转录文本: ${result.transcriptionText}`);
console.log(`目标语言: ${result.targetLanguage}`);
```

### 4. getTranslation(audioData?, detectedLanguage?)
**第二轮：获取翻译（根据检测结果）**

```typescript
async getTranslation(audioData?: Int16Array, detectedLanguage?: "zh" | "en"): Promise<TranslationResult>
```

**参数**：
- `audioData?: Int16Array` - 音频数据（可选）
  - 如果提供，将使用该音频
  - 如果不提供，将使用之前缓存的音频（从 `detectLanguage` 调用）
- `detectedLanguage?: "zh" | "en"` - 检测到的源语言（可选）
  - 如果提供，将使用该语言作为源语言
  - 如果不提供，将使用之前检测的语言

**返回值**：
- `Promise<TranslationResult>` - 包含转录文本和翻译文本的结果

**流程**：
1. 自动打开连接（如未连接）
2. 使用缓存的音频或提供的音频
3. 发送 `run-task` 消息，配置正确的源语言和目标语言
4. 发送音频数据
5. 接收 `result-generated` 事件
6. 提取转录文本和翻译文本
7. 自动停止任务
8. 返回翻译结果

**使用示例**：
```typescript
// 方式 1：复用 detectLanguage 的音频和语言
const detectionResult = await service.detectLanguage(audioData);
const translationResult = await service.getTranslation();

// 方式 2：提供新的音频和语言
const translationResult = await service.getTranslation(audioData, "en");

// 方式 3：只提供语言
const translationResult = await service.getTranslation(undefined, "zh");
```

### 5. processBilingualTranslation(audioData)
**一步到位：完整的双向转译流程**

```typescript
async processBilingualTranslation(audioData: Int16Array): Promise<TranslationResult>
```

**参数**：
- `audioData: Int16Array` - 音频数据，PCM 格式，16-bit 有符号整数

**返回值**：
- `Promise<TranslationResult>` - 包含检测语言、转录文本和翻译文本的完整结果

**流程**：
1. 自动调用 `detectLanguage(audioData)` 进行语言检测
2. 自动调用 `getTranslation(audioData, detectedLanguage)` 进行翻译
3. 返回完整的翻译结果

**使用示例**：
```typescript
const audioData = new Int16Array(/* 真实音频数据 */);
const result = await service.processBilingualTranslation(audioData);
console.log(`检测语言: ${result.detectedLanguage}`);
console.log(`源文本: ${result.transcriptionText}`);
console.log(`目标语言: ${result.targetLanguage}`);
console.log(`翻译: ${result.translation}`);
```

### 6. setDetectionResultCallback(callback)
**设置语言检测结果回调**

```typescript
setDetectionResultCallback(callback: (result: DetectionResult) => void): void
```

**参数**：
- `callback: (result: DetectionResult) => void` - 检测结果回调函数

**说明**：
- 当 `detectLanguage()` 完成时调用
- 用于实时处理检测结果

**使用示例**：
```typescript
service.setDetectionResultCallback((result) => {
  console.log(`语言检测完成: ${result.detectedLanguage}`);
  console.log(`文本: ${result.transcriptionText}`);
});
```

### 7. setTranslationResultCallback(callback)
**设置翻译结果回调**

```typescript
setTranslationResultCallback(callback: (result: TranslationResult) => void): void
```

**参数**：
- `callback: (result: TranslationResult) => void` - 翻译结果回调函数

**说明**：
- 当 `getTranslation()` 或 `processBilingualTranslation()` 完成时调用
- 用于实时处理翻译结果

**使用示例**：
```typescript
service.setTranslationResultCallback((result) => {
  console.log(`翻译完成`);
  console.log(`源文本: ${result.transcriptionText}`);
  console.log(`翻译: ${result.translation}`);
});
```

### 8. setErrorCallback(callback)
**继承自父类，设置错误回调**

```typescript
setErrorCallback(callback: (error: Error) => void): void
```

**参数**：
- `callback: (error: Error) => void` - 错误回调函数

**使用示例**：
```typescript
service.setErrorCallback((error) => {
  console.error(`错误: ${error.message}`);
});
```

## 完整使用流程

### 推荐流程 1：分步骤处理（需要中间结果）

```typescript
const config = new GummyConfig();
const service = new AutoDetectBilingualAsrService(config);

try {
  // 步骤 1: 打开连接
  await service.connect();
  
  // 步骤 2: 检测语言
  const audioData = new Int16Array(/* ... */);
  const detectionResult = await service.detectLanguage(audioData);
  console.log(`检测到: ${detectionResult.detectedLanguage}`);
  
  // 步骤 3: 获取翻译
  const translationResult = await service.getTranslation(audioData, detectionResult.detectedLanguage);
  console.log(`翻译: ${translationResult.translation}`);
  
  // 步骤 4: 关闭连接
  service.disconnect();
} catch (error) {
  console.error(error);
  service.disconnect();
}
```

### 推荐流程 2：一步到位（简单场景）

```typescript
const config = new GummyConfig();
const service = new AutoDetectBilingualAsrService(config);

try {
  const audioData = new Int16Array(/* ... */);
  const result = await service.processBilingualTranslation(audioData);
  
  console.log(`源文本 (${result.detectedLanguage}): ${result.transcriptionText}`);
  console.log(`翻译 (${result.targetLanguage}): ${result.translation}`);
  
  service.disconnect();
} catch (error) {
  console.error(error);
  service.disconnect();
}
```

### 推荐流程 3：连接复用（处理多个音频）

```typescript
const config = new GummyConfig();
const service = new AutoDetectBilingualAsrService(config);

try {
  await service.connect(); // 打开一次连接
  
  const audioChunks = [/* 多个音频数据 */];
  
  for (const audioData of audioChunks) {
    const result = await service.processBilingualTranslation(audioData);
    console.log(`翻译: ${result.translation}`);
  }
  
  service.disconnect(); // 最后关闭连接
} catch (error) {
  console.error(error);
  service.disconnect();
}
```

## 语言检测算法

服务使用简单的启发式算法检测语言：

```typescript
private _detectLanguage(text: string): "zh" | "en" {
  const chineseRegex = /[\u4E00-\u9FFF]/g;
  const chineseCharCount = (text.match(chineseRegex) || []).length;
  const ratio = chineseCharCount / text.length;
  return ratio > 0.3 ? "zh" : "en";
}
```

**规则**：
- 如果中文字符（CJK 统一表意符号）占比 > 30%，判定为中文 (`"zh"`)
- 否则判定为英文 (`"en"`)

## 配置说明

### GummyConfig 推荐配置

```typescript
const config = new GummyConfig();
config.parameters.format = "pcm";                    // 音频格式
config.parameters.sample_rate = 16000;               // 采样率（16kHz）
config.parameters.transcription_enabled = true;      // 启用转录
// 检测阶段会自动设置 translation_enabled = false
// 翻译阶段会自动设置 translation_enabled = true
```

### 音频格式要求

- **格式**：PCM（原始 PCM 数据）
- **采样率**：16000 Hz（16 kHz）
- **编码**：16-bit 有符号整数（Int16Array）
- **通道**：单声道（Mono）

## 错误处理

所有异步方法都可能抛出错误。建议使用 try-catch 进行处理：

```typescript
try {
  const result = await service.processBilingualTranslation(audioData);
  // 处理结果
} catch (error) {
  console.error(`处理失败: ${error.message}`);
  // 错误处理逻辑
} finally {
  service.disconnect();
}
```

### 常见错误

| 错误 | 原因 | 解决方案 |
|------|------|--------|
| `WebSocket not connected` | 连接未建立 | 调用 `connect()` 建立连接 |
| `No audio data provided` | 未提供音频数据 | 提供有效的 Int16Array 音频数据 |
| `Detection timeout` | 检测超时 | 检查网络连接，重试请求 |
| `Translation timeout` | 翻译超时 | 检查网络连接，重试请求 |

## 性能考虑

1. **连接复用**：如果需要处理多个音频，在建立一次连接后复用，而不是为每个音频建立新连接
2. **音频缓存**：服务自动缓存音频数据，第二轮翻译时可以直接复用，无需重新发送
3. **超时设置**：每个请求都有 10 秒的超时限制，确保长时间未响应时能快速失败

## 对象生命周期

```typescript
// 创建实例
const service = new AutoDetectBilingualAsrService(config);

// 打开连接
await service.connect();

// 执行多个转译任务（复用连接）
for (const audioData of audioChunks) {
  const result = await service.processBilingualTranslation(audioData);
}

// 关闭连接
service.disconnect();

// 如果需要再次使用，可以重新调用 connect()
await service.connect();
// ...
```

## 日志输出

服务会输出详细的日志信息用于调试：

```
[auto-detect-bilingual-asr] Starting detection phase...
[auto-detect-bilingual-asr] WebSocket not connected, opening connection first
[auto-detect-bilingual-asr] Opening WebSocket connection
[auto-detect-bilingual-asr] WebSocket connection established.
[auto-detect-bilingual-asr] Sent run-task message for detection
[auto-detect-bilingual-asr] Received task-started
[auto-detect-bilingual-asr] Detection task started, sending audio
[auto-detect-bilingual-asr] Language detection result: en -> zh
[auto-detect-bilingual-asr] Received task-finished
[auto-detect-bilingual-asr] Starting translation phase...
[auto-detect-bilingual-asr] Sent run-task message for translation
[auto-detect-bilingual-asr] Translation complete
```

## 注意事项

1. **必须调用 disconnect()**：使用完毕后务必调用 `disconnect()` 关闭连接，否则可能导致资源泄漏
2. **音频数据格式**：确保提供的是正确格式的 Int16Array，否则会导致识别失败
3. **API Key**：需要在环境变量中设置 `EXPO_PUBLIC_DASHSCOPE_API_KEY` 或 `DASHSCOPE_API_KEY`
4. **超时处理**：如果网络状况不佳，可能会遇到超时错误，建议实现重试逻辑
5. **成本计算**：使用 Gummy 模型进行翻译会产生两次计费（识别一次，翻译一次），请合理安排使用

