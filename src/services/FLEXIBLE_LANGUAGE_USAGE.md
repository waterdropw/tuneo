# AutoDetectBilingualAsrService - 灵活语言配置使用指南

## 概述

现在 `AutoDetectBilingualAsrService` 支持**任意语言对**的双向转译！不再局限于中英互译，您可以通过在构造时传入 `BilingualLanguageConfig` 来实现任何语言对的转译。

---

## 核心概念

### BilingualLanguageConfig 接口

```typescript
export interface BilingualLanguageConfig {
  // 源语言到目标语言的映射
  // Key: 源语言代码, Value: 目标语言代码
  languageMapping: Record<string, string>;
  
  // 语言检测函数：根据文本判断检测到的语言
  // 返回值应该是 languageMapping 中的某个键
  detectLanguage: (text: string) => string;
}
```

### DetectionResult 和 TranslationResult

现在这两个接口都支持**任意语言代码**：

```typescript
export interface DetectionResult {
  detectedLanguage: string;  // 检测到的语言代码（任意值）
  transcriptionText: string;  // 转录文本
  targetLanguage: string;     // 推荐的目标语言代码（任意值）
}

export interface TranslationResult extends DetectionResult {
  translation: string;        // 翻译文本
}
```

---

## 使用示例

### 示例 1：默认配置（中英互译）

如果不传入语言配置，会使用默认的中英互译配置：

```typescript
import { AutoDetectBilingualAsrService } from "./services/AutoDetectBilingualAsrService";
import { GummyConfig } from "./services/AliAsrService";

// 不传入 languageConfig，使用默认的中英互译
const config = new GummyConfig();
const service = new AutoDetectBilingualAsrService(config);

const result = await service.processBilingualTranslation(audioData);
// result.detectedLanguage: "zh" 或 "en"
// result.targetLanguage: "en" 或 "zh"
```

---

### 示例 2：日英互译

```typescript
const langConfig = {
  languageMapping: {
    "ja": "en",  // 日文 → 英文
    "en": "ja",  // 英文 → 日文
  },
  detectLanguage: (text: string) => {
    // 简单的启发式检测：如果包含日文字符（平假名/片假名）则为日文
    const japaneseRegex = /[\u3040-\u309F\u30A0-\u30FF]/g;
    const japaneseCharCount = (text.match(japaneseRegex) || []).length;
    const ratio = japaneseCharCount / text.length;
    return ratio > 0.2 ? "ja" : "en";
  }
};

const config = new GummyConfig();
const service = new AutoDetectBilingualAsrService(config, langConfig);

const result = await service.processBilingualTranslation(audioData);
// result.detectedLanguage: "ja" 或 "en"
// result.targetLanguage: "en" 或 "ja"
```

---

### 示例 3：韩英互译

```typescript
const langConfig = {
  languageMapping: {
    "ko": "en",  // 韩文 → 英文
    "en": "ko",  // 英文 → 韩文
  },
  detectLanguage: (text: string) => {
    // 韩文字符范围
    const koreanRegex = /[\uAC00-\uD7AF]/g;
    const koreanCharCount = (text.match(koreanRegex) || []).length;
    const ratio = koreanCharCount / text.length;
    return ratio > 0.3 ? "ko" : "en";
  }
};

const config = new GummyConfig();
const service = new AutoDetectBilingualAsrService(config, langConfig);

const result = await service.processBilingualTranslation(audioData);
```

---

### 示例 4：多语言到英文（一对多）

支持将多个源语言都翻译到同一目标语言：

```typescript
const langConfig = {
  languageMapping: {
    "zh": "en",   // 中文 → 英文
    "ja": "en",   // 日文 → 英文
    "ko": "en",   // 韩文 → 英文
    "de": "en",   // 德文 → 英文
  },
  detectLanguage: (text: string) => {
    // 检测多种语言
    const chineseRegex = /[\u4E00-\u9FFF]/g;
    const japaneseRegex = /[\u3040-\u309F\u30A0-\u30FF]/g;
    const koreanRegex = /[\uAC00-\uD7AF]/g;
    
    const chineseCount = (text.match(chineseRegex) || []).length;
    const japaneseCount = (text.match(japaneseRegex) || []).length;
    const koreanCount = (text.match(koreanRegex) || []).length;
    
    // 找到数量最多的语言
    const max = Math.max(chineseCount, japaneseCount, koreanCount);
    
    if (max === 0) return "de"; // 默认为德文（或其他欧洲语言）
    if (max === chineseCount) return "zh";
    if (max === japaneseCount) return "ja";
    return "ko";
  }
};

const config = new GummyConfig();
const service = new AutoDetectBilingualAsrService(config, langConfig);

const result = await service.processBilingualTranslation(audioData);
// 中文/日文/韩文/德文输入都会被翻译成英文
```

---

### 示例 5：法德互译

```typescript
const langConfig = {
  languageMapping: {
    "fr": "de",  // 法文 → 德文
    "de": "fr",  // 德文 → 法文
  },
  detectLanguage: (text: string) => {
    // 使用更复杂的检测算法
    // 这里仅作示例，实际可以使用 ML 模型
    
    // 法文特有的字符组合：ç, è, é, ê, ë 等
    const frenchPatterns = /[çèéêëàâäùûüôö]/gi;
    const germanPatterns = /[äöüß]/gi;
    
    const frenchScore = (text.match(frenchPatterns) || []).length;
    const germanScore = (text.match(germanPatterns) || []).length;
    
    return frenchScore > germanScore ? "fr" : "de";
  }
};

const config = new GummyConfig();
const service = new AutoDetectBilingualAsrService(config, langConfig);

const result = await service.processBilingualTranslation(audioData);
```

---

## 构造函数说明

