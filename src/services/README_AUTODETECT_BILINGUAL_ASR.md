# AutoDetectBilingualAsrService - 自动检测双语 ASR 服务

## 📋 项目概述

`AutoDetectBilingualAsrService` 是一个继承自 `AliAsrService` 的高级服务类，用于实现**自动检测输入语言并根据检测结果进行双向实时转译**。

### 核心特性

✅ **自动语言检测** - 自动识别输入语言（中文 / 英文）  
✅ **双向转译** - 支持中英文互译  
✅ **连接复用** - 单一 WebSocket 连接处理多个任务  
✅ **异步 API** - 完整的 Promise-based API  
✅ **错误处理** - 完善的错误恢复机制  
✅ **回调支持** - 支持自定义结果和错误回调  

## 📁 文件结构

本项目包含以下文件：

```
src/services/
├── AutoDetectBilingualAsrService.ts              # 核心实现 (📌 主要文件)
├── AutoDetectBilingualAsrService.api.md          # 详细 API 文档
├── AutoDetectBilingualAsrService.example.ts      # 使用示例代码
├── AutoDetectBilingualAsrService.test.example.ts # 测试示例
├── INTEGRATION_GUIDE.md                          # 集成指南
└── README_AUTODETECT_BILINGUAL_ASR.md            # 本文件
```

## 🚀 快速开始

### 最简单的使用方式

```typescript
import { AutoDetectBilingualAsrService } from "./services/AutoDetectBilingualAsrService";
import { GummyConfig } from "./services/AliAsrService";

const config = new GummyConfig();
const service = new AutoDetectBilingualAsrService(config);

try {
  // 一步到位：自动检测语言并翻译
  const result = await service.processBilingualTranslation(audioData);
  
  console.log(`源文本 (${result.detectedLanguage}): ${result.transcriptionText}`);
  console.log(`翻译 (${result.targetLanguage}): ${result.translation}`);
} finally {
  service.disconnect();
}
```

### 分步处理（获得更多控制权）

```typescript
// 打开连接
await service.connect();

// 第一步：检测语言
const detectionResult = await service.detectLanguage(audioData);
console.log(`检测到: ${detectionResult.detectedLanguage}`);

// 第二步：获取翻译
const translationResult = await service.getTranslation(
  audioData,
  detectionResult.detectedLanguage
);
console.log(`翻译: ${translationResult.translation}`);

// 关闭连接
service.disconnect();
```

## 📚 文档导航

| 文档 | 描述 | 何时阅读 |
|------|------|--------|
| **AutoDetectBilingualAsrService.ts** | 核心实现代码 | 需要了解实现细节时 |
| **AutoDetectBilingualAsrService.api.md** | 完整 API 参考 | 需要查询特定方法时 |
| **AutoDetectBilingualAsrService.example.ts** | 6 个实用示例 | 需要具体的使用代码时 |
| **AutoDetectBilingualAsrService.test.example.ts** | 测试示例 | 需要编写测试用例时 |
| **INTEGRATION_GUIDE.md** | 集成实战指南 | 准备集成到项目时 |

## 🔑 核心 API

### 主要方法

#### 1. processBilingualTranslation(audioData)
**一步到位的双向转译**

```typescript
async processBilingualTranslation(audioData: Int16Array): Promise<TranslationResult>
```

自动执行检测和翻译两个阶段，返回完整的翻译结果。

#### 2. detectLanguage(audioData)
**第一轮：检测源语言**

```typescript
async detectLanguage(audioData: Int16Array): Promise<DetectionResult>
```

发送音频进行语言检测，返回检测结果（无翻译）。

#### 3. getTranslation(audioData?, detectedLanguage?)
**第二轮：获取翻译**

```typescript
async getTranslation(audioData?: Int16Array, detectedLanguage?: "zh" | "en" | "auto"): Promise<TranslationResult>
```

根据检测结果进行翻译，返回翻译结果。

#### 4. connect()
**打开 WebSocket 连接**

```typescript
async connect(): Promise<void>
```

建立与阿里云 DashScope 的连接。

#### 5. disconnect()
**关闭 WebSocket 连接**

