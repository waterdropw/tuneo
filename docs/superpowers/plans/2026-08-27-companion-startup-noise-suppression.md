# 启动噪声抑制 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 冷启动宽限期内，libfvad 照常跑收敛 floor，但 speech 判定不触发 `onSpeechStart`，消除启动噪声导致的「假语音」一轮。

**Architecture:** 两端（iOS Swift + Android Kotlin）的宽限期分支中，把 `updateVadState(isSpeech)` 改为 `updateVadState(false)`——floor 更新逻辑不变，仅抑制 speech 触发。

**Tech Stack:** Swift、Kotlin。

## Global Constraints

- 改 `modules/microphone-stream/ios/MicrophoneStreamModule.swift` 与 `modules/microphone-stream/android/src/main/java/expo/modules/microphonestream/MicrophoneStreamModule.kt`。
- 宽限期保持 25 帧（500ms）。
- 宽限期内：libfvad 仍喂、`!isSpeech` 仍更新 floor、但 `updateVadState` 强制传 `false`（抑制 speech 触发）。
- 宽限期后恢复原逻辑（`updateVadState(isSpeech)`）。
- 不引入新依赖。

---

### Task 1: iOS 宽限期内抑制 speech 触发

**Files:**
- Modify: `modules/microphone-stream/ios/MicrophoneStreamModule.swift`

**Interfaces:**
- Consumes: 现有 `graceFramesRemaining`、`inGrace`、`updateVadState(_:)`、`noiseFloor`。
- Produces: 宽限期分支内 `updateVadState(isSpeech: false)` 替代 `updateVadState(isSpeech: isSpeech)`。

- [ ] **Step 1: 修改 processVadFrames 宽限期分支**

把 `processVadFrames` 里 else 分支（直喂 libfvad）末尾的：

```swift
        if !isSpeech {
          // libfvad 判 silence 才更新底噪（含能量上限保护）
          noiseFloor = updateNoiseFloor(noiseFloor, rms: rms)
        }
        updateVadState(isSpeech: isSpeech)
```

改为：

```swift
        if !isSpeech {
          // libfvad 判 silence 才更新底噪（含能量上限保护）
          noiseFloor = updateNoiseFloor(noiseFloor, rms: rms)
        }
        // 宽限期内抑制 speech 触发：floor 照常收敛，但不触发 onSpeechStart
        updateVadState(isSpeech: inGrace ? false : isSpeech)
```

- [ ] **Step 2: 语法校验**

Run: `swiftc -parse modules/microphone-stream/ios/MicrophoneStreamModule.swift`
Expected: 无语法错误（输出为空即通过）。

- [ ] **Step 3: 读回确认**

Read 文件，确认：宽限期分支内 `updateVadState` 传 `inGrace ? false : isSpeech`；非宽限期分支（能量门控）不变；floor 更新逻辑不变。

- [ ] **Step 4: Commit**

```bash
git add modules/microphone-stream/ios/MicrophoneStreamModule.swift
git commit -m "fix: iOS 宽限期内抑制 speech 触发，消除启动噪声假语音"
```

---

### Task 2: Android 宽限期内抑制 speech 触发

**Files:**
- Modify: `modules/microphone-stream/android/src/main/java/expo/modules/microphonestream/MicrophoneStreamModule.kt`

**Interfaces:**
- Consumes: 现有 `graceFramesRemaining`、`inGrace`、`updateVadState(_:)`、`noiseFloor`。
- Produces: 宽限期分支内 `updateVadState(false)` 替代 `updateVadState(isSpeech)`。

- [ ] **Step 1: 修改读循环宽限期分支**

把读循环里 else 分支（直喂 libfvad）末尾的：

```kotlin
                                if (!isSpeech) {
                                    // libfvad 判 silence 才更新底噪（含能量上限保护）
                                    noiseFloor = updateNoiseFloor(noiseFloor, rms)
                                }
                                updateVadState(isSpeech)
```

改为：

```kotlin
                                if (!isSpeech) {
                                    // libfvad 判 silence 才更新底噪（含能量上限保护）
                                    noiseFloor = updateNoiseFloor(noiseFloor, rms)
                                }
                                // 宽限期内抑制 speech 触发：floor 照常收敛，但不触发 onSpeechStart
                                updateVadState(if (inGrace) false else isSpeech)
```

- [ ] **Step 2: 读回确认**

Read 文件，确认：宽限期分支内 `updateVadState` 传 `if (inGrace) false else isSpeech`；非宽限期分支不变；floor 更新逻辑不变。

> 注：本环境无法可靠跑 gradle 编译（SDK 路径缺失），语法正确性靠读回确认，完整编译需真机/本地验证。

- [ ] **Step 3: Commit**

```bash
git add modules/microphone-stream/android/src/main/java/expo/modules/microphonestream/MicrophoneStreamModule.kt
git commit -m "fix: Android 宽限期内抑制 speech 触发，消除启动噪声假语音"
```
