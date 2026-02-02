# BilingualTranslationDemo 测试验证指南

## 修复前后对比

### ❌ 问题现象（修复前）
```
启动后有音频数据发送给 ASR，但没有结果返回。
第一次初始化配置不正确：translation_enabled: true
```

### ✅ 预期现象（修复后）
```
第一次请求：translation_enabled: false
第二次请求：translation_enabled: true  
返回识别结果和翻译结果
```

## 测试步骤

### 1. 基础功能测试

**步骤**：
1. 打开应用并进入 BilingualTranslationDemo 页面
2. 点击 "Start" 按钮
3. 说话（例如："你好" 或 "Hello"）
4. 点击 "Stop" 按钮
5. 等待处理完成

**预期结果**：
- ✓ 显示识别的原始文本（例如："你好"）
- ✓ 显示翻译文本（例如："Hello"）
- ✓ 自动播放翻译的语音
- ✓ 显示检测到的语言 (ZH 或 EN)
- ✓ 显示目标语言 (EN 或 ZH)

### 2. 日志验证

**关键日志检查点**：

```
[BilingualTranslationDemo] Initializing services
[Start] Starting audio collection
[Start] Collected audio frame, total frames: 1
[Start] Collected audio frame, total frames: 2
...
[Stop] Stopping audio collection
[Stop] Audio processor stopped
[Stop] Combining X audio frames
[Stop] Combined audio buffer size: XXXX samples
[Stop] Starting bilingual translation processing

// 关键的两个阶段日志：
[auto-detect-bilingual-asr] Starting detection phase...
[auto-detect-bilingual-asr] Detection complete: {...}

[auto-detect-bilingual-asr] Starting translation phase...
[auto-detect-bilingual-asr] Translation complete: {...}

[Stop] Translation result: {transcriptionText: "...", translation: "...", ...}
[TTS] Triggering synthesis for: ...
```

### 3. ASR 请求验证

**需要检查网络请求**：

#### 第一次请求（检测阶段）
```json
{
  "header": {
    "action": "run-task",
    "task_id": "xxx",
    "streaming": "duplex"
  },
  "payload": {
    "parameters": {
      "translation_enabled": false,     // ✅ 必须是 false
      "source_language": "auto"         // ✅ 必须是 auto
    }
  }
}
```

#### 第二次请求（翻译阶段）
```json
{
  "header": {
    "action": "run-task",
    "task_id": "yyy",  // 新的 task_id
    "streaming": "duplex"
  },
  "payload": {
    "parameters": {
      "translation_enabled": true,                      // ✅ 必须是 true
      "source_language": "zh",                          // ✅ 根据检测结果
      "translation_target_languages": ["en"]            // ✅ 根据映射确定
    }
  }
}
```

### 4. 语言对测试

#### 测试中英互译 (zh-en)
- **输入**：说中文（例如："你好"）
- **预期**：
  - 识别结果：你好 (ZH)
  - 翻译结果：Hello (EN)

#### 测试英中互译 (en-zh)
- **改变语言对**到"中英互译"
- **输入**：说英文（例如："Hello"）
- **预期**：
  - 识别结果：Hello (EN)
  - 翻译结果：你好 (ZH)

#### 测试其他语言对（如果配置）
- 英日互译 (en-ja)
- 英韩互译 (en-ko)

## 故障排查

### 问题 1：没有收到翻译结果

**可能原因**：
- ASR 服务连接失败
- 音频帧未正确收集
- 网络延迟过长

**解决步骤**：
1. 检查控制台日志中是否有收集到音频帧
   ```
   [Start] Collected audio frame, total frames: X
   ```
2. 如果 `total frames: 0`，检查麦克风权限
3. 如果日志中止于"Processing translation..."，检查网络连接

### 问题 2：音频无法播放

**可能原因**：
- TTS 服务连接失败
- 翻译结果为空
- 音频格式不兼容

**解决步骤**：
1. 检查 TTS 日志：
   ```
   [TTS] Triggering synthesis for: ...
   [TTS] Connected
   [TTS] Task started
   ```
2. 如果看不到这些日志，检查 TTS 配置
3. 确认 TTS Status 显示"Synthesis finished"而非错误

### 问题 3：语言检测错误

**症状**：
- 说中文但被识别为英文
- 说英文但被识别为中文

**可能原因**：
- 语言检测阈值不适合
- 混合语言输入

**解决步骤**：
1. 检查日志中的"Detection complete"
   ```
   [auto-detect-bilingual-asr] Language detection result: zh -> en
   ```
2. 尝试说得更清楚或更多该语言的文字
3. 如果需要，修改 `detectLanguage` 函数的阈值

## 性能指标

### 预期处理时间
- 音频收集：5-10 秒（用户控制）
- 语言检测：3-5 秒
- 翻译处理：3-5 秒
- TTS 合成：2-3 秒
- **总耗时**：大约 13-23 秒

### 音频大小限制
- 推荐音频长度：5-30 秒
- 音频采样率：16kHz 或 48kHz
- 格式：PCM, 16-bit

## 成功标志

✅ 完整的修复标志：

1. [ ] 第一次请求的 `translation_enabled: false`
2. [ ] 第二次请求的 `translation_enabled: true`
3. [ ] 显示正确识别的源文本
4. [ ] 显示正确的翻译结果
5. [ ] 自动播放翻译的语音
6. [ ] 所有状态更新正确

## 常见用例

### 用例 1：中英对话

```
用户说："你好，我是张三"
↓
识别：你好，我是张三 (ZH)
↓
翻译：Hello, I'm Zhang San (EN)
↓
播放英文语音
```

### 用例 2：会议实时翻译

```
参与者1（中文）：我们需要提高销售额
↓
系统识别并翻译成英文
↓
参与者2（英文）可以听到翻译结果

参与者2（英文）：我同意
↓
系统识别并翻译成中文
↓
参与者1（中文）可以听到翻译结果
```

## 调试技巧

### 启用详细日志
编辑 BilingualTranslationDemo.tsx，增加更多 console.log：

```typescript
console.log("[Debug] AudioFrames length:", audioFramesRef.current.length)
console.log("[Debug] Audio data:", {
  samples: audioData.length,
  bufferSize: audioData.byteLength
})
```

### 检查 WebSocket 消息
在浏览器开发者工具中查看 WebSocket 连接：
1. 打开 DevTools → Network
2. 过滤 WS（WebSocket）
3. 找到 Gummy 或 ASR 连接
4. 查看 Frames 标签查看发送/接收的消息

### 获取完整的错误堆栈
```typescript
catch (error) {
  console.error("[Debug] Full error:", error)
  if (error instanceof Error) {
    console.error("[Debug] Stack:", error.stack)
  }
}
```

## 相关文件

- **主要实现**：`src/navigation/screens/BilingualTranslationDemo.tsx`
- **ASR 服务**：`src/services/AutoDetectBilingualAsrService.ts`
- **基础服务**：`src/services/AliAsrService.ts`
- **TTS 服务**：`src/services/AliTtsService.ts`

## 修复提交信息

```
fix: BilingualTranslationDemo 两阶段 ASR 流程

- 改用批处理模式，先收集完整音频再处理
- 正确实现两阶段流程：
  * 第一阶段：translation_enabled: false（仅识别）
  * 第二阶段：translation_enabled: true（识别+翻译）
- 移除实时流式发送音频的错误做法
- 整合 processBilingualTranslation() 自动化处理
- 修复 TTS 触发位置，避免重复调用

关键改变：
- audio collection 从实时发送改为缓冲收集
- 使用 processBilingualTranslation() 替代手动 start()/sendAudio()
- 改进日志便于调试
```