```typescript
/**
 * @param config ASR 服务配置（必需）
 *        Type: AsrConfig
 *        Description: 阿里云语音识别服务的配置
 *        Example: new GummyConfig()
 * 
 * @param languageConfig 语言检测和映射配置（可选）
 *        Type: BilingualLanguageConfig | undefined
 *        Description: 如果不提供，将使用默认的中英互译配置
 *        Default: 中英互译（zh ↔ en）
 */
constructor(config: AsrConfig, languageConfig?: BilingualLanguageConfig)
```

---

## 方法说明

### detectLanguage(audioData)

仅进行语言检测，不进行翻译：

```typescript
async detectLanguage(audioData: Int16Array): Promise<DetectionResult>
```

**返回值**：
```typescript
{
  detectedLanguage: "zh",        // 检测到的语言
  transcriptionText: "你好",      // 转录文本
  targetLanguage: "en"           // 根据映射确定的目标语言
}
```

---

### getTranslation(audioData?, detectedLanguage?)

进行翻译（通常在 `detectLanguage` 之后调用）：

```typescript
async getTranslation(
  audioData?: Int16Array,        // 可选，不提供则使用缓存的音频
  detectedLanguage?: string      // 可选，不提供则使用上一步检测的语言
): Promise<TranslationResult>
```

**返回值**：
```typescript
{
  detectedLanguage: "zh",
  transcriptionText: "你好",
  targetLanguage: "en",
  translation: "Hello"           // 新增的翻译文本
}
```

---

### processBilingualTranslation(audioData)

一步到位的完整转译流程：

```typescript
async processBilingualTranslation(audioData: Int16Array): Promise<TranslationResult>
```

自动执行检测和翻译两个阶段。

---

## 最佳实践

### 1. 语言检测函数的最佳实践

```typescript
// ❌ 不好：过于简单的检测
detectLanguage: (text) => {
  return text.includes("中") ? "zh" : "en";
}

// ✅ 好：启发式算法，考虑字符占比
detectLanguage: (text) => {
  const chineseRegex = /[\u4E00-\u9FFF]/g;
  const ratio = (text.match(chineseRegex) || []).length / text.length;
  return ratio > 0.3 ? "zh" : "en";
}

// ✅ 更好：结合多个因素
detectLanguage: (text) => {
  const chineseRegex = /[\u4E00-\u9FFF]/g;
  const chineseCount = (text.match(chineseRegex) || []).length;
  const englishWords = text.split(/\s+/).length;
  
  if (text.length === 0) return "en";
  const chineseRatio = chineseCount / text.length;
  
  if (chineseRatio > 0.3) return "zh";
  if (chineseRatio > 0.1 && englishWords < 3) return "zh";
  return "en";
}
```

### 2. 处理多个源语言映射到同一目标

```typescript
const langConfig = {
  languageMapping: {
    "zh": "en",
    "ja": "en",
    "ko": "en",
    // 所有源语言都映射到英文
  },
  detectLanguage: (text) => {
    // 多语言检测逻辑
    // ...
  }
};
```

### 3. 使用错误处理

```typescript
const service = new AutoDetectBilingualAsrService(config, langConfig);

try {
  const result = await service.processBilingualTranslation(audioData);
  console.log(`${result.detectedLanguage} → ${result.targetLanguage}`);
  console.log(`Translation: ${result.translation}`);
} catch (error) {
  if (error instanceof Error) {
    if (error.message.includes("timeout")) {
      console.error("请求超时");
    } else {
      console.error("处理失败:", error.message);
    }
  }
} finally {
  service.disconnect();
}
```

---

## 高级配置示例

### 使用正则表达式组合进行精确检测

```typescript
const langConfig = {
  languageMapping: {
    "zh": "en",
    "en": "zh",
  },
  detectLanguage: (text: string) => {
    // CJK 统一表意符号
    const cjkRegex = /[\u4E00-\u9FFF\u3040-\u309F\u30A0-\u30FF\uAC00-\uD7AF]/g;
    const cjkCount = (text.match(cjkRegex) || []).length;
    
    // 拉丁字母
    const latinRegex = /[a-zA-Z]/g;
    const latinCount = (text.match(latinRegex) || []).length;
    
    const cjkRatio = cjkCount / text.length;
    const latinRatio = latinCount / text.length;
    
    // 选择比例更高的语言
    return cjkRatio > latinRatio ? "zh" : "en";
  }
};
```

---

## 常见问题

### Q: 可以动态改变语言配置吗？

A: 目前需要创建新的服务实例来改变语言配置：

```typescript
// 改变为日英互译
const japaneseEnglishService = new AutoDetectBilingualAsrService(
  config, 
  japaneseEnglishConfig
);

// 改为回到中英互译
const chineseEnglishService = new AutoDetectBilingualAsrService(config);
```

### Q: detectLanguage 函数可以返回任意字符串吗？

A: 不建议。返回值必须是 `languageMapping` 中的某个键，否则会导致 `targetLanguage` 为 `"unknown"`。

### Q: 如何支持 3 种以上的语言？

A: 您可以创建一个多源到多目标的映射：

```typescript
const langConfig = {
  languageMapping: {
    "zh": "en",
    "en": "zh",
    "ja": "zh",
    // ...
  },
  detectLanguage: (text) => {
    // 检测多种语言
  }
};
```

---

## 总结

现在 `AutoDetectBilingualAsrService` 具有完全的灵活性：

✅ **不再局限于中英文** - 支持任意语言对  
✅ **可自定义语言检测** - 通过 `detectLanguage` 函数  
✅ **可配置语言映射** - 通过 `languageMapping` 对象  
✅ **向后兼容** - 不提供配置时默认为中英互译  

享受灵活的多语言转译体验！🎉
