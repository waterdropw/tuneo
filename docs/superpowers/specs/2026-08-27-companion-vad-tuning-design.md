# 儿童多模态陪伴 — VAD 唤醒调优设计文档

- 日期：2026-08-27
- 状态：已评审通过，待实现
- 前置：`2026-08-27-companion-energy-gating-design.md`（能量门控，已实现）、`2026-08-27-companion-startup-noise-suppression-design.md`（启动噪声抑制，已实现）
- 相关分支：dev

## 1. 背景与目标

真机测试暴露两个 VAD 唤醒缺陷：

1. **漏唤醒**：旁人说话（中等能量持续人声）没唤醒。根因是 `updateNoiseFloor` 用「下降快/上升慢」双向平滑，能量门控分支会把中等能量人声误判为 silence 并反过来用 `alphaUp` 污染 floor，导致 floor 稳定在「说话声能量」附近，同样音量的人声永远过不了 `floor×4` 门控。
2. **误唤醒**：打喷嚏（瞬态高能量宽频噪声）唤醒了。根因是 `SPEECH_TRIGGER_FRAMES = 3`（60ms）太短，瞬态噪声能凑够触发。

## 2. 范围

### 2.1 范围内

- floor 改 minimum tracking：逐帧只降不升 + 5s 定时重校准
- `SPEECH_TRIGGER_FRAMES` 3→15（60ms→300ms 最小语音时长）
- 两端（iOS Swift + Android Kotlin）对称改动

### 2.2 范围外

- 降噪（AEC/ANS）
- 换音频库
- 光流检测

## 3. 方案

### 3.1 floor minimum tracking（治漏唤醒）

`updateNoiseFloor` 从「双向平滑」改为「只降不升」，并加 5s 重校准：

- **逐帧**：`floor = min(floor, rms)`（只下降）
- **每 5s 重校准**：维护「重校准窗口最低值」，窗口满 250 帧（5s/20ms）时 `floor = max(floor, 窗口最低值)`，允许上升，然后重置

这样 floor 稳定在「真实底噪」水平，旁人说话声（中等能量）不污染 floor，能过能量门控交给 libfvad 精判。

### 3.2 最小语音时长 300ms（治误唤醒）

`SPEECH_TRIGGER_FRAMES` 3→15（60ms→300ms）。打喷嚏（~100-200ms 瞬态）凑不够 15 帧，不触发；真正孩子语音（>300ms）正常触发。

## 4. 关键设计点

1. **重校准用窗口最低值而非平均值**——避免窗口内恰好有孩子说话，把说话能量误当成新底噪。
2. **环境变吵**：5s 重校准让 floor 缓慢跟上，最多滞后 5s。
3. **环境变静**：逐帧 min 让 floor 立即下降，响应快。
4. **孩子短促应答（<300ms）可能被漏**——这是 300ms 标准的已知代价。

## 5. 组件改动

### 5.1 修改 `modules/microphone-stream/ios/MicrophoneStreamModule.swift`

- `updateNoiseFloor` 改为 `floor = min(floor, rms)`
- 新增 `recalibMin` / `recalibCounter` 字段，每帧更新，满 250 帧时重校准
- `SPEECH_TRIGGER_FRAMES` 3→15

### 5.2 修改 `modules/microphone-stream/android/.../MicrophoneStreamModule.kt`

- 同样改动，两端对称

## 6. 测试

- 真机验证：旁人说话能唤醒、打喷嚏不唤醒、环境变吵后 floor 能跟上
- 纯函数逻辑（floor min + 重校准）可写 TS 参考实现 + 文档化断言

## 7. 明确不做的（YAGNI）

- 降噪（AEC/ANS）
- 换音频库
- 光流检测