```typescript
disconnect(): void
```

关闭连接并释放资源。

### 回调方法

```typescript
// 设置检测结果回调
setDetectionResultCallback(callback: (result: DetectionResult) => void): void

// 设置翻译结果回调
setTranslationResultCallback(callback: (result: TranslationResult) => void): void

// 设置错误回调（继承自父类）
setErrorCallback(callback: (error: Error) => void): void
```

## 📊 数据类型

### DetectionResult
```typescript
interface DetectionResult {
  detectedLanguage: "zh" | "en" | "auto";  // 检测到的语言
  transcriptionText: string;                // 转录文本
  targetLanguage: "zh" | "en";             // 推荐的目标语言
}
```

### TranslationResult
```typescript
interface TranslationResult extends DetectionResult {
  translation: string;                     // 翻译文本
}
```

## 💡 使用场景

### 场景 1：实时对话翻译
用于支持多语言的实时聊天或会议应用：

```typescript
const service = new AutoDetectBilingualAsrService(config);
for (const audioChunk of audioChunks) {
  const result = await service.processBilingualTranslation(audioChunk);
  updateUI(result);
}
```

### 场景 2：双语语音命令处理
支持中文和英文的语音命令系统：

```typescript
const detectionResult = await service.detectLanguage(audioData);
const command = parseCommand(
  detectionResult.transcriptionText,
  detectionResult.detectedLanguage
);
```

### 场景 3：音频文件批量转译
处理多个音频文件的批量翻译任务：

```typescript
await service.connect();
for (const file of audioFiles) {
  const result = await service.processBilingualTranslation(audioData);
  saveResult(result);
}
service.disconnect();
```

## ⚙️ 配置说明

### 必需的环境变量

```bash
# 阿里云 DashScope API Key
EXPO_PUBLIC_DASHSCOPE_API_KEY=your_api_key_here
# 或
DASHSCOPE_API_KEY=your_api_key_here
```

### 推荐的服务配置

```typescript
const config = new GummyConfig();
config.parameters.format = "pcm";           // 音频格式
config.parameters.sample_rate = 16000;      // 采样率 16kHz
config.parameters.transcription_enabled = true;  // 启用转录
```

### 音频要求

| 项目 | 要求 |
|------|------|
| **格式** | PCM（原始 PCM 数据）|
| **编码** | 16-bit 有符号整数（Int16Array）|
| **采样率** | 16000 Hz（16 kHz）|
| **通道** | 单声道（Mono）|
| **时长** | 建议 0.5 秒 ~ 60 秒|

## 🔄 工作流程

### 处理流程图

```
用户提供音频数据
        ↓
   [连接 WebSocket]
        ↓
  [第一轮：检测语言]
  发送 run-task (translation_enabled: false)
  发送音频
  收到 result-generated
  根据文本检测语言
        ↓
  [第二轮：获取翻译]
  发送 run-task (translation_enabled: true)
  设置正确的源语言和目标语言
  发送音频
  收到 result-generated
  提取翻译结果
        ↓
   [关闭连接]
        ↓
  返回翻译结果给用户
```

### 连接复用

```
建立连接
    ↓
[任务 1] detectLanguage  → getTranslation
    ↓                        ↓
接收结果 ←────────────────── 接收结果
    ↓
[任务 2] detectLanguage  → getTranslation
    ↓                        ↓
接收结果 ←────────────────── 接收结果
    ↓
关闭连接
```

## ✅ 最佳实践

### ✅ 推荐做法

```typescript
// 1. 使用 try-finally 确保资源释放
const service = new AutoDetectBilingualAsrService(config);
try {
  await service.connect();
  const result = await service.processBilingualTranslation(audioData);
} finally {
  service.disconnect();
}

// 2. 复用连接处理多个任务
await service.connect();
for (const audio of audioList) {
  const result = await service.processBilingualTranslation(audio);
}
service.disconnect();

// 3. 验证输入数据
if (!(audioData instanceof Int16Array)) {
  throw new Error("Audio must be Int16Array");
}

// 4. 处理所有错误
try {
  await service.processBilingualTranslation(audioData);
} catch (error) {
  if (error instanceof Error) {
    console.error(error.message);
  }
}
```

