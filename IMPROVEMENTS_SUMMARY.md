# 实时双向转译服务改进总结

## 核心改进

### 1. 延迟语言检测 - 等待完整句子（`sentence_end=true`）

**目标**：避免频繁检测，确保每个完整句子只进行一次语言检测

**实现**：
- 在 `_handleDetectionOrTranslationResult()` 中追踪 `isSentenceEnd` 标志
- 只在 `isSentenceEnd=true` 时才进行语言检测和翻译处理
- 支持多种消息格式（`text`、`sentence`、`transcription`、`translations`）

**变更代码**：
```typescript
// 旧逻辑：每条消息都可能触发检测
if (this.isDetectionPhase && asrResult) {
  // 检测语言...
}

// 新逻辑：只在收到完整句子时才检测
if (this.isDetectionPhase && asrResult && isSentenceEnd) {
  // 检测语言...
}
```

**优点**：
- 减少无效的语言检测次数
- 提高检测准确率（完整句子包含更多信息）
- 提升实时体验（每个完整结果只处理一次）

---

### 2. 检测阶段音频缓存 - 完整缓存所有音频帧

**目标**：保留检测阶段的所有音频数据，以便在翻译阶段完整重放

**实现**：

#### 2.1 新增音频缓冲机制

在 `AutoDetectBilingualAsrService` 中添加：
```typescript
// 实时模式下的音频缓冲
private detectionAudioFrames: Int16Array[] = [];  // 检测阶段的所有音频帧

/**
 * 在实时模式下缓存检测阶段的音频帧
 * @public
 */
public cacheDetectionAudioFrame(audioFrame: Int16Array): void {
  if (this.isRealtimeMode && this.isDetectionPhase && !this.realtimeSwitched) {
    this.detectionAudioFrames.push(new Int16Array(audioFrame));
  }
}

/**
 * 获取所有缓存的检测阶段音频数据
 * @private
 */
private _getCachedDetectionAudioData(): Int16Array | null {
  // 合并所有音频帧成一个连续的 Int16Array
}
```

#### 2.2 Demo 中的集成

在 `BilingualTranslationDemo.tsx` 的音频处理回调中：
```typescript
audioProcessor.startProcessing((processedData) => {
  if (isProcessingRef.current && processedData && asrService.isReady()) {
    // Cache detection phase audio frames for later use
    asrService.cacheDetectionAudioFrame(processedData.data)
    
    // Send to ASR
    asrService.sendAudio(processedData.data)
  }
})
```

**流程**：
1. 检测阶段：每收到一个音频帧就缓存它
2. 检测完成：积累了完整的音频数据
3. 自动切换到翻译阶段
4. 翻译阶段：立即发送缓存的完整音频

**优点**：
- 避免丢词：检测阶段的所有音频都被保留
- 完整性：翻译阶段收到完全相同的音频
- 准确性：翻译结果基于完整的音频上下文

---

### 3. 自动阶段切换优化 - 完整的缓存音频重放

**目标**：在从检测阶段切换到翻译阶段时，自动重放缓存的音频

**实现**：

在 `_switchToTranslationPhase()` 中：
```typescript
private async _switchToTranslationPhase(): Promise<void> {
  // 1. 获取检测阶段的缓存音频
  const cachedDetectionAudio = this._getCachedDetectionAudioData();
  
  // 2. 停止检测任务
  await this.stop();
  
  // 3. 启动翻译任务
  await this.start();
  
  // 4. 立即发送缓存的完整音频
  if (cachedDetectionAudio && cachedDetectionAudio.length > 0) {
    this.sendAudio(cachedDetectionAudio);
  }
}
```

**工作流**：
```
检测阶段                  翻译阶段
└─ 缓存音频 1 ┐
└─ 缓存音频 2 ├─→ 合并 → 完整音频 → 翻译任务
└─ 缓存音频 3 ┘
```

---

### 4. 实时模式状态管理

**新增公开 API**：

```typescript
/**
 * 获取是否在实时模式下
 */
public isInRealtimeMode(): boolean

/**
 * 获取是否已从检测阶段切换到翻译阶段
 */
public hasRealtimeSwitched(): boolean

/**
 * 重置实时模式状态（用于开始新的实时转译周期）
 */
public resetRealtimeState(): void
```

**用途**：
- 允许 Demo 查询当前状态
- 在停止服务时清理所有状态和缓存
- 为下一个实时转译周期做准备

---

## 完整流程说明

