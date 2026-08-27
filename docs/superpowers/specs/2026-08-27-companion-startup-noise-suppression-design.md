# 儿童多模态陪伴 — 启动噪声抑制设计文档

- 日期：2026-08-27
- 状态：已评审通过，待实现
- 前置：`2026-08-27-companion-energy-gating-design.md`（能量门控，已实现）
- 相关分支：dev

## 1. 背景与目标

启动时（`audioEngine.start()` 后），iOS 模拟器音频设备会经历一次重配置（日志 `iOSSimulatorAudioDevice: Abandoning I/O cycle because reconfig pending`），产生一段启动噪声。这段噪声被 libfvad 判为 speech，触发 `onSpeechStart`，导致 flush pre-roll（日志里 `base64_len=12800` 的大帧）+ `response.cancel`，走了一轮「假语音」，模型回一句「我在呢，我在呢。你想和我聊什么呀？」。

## 2. 根因

现有的「冷启动宽限期」（grace，25 帧 = 500ms）设计目的是「直喂 libfvad 收敛 floor」，但**没有阻止 libfvad 判 speech 后触发 `onSpeechStart`**。宽限期内启动噪声照样触发假语音。

## 3. 方案

宽限期内，libfvad 照常跑（用于收敛 floor），但 speech 判定不喂给状态机——强制 `updateVadState(isSpeech: false)`。floor 更新逻辑不变（libfvad 判 silence 时仍下探 floor）。

## 4. 参数

| 参数 | 值 |
|---|---|
| 宽限期时长 | 保持 25 帧（500ms） |
| 抑制方式 | 宽限期内强制判 silence，不触发 onSpeechStart |

## 5. 组件改动

### 5.1 修改 `modules/microphone-stream/ios/MicrophoneStreamModule.swift`

`processVadFrames` 中，宽限期（`inGrace`）内的 else 分支（直喂 libfvad）改为：

- 仍喂 libfvad 得到 `isSpeech`
- `!isSpeech` 时仍更新 floor（下探）
- 但 `updateVadState` 传 `isSpeech: false`（宽限期内抑制 speech 触发）

### 5.2 修改 `modules/microphone-stream/android/.../MicrophoneStreamModule.kt`

读循环内同样位置，宽限期内的 else 分支改为 `updateVadState(false)`，其余不变。

## 6. 边界情况

- **孩子连接后 500ms 内开口**：被忽略（宽限期代价，500ms 极短可接受）
- **floor 收敛不受影响**：宽限期内 libfvad 判 silence 的帧仍下探 floor
- **宽限期后正常**：500ms 后恢复正常语音检测

## 7. 测试

- 真机/模拟器验证：启动后不再出现「我在呢」假语音；正常说话检测不受影响

## 8. 明确不做的（YAGNI）

- 延长宽限期
- 丢弃前 N 帧