### ❌ 避免做法

```typescript
// ❌ 不要：为每个请求创建新连接
for (const audio of audioList) {
  const service = new AutoDetectBilingualAsrService(config);
  await service.connect();
  const result = await service.processBilingualTranslation(audio);
  service.disconnect();  // 浪费资源
}

// ❌ 不要：忘记关闭连接
const service = new AutoDetectBilingualAsrService(config);
await service.processBilingualTranslation(audioData);
// service.disconnect(); 缺失！

// ❌ 不要：假设音频格式正确
const result = await service.processBilingualTranslation(audioData as Int16Array);

// ❌ 不要：忽略错误
await service.processBilingualTranslation(audioData); // 无错误处理
```

## 🐛 常见问题

### Q: 如何确定语言被正确检测？
A: 服务使用启发式算法检测语言。中文字符占比 > 30% 则判定为中文，否则为英文。如需更精确的检测，可在获得结果后自行实现。

### Q: 为什么翻译结果为空？
A: 可能的原因：
- 音频质量太差
- 语言检测不正确
- API 配额已用尽
- 网络连接问题

### Q: 如何处理超时？
A: 每个请求有 10 秒的超时限制。可以：
- 检查网络连接
- 重试请求
- 使用自定义超时管理

### Q: 可以同时处理多个音频吗？
A: 可以，建议：
- 打开一个连接
- 顺序处理每个音频
- 最后关闭连接

### Q: 支持其他语言吗？
A: 当前仅支持中文和英文转换。如需支持其他语言，需要修改语言检测逻辑。

## 📖 进阶使用

### 自定义错误处理

```typescript
class RobustTranslationService {
  private service: AutoDetectBilingualAsrService;
  private maxRetries = 3;

  async processWithRetry(audioData: Int16Array) {
    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        return await this.service.processBilingualTranslation(audioData);
      } catch (error) {
        if (attempt === this.maxRetries) throw error;
        
        // 指数退避
        await new Promise(resolve =>
          setTimeout(resolve, Math.pow(2, attempt - 1) * 1000)
        );
      }
    }
  }
}
```

### 与 React 集成

```typescript
function useAutoDetectTranslation() {
  const [result, setResult] = useState<TranslationResult | null>(null);
  const [loading, setLoading] = useState(false);
  const serviceRef = useRef<AutoDetectBilingualAsrService | null>(null);

  useEffect(() => {
    serviceRef.current = new AutoDetectBilingualAsrService(new GummyConfig());
    return () => serviceRef.current?.disconnect();
  }, []);

  const translate = useCallback(async (audioData: Int16Array) => {
    setLoading(true);
    try {
      const result = await serviceRef.current!.processBilingualTranslation(audioData);
      setResult(result);
    } finally {
      setLoading(false);
    }
  }, []);

  return { translate, result, loading };
}
```

## 📞 获取帮助

### 文档资源

- 📖 [详细 API 文档](./AutoDetectBilingualAsrService.api.md)
- 💻 [使用示例](./AutoDetectBilingualAsrService.example.ts)
- 🔧 [集成指南](./INTEGRATION_GUIDE.md)
- 🧪 [测试示例](./AutoDetectBilingualAsrService.test.example.ts)

### 调试技巧

```typescript
// 启用详细日志
const service = new AutoDetectBilingualAsrService(config);

// 监听所有回调
service.setDetectionResultCallback((result) => {
  console.log("[Detection]", result);
});

service.setTranslationResultCallback((result) => {
  console.log("[Translation]", result);
});

service.setErrorCallback((error) => {
  console.error("[Error]", error);
});

// 检查连接状态
console.log("Connected:", service.isConnectionOpen());
```

## 📝 版本历史

- **v1.0.0** (2026-02-02)
  - 初始版本发布
  - 支持中英文双向转译
  - 完整的 API 文档和示例

## 📄 许可证

本项目遵循项目主许可证。

---

**祝您使用愉快！** 🎉

如有任何问题或建议，欢迎提交 Issue 或 Pull Request。