### 实时双向转译流程

```
用户点击 Start
  ↓
调用 startRealtimeTranslation()
  ├─ 启用实时模式
  ├─ 设置 isDetectionPhase = true
  └─ 启动 ASR 检测任务（translation_enabled = false）
  
用户说话，实时发送音频
  ├─ 每个音频帧都被缓存：cacheDetectionAudioFrame()
  ├─ 每个音频帧都被发送给 ASR：sendAudio()
  └─ ASR 实时返回中间结果
  
收到 result-generated with sentence_end=true
  ├─ 调用 _handleDetectionOrTranslationResult()
  ├─ 检测语言
  └─ 触发自动切换：_switchToTranslationPhase()
  
自动切换到翻译阶段
  ├─ 获取缓存的检测阶段音频
  ├─ 停止检测任务
  ├─ 启动翻译任务（source_language = 检测到的语言）
  ├─ 重放缓存的完整音频
  └─ 翻译任务返回翻译结果
  
收到 result-generated with sentence_end=true (翻译)
  ├─ 调用翻译结果回调
  ├─ Demo 触发 TTS
  └─ 用户听到翻译结果

用户继续说话
  ├─ 继续在翻译阶段接收音频
  └─ 继续返回翻译结果

用户点击 Stop
  ├─ 停止音频处理
  ├─ 停止 ASR 任务
  ├─ 重置实时模式状态
  └─ 清空音频缓存
```

---

## 关键变更总结

### `AutoDetectBilingualAsrService.ts`

| 变更 | 类型 | 影响 |
|-----|------|------|
| 添加 `detectionAudioFrames` | 新增属性 | 缓存检测阶段音频 |
| 修改 `_handleDetectionOrTranslationResult()` | 改进逻辑 | 等待 `sentence_end=true` |
| 添加 `cacheDetectionAudioFrame()` | 新增方法 | 公开缓存接口 |
| 添加 `_getCachedDetectionAudioData()` | 新增方法 | 合并音频帧 |
| 修改 `_switchToTranslationPhase()` | 改进逻辑 | 重放缓存音频 |
| 添加 `isInRealtimeMode()` | 新增方法 | 查询实时模式状态 |
| 添加 `hasRealtimeSwitched()` | 新增方法 | 查询阶段切换状态 |
| 添加 `resetRealtimeState()` | 新增方法 | 重置并清理状态 |

### `BilingualTranslationDemo.tsx`

| 变更 | 类型 | 影响 |
|-----|------|------|
| 添加 `isProcessingRef` | 新增 Ref | 闭包问题修复 |
| 修改音频处理回调 | 改进逻辑 | 调用 `cacheDetectionAudioFrame()` |
| 修改 `handleStopProcessing()` | 改进逻辑 | 调用 `resetRealtimeState()` |

---

## 优化效果

### 问题解决
1. ✅ **频繁检测问题**：现在只在完整句子（`sentence_end=true`）时检测
2. ✅ **音频不完整问题**：检测阶段的所有音频都被缓存并重放给翻译阶段
3. ✅ **漏词问题**：完整的音频上下文确保翻译准确
4. ✅ **状态管理**：新增 API 清晰地管理实时模式的生命周期

### 性能提升
- 减少无效的语言检测
- 减少中间结果处理的开销
- 确保翻译质量（完整音频 = 完整上下文）

### 用户体验
- 实时流式处理保持连贯
- 翻译结果更准确（完整上下文）
- 响应速度更快（异步处理优化）

---

## 测试建议

1. **语言检测准确性**：说出完整句子，验证语言检测是否准确
2. **翻译完整性**：说出长句子，验证是否有漏词或结构错误
3. **实时流畅性**：检查日志中是否有频繁的阶段切换
4. **TTS 播放**：验证翻译后 TTS 播放是否正常
5. **状态重置**：重复点击 Start/Stop，验证状态是否正确重置

---

## 日志关键字

查看日志时，搜索以下关键词：
- `[auto-detect-bilingual-asr] Language detection result (sentence_end=true)` - 语言检测成功
- `[auto-detect-bilingual-asr] Switching from detection to translation phase` - 阶段切换开始
- `[auto-detect-bilingual-asr] Cached detection audio frame` - 音频缓存
- `[auto-detect-bilingual-asr] Sending cached detection audio to translation task` - 音频重放
- `[auto-detect-bilingual-asr] Translation result (sentence_end=true)` - 翻译结果
