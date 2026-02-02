# 双向实时转译优化 - 修复总结

## 问题

切换模式之后状态不对，音频无法发送给翻译任务。根据日志：

```
'[Start] Audio callback triggered, isProcessing:', true, 'hasData:', true, 'isReady:', false
'[Start] Skipping audio send - condition not met. isProcessingRef:', true, 'isReady:', false
```

这发生在从检测阶段切换到翻译阶段后。

## 根本原因分析

1. **时序问题**：`await this.start()` 返回并不保证 `isTaskStarted` 在音频回调中立即可见
2. **状态同步延迟**：新任务启动和实际准备好接收音频之间存在间隔
3. **缺乏切换通知**：UI 层无法知道何时阶段切换正在进行

## 修复方案

### 1. AutoDetectBilingualAsrService.ts 中的修改

#### 新增字段
```typescript
private phaseSwitchingCallback: ((isSwitching: boolean) => void) | null = null;
```

#### 新增方法
- `cacheDetectionAudioFrame(audioFrame: Int16Array)` - 缓存检测阶段的音频帧
- `setPhaseSwitchingCallback(callback)` - 设置阶段切换回调
- `isInRealtimeMode()` - 获取实时模式状态
- `hasRealtimeSwitched()` - 获取是否已切换
- `resetRealtimeState()` - 重置实时模式状态

#### 改进的方法
- `_switchToTranslationPhase()` - 从 `void` 改为 `async Promise<void>`
  - 在切换开始时调用 `phaseSwitchingCallback(true)`
  - 在切换完成时调用 `phaseSwitchingCallback(false)`
  - 添加 50ms 初始化延迟
  - 更好的日志记录
  - 错误时也确保回调被调用

- `_handleDetectionOrTranslationResult()` - 改进的结果处理
  - 只在 `sentence_end=true` 时才进行语言检测和翻译处理
  - 更详细的日志

### 2. BilingualTranslationDemo.tsx 中的修改

#### 新增状态管理
```typescript
const isPhaseSwitchingRef = useRef(false)  // 追踪阶段切换状态
const isProcessingRef = useRef(false)      // 追踪处理状态
```

#### 设置回调
```typescript
bilingualAsrService.setPhaseSwitchingCallback((isSwitching) => {
  console.log("[BilingualTranslationDemo] Phase switching:", isSwitching)
  isPhaseSwitchingRef.current = isSwitching
  if (isSwitching) {
    setStatus("Switching to translation phase...")
  }
})
```

#### 改进的音频回调逻辑
```typescript
audioProcessor.startProcessing((processedData) => {
  const isReady = asrService.isReady()
  const isSwitching = isPhaseSwitchingRef.current
  
  // 只在准备就绪且不在切换阶段时发送音频
  if (isProcessingRef.current && processedData && processedData.data && isReady && !isSwitching) {
    // 发送音频
  }
})
```

## 关键改进点

### 1. 明确的阶段切换通知
- 服务层通过回调通知 UI 何时切换开始/完成
- UI 层能够暂停/恢复音频发送

### 2. 状态初始化延迟
- 新任务启动后等待 50ms 确保状态完全初始化
- 避免在状态不完整时尝试发送音频

### 3. 完整的音频缓存
- 检测阶段的所有音频帧都被缓存
- 切换到翻译阶段时全部重发
- 防止漏词

### 4. 更好的日志记录
- 阶段切换的每一步都有详细日志
- 便于调试和问题排查

## 预期行为

修复后的完整流程：

1. ✅ **检测阶段开始**
   - 收到音频数据
   - 缓存音频帧
   - 发送给 ASR 服务

2. ✅ **语言检测**
   - 收到 `sentence_end=true` 的结果
   - 进行语言检测

3. ✅ **阶段切换**
   - 调用 `phaseSwitchingCallback(true)`
   - UI 更新 `isPhaseSwitchingRef.current = true`
   - 音频回调开始跳过音频发送

4. ✅ **任务切换**
   - 停止检测任务
   - 启动翻译任务
   - 等待 50ms 初始化

5. ✅ **切换完成**
   - 调用 `phaseSwitchingCallback(false)`
   - UI 更新 `isPhaseSwitchingRef.current = false`
   - 发送缓存的检测阶段音频

6. ✅ **翻译阶段**
   - 音频回调恢复，继续发送新音频
   - 接收翻译结果
   - 播放 TTS

## 测试验证清单

- [ ] 启动实时转译，说话
- [ ] 检查阶段切换日志是否正确
- [ ] 验证缓存音频是否被发送
- [ ] 检查是否能接收到翻译结果
- [ ] 验证 UI 状态更新是否正确
- [ ] 测试多次切换是否稳定
- [ ] 检查错误处理是否正确

## 修改的文件

1. `/src/services/AutoDetectBilingualAsrService.ts`
2. `/src/navigation/screens/BilingualTranslationDemo.tsx`
3. `/src/services/PHASE_SWITCH_FIX.md` (新文件)
