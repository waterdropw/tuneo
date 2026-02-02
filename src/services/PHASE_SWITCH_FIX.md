# 阶段切换状态修复说明

## 问题描述

在实时模式下，当从检测阶段切换到翻译阶段时，`isReady()` 返回 `false`，导致音频回调无法发送新的音频数据给翻译任务。

### 症状日志
```
'[Start] Audio callback triggered, isProcessing:', true, 'hasData:', true, 'isReady:', false
'[Start] Skipping audio send - condition not met. isProcessingRef:', true, 'isReady:', false
```

这发生在：
- 检测任务停止后
- 翻译任务启动前/期间

## 根本原因

1. **时序问题**：`await this.start()` 返回意味着 `task-started` 事件已被接收，但不保证 `isTaskStarted` 立即在音频回调中可见
2. **状态同步问题**：音频回调可能在新任务完全初始化前就被触发
3. **回调时序**：在 Demo 中，音频回调中的 `isReady()` 检查发生在阶段切换的关键时刻

## 解决方案

### 1. 增加阶段切换通知机制

在 `AutoDetectBilingualAsrService` 中添加 `phaseSwitchingCallback`：

```typescript
// 在阶段切换开始时设置为 true
if (this.phaseSwitchingCallback) {
  this.phaseSwitchingCallback(true);
}

// 在阶段切换完成（且新任务已启动）时设置为 false
if (this.phaseSwitchingCallback) {
  this.phaseSwitchingCallback(false);
}

// 即使出现错误也要重置
if (this.phaseSwitchingCallback) {
  this.phaseSwitchingCallback(false);
}
```

### 2. 在 Demo 中使用切换状态标志

在 `BilingualTranslationDemo.tsx` 中：
- 添加 `isPhaseSwitchingRef` 来追踪切换状态
- 在音频回调中检查此标志

```typescript
// 只在准备就绪且不在切换阶段时发送音频
if (isProcessingRef.current && processedData && processedData.data && isReady && !isSwitching) {
  // 发送音频
} else {
  if (isSwitching) {
    console.log("[Start] Skipping audio send - phase switching in progress")
  }
}
```

### 3. 添加初始化延迟

在 `_switchToTranslationPhase()` 中，启动新任务后添加小延迟确保状态完全初始化：

```typescript
// 等待一小段时间确保任务状态已完全初始化
await new Promise(resolve => setTimeout(resolve, 50));
```

## 关键改进

### AutoDetectBilingualAsrService

1. **新方法**：`setPhaseSwitchingCallback()`
   - 让 UI 层能够监听阶段切换状态

2. **改进的 `_switchToTranslationPhase()`**
   - 使用 `async/await` 替代回调链
   - 在切换前后通知 UI
   - 添加初始化延迟确保状态同步
   - 错误时也通知 UI（确保状态恢复）

### BilingualTranslationDemo

1. **新的 ref**：`isPhaseSwitchingRef`
   - 追踪切换状态

2. **改进的音频回调**
   - 在切换期间跳过音频发送
   - 等待新任务完全准备就绪

3. **改进的状态管理**
   - 使用 `isProcessingRef` 避免闭包问题
   - 监听阶段切换并显示状态

## 测试验证

修复后的行为应该是：

1. ✅ 检测阶段开始，音频被缓存
2. ✅ 收到 `sentence_end=true` 的结果，语言被检测到
3. ✅ **阶段切换开始**，`isPhaseSwitchingRef.current = true`
4. ✅ 检测任务停止，翻译任务启动
5. ✅ **阶段切换完成**，`isPhaseSwitchingRef.current = false`
6. ✅ 缓存的检测阶段音频被发送给翻译任务
7. ✅ 新的音频帧开始发送给翻译任务
8. ✅ 翻译结果被接收并显示

## 日志示例

修复后应该看到：
```
[auto-detect-bilingual-asr] Switching from detection to translation phase, detected language: zh
[auto-detect-bilingual-asr] Retrieved cached detection audio: 100800 samples
[BilingualTranslationDemo] Phase switching: true
[Start] Skipping audio send - phase switching in progress
...
[auto-detect-bilingual-asr] Translation task started, ready to receive audio
[auto-detect-bilingual-asr] Sending cached detection audio to translation task: 100800 samples
[BilingualTranslationDemo] Phase switching: false
[Start] Audio data sent successfully
```

## 相关文件

- `src/services/AutoDetectBilingualAsrService.ts` - 核心服务类
- `src/navigation/screens/BilingualTranslationDemo.tsx` - Demo 应用
