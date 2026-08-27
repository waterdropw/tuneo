# 能量门控 + 自适应底噪 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 iOS 原生层给端侧 VAD 增加「能量门控前置粗筛 + 自适应底噪估计」，静音/低能量帧直接跳过 libfvad，减少环境噪音导致的误判与误计费。

**Architecture:** 每 20ms 帧先算 RMS 能量，低于自适应底噪 floor × 4（≈12dB）的帧直接判 silence 不喂 libfvad；能量够高的帧才喂 libfvad 精判。底噪只在 libfvad 判 silence 时用指数平滑更新（下降快、上升慢，含能量上限保护）。纯函数逻辑先写成 TS 参考实现 + 文档化断言，Swift 端镜像同一数学。

**Tech Stack:** Swift（iOS Expo Module）、TypeScript（纯函数参考实现）。

## Global Constraints

- iOS 与 Android 两端原生层；Android 采样率 16kHz、数据为 ShortArray，能量计算前先归一化为 Float 复用相同常量。
- 帧长 20ms（沿用现有 `VAD_FRAME_MS = 20`）；不改现有 3 帧触发 / 40 帧结束状态机。
- SNR 门控阈值 12dB：`rms >= floor * 4.0` 才喂 libfvad，否则直接判 silence。
- 底噪指数平滑：仅在 libfvad 判 silence 时更新；下降快 `alphaDown = 0.2`，上升慢 `alphaUp = 0.05`。
- floor 初值 `0.25`（冷启动保守，靠快速下探收敛）；能量上限保护 `rms > floor * 8.0` 的帧不更新 floor；floor 下限 `1e-6`。
- 能量门控是粗筛，libfvad 是精判；能量高的非语音（关门/拍手）仍由 libfvad 判 silence。
- 不引入新依赖；本项目无测试运行器，纯函数用文档化断言（`.test.example.ts` 风格）。
- 能量计算在 RMS 幅度域（`sqrt(Σx²/n)`），iOS 输入为 Float。

---

### Task 1: energyGating 纯函数 + 文档化断言

**Files:**
- Create: `src/services/energyGating.ts`
- Create: `src/services/energyGating.test.example.ts`

**Interfaces:**
- Consumes: 无
- Produces:
  - `computeRms(samples: ArrayLike<number>): number` — 返回 RMS（幅度域）
  - `shouldGateByEnergy(rms: number, floor: number, k: number): boolean` — `rms < floor * k` 时 true（直接判 silence）
  - `updateNoiseFloor(floor: number, rms: number, opts: { alphaDown: number; alphaUp: number; cap: number; min: number }): number` — 返回更新后的 floor
  - `ENERGY_GATING` 常量对象（含 `snrK`/`alphaDown`/`alphaUp`/`floorInit`/`cap`/`min`）

- [ ] **Step 1: 写纯函数模块 `src/services/energyGating.ts`**

```ts
/**
 * 能量门控纯函数（参考实现，供文档化断言验证；iOS Swift 端镜像同一数学）。
 * 所有能量均在 RMS 幅度域（sqrt(Σx²/n)），输入为 [-1,1] 浮点采样。
 */

export const ENERGY_GATING = {
  // 12dB 门控阈值：rms >= floor × snrK 才喂 libfvad
  snrK: 4.0,
  // 底噪指数平滑系数：下降快、上升慢
  alphaDown: 0.2,
  alphaUp: 0.05,
  // 冷启动保守初值（满幅 RMS 约 1.0 的 1/4）
  floorInit: 0.25,
  // 能量上限保护：rms > floor × cap 的帧（关门等瞬态）不更新底噪
  cap: 8.0,
  // 底噪下限，防止收敛到 0
  min: 1e-6,
} as const

// 计算 RMS（均方根，幅度域）
export function computeRms(samples: ArrayLike<number>): number {
  if (samples.length === 0) return 0
  let sum = 0
  for (let i = 0; i < samples.length; i++) {
    const x = samples[i]
    sum += x * x
  }
  return Math.sqrt(sum / samples.length)
}

// 能量门控判定：rms 低于 floor×k 时判 silence（跳过 libfvad）
export function shouldGateByEnergy(rms: number, floor: number, k: number): boolean {
  return rms < floor * k
}

// 底噪更新：仅在 libfvad 判 silence 时调用；能量超上限（瞬态）则不更新
export function updateNoiseFloor(
  floor: number,
  rms: number,
  opts: { alphaDown: number; alphaUp: number; cap: number; min: number }
): number {
  if (rms > floor * opts.cap) return floor
  const alpha = rms < floor ? opts.alphaDown : opts.alphaUp
  const next = (1 - alpha) * floor + alpha * rms
  return Math.max(next, opts.min)
}
```

- [ ] **Step 2: 写文档化断言 `src/services/energyGating.test.example.ts`**

```ts
/**
 * 文档化断言示例：能量门控纯函数（本项目无测试运行器，此文件记录预期行为，可手工在 REPL 验证）。
 */
import { computeRms, shouldGateByEnergy, updateNoiseFloor, ENERGY_GATING } from "./energyGating"

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`assert failed: ${msg}`)
}

// computeRms
assert(computeRms([0, 0, 0, 0]) === 0, "rms of silence is 0")
assert(Math.abs(computeRms([0.5, -0.5, 0.5, -0.5]) - 0.5) < 1e-9, "rms of ±0.5 is 0.5")

// shouldGateByEnergy：低于 floor×k 判 silence
assert(shouldGateByEnergy(0.1, 0.25, 4.0) === true, "0.1 < 1.0 → gate")
assert(shouldGateByEnergy(1.2, 0.25, 4.0) === false, "1.2 >= 1.0 → pass")

// updateNoiseFloor：能量上限保护（关门瞬态不更新）
assert(updateNoiseFloor(0.02, 0.9, ENERGY_GATING) === 0.02, "loud transient does not raise floor")

// updateNoiseFloor：低能量下探（floor 从 0.25 向 0.01 收敛，但未一步到位）
const floorDown = updateNoiseFloor(0.25, 0.01, ENERGY_GATING)
assert(floorDown > 0.01 && floorDown < 0.25, "floor moves down toward quiet rms")

// updateNoiseFloor：min 下限
const floorMin = updateNoiseFloor(1e-7, 1e-9, ENERGY_GATING)
assert(floorMin >= ENERGY_GATING.min, "floor clamped above min")

console.log("energyGating example assertions passed")
```

- [ ] **Step 3: 类型检查**

Run: `npx tsc --noEmit`
Expected: 两个新文件无类型错误（项目中 `Spectrum.tsx`/`notes.ts`/`AutoDetectBilingualAsrService.test.example.ts` 的既有错误与本任务无关，忽略）。

- [ ] **Step 4: Commit**

```bash
git add src/services/energyGating.ts src/services/energyGating.test.example.ts
git commit -m "feat: 能量门控纯函数与文档化断言"
```

---

### Task 2: iOS 集成能量门控 + 自适应底噪

**Files:**
- Modify: `modules/microphone-stream/ios/MicrophoneStreamModule.swift`

**Interfaces:**
- Consumes: 现有 `vad`/`sampleRateForVad`/`speechActive`/`updateVadState(_:)`/`processVadFrames(_:)`。
- Produces: 新增常量 `SNR_K`/`FLOOR_ALPHA_DOWN`/`FLOOR_ALPHA_UP`/`FLOOR_INIT`/`FLOOR_CAP`/`FLOOR_MIN`；新增字段 `noiseFloor`；新增私有方法 `computeRms(_:)`、`updateNoiseFloor(_:rms:)`；`processVadFrames` 内加能量门控分支。

- [ ] **Step 1: 加能量门控常量**

在 `MicrophoneStreamModule.swift` 的 `VAD_FRAME_MS` / `SPEECH_TRIGGER_FRAMES` / `SILENCE_END_FRAMES` 三行之后，新增：

```swift
// 能量门控 + 自适应底噪参数（RMS 幅度域）
private let SNR_K: Float = 4.0          // 12dB：rms >= floor × 4 才喂 libfvad
private let FLOOR_ALPHA_DOWN: Float = 0.2 // 底噪下探（快）
private let FLOOR_ALPHA_UP: Float = 0.05  // 底噪上升（慢）
private let FLOOR_INIT: Float = 0.25      // 冷启动保守初值
private let FLOOR_CAP: Float = 8.0        // 能量上限保护：瞬态不更新底噪
private let FLOOR_MIN: Float = 1e-6       // 底噪下限
```

- [ ] **Step 2: 加 noiseFloor 字段**

在类的 VAD 状态字段区（`private var preRollCapacity = 0` 之后）新增：

```swift
  private var noiseFloor: Float = FLOOR_INIT
```

- [ ] **Step 3: 重写 `processVadFrames` 加入能量门控**

把现有 `processVadFrames` 方法整体替换为：

```swift
  // 将一段 Float 样本切帧喂 VAD；先做能量门控粗筛，再交给 libfvad 精判
  private func processVadFrames(_ samples: [Float]) {
    guard let v = vad else { return }
    let frameLen = sampleRateForVad * VAD_FRAME_MS / 1000
    var offset = 0
    while offset + frameLen <= samples.count {
      let frame = Array(samples[offset..<(offset + frameLen)])
      let rms = computeRms(frame)

      if rms < noiseFloor * SNR_K {
        // 能量门控：低能量直接判 silence，跳过 libfvad，并下探底噪
        noiseFloor = updateNoiseFloor(noiseFloor, rms: rms)
        updateVadState(isSpeech: false)
      } else {
        // libfvad 的 fvad_process 需要 Int16 PCM，先 clamp 再转 Int16
        let frameInt16: [Int16] = frame.map { sample in
          let clamped = max(-1.0, min(1.0, sample))
          return Int16(clamped * 32767.0)
        }
        let isSpeech = frameInt16.withUnsafeBufferPointer { buf in
          fvad_process(v, buf.baseAddress, frameLen) == 1
        }
        if !isSpeech {
          // libfvad 判 silence 才更新底噪（含能量上限保护）
          noiseFloor = updateNoiseFloor(noiseFloor, rms: rms)
        }
        updateVadState(isSpeech: isSpeech)
      }
      offset += frameLen
    }
  }
```

- [ ] **Step 4: 新增 `computeRms` 与 `updateNoiseFloor` 私有方法**

在 `processVadFrames` 方法之后、`updateVadState` 方法之前，新增：

```swift
  private func computeRms(_ samples: [Float]) -> Float {
    guard !samples.isEmpty else { return 0 }
    var sum: Float = 0
    for x in samples { sum += x * x }
    return (sum / Float(samples.count)).squareRoot()
  }

  private func updateNoiseFloor(_ floor: Float, rms: Float) -> Float {
    if rms > floor * FLOOR_CAP { return floor } // 关门等瞬态不更新底噪
    let alpha = rms < floor ? FLOOR_ALPHA_DOWN : FLOOR_ALPHA_UP
    let next = (1 - alpha) * floor + alpha * rms
    return max(next, FLOOR_MIN)
  }
```

- [ ] **Step 5: stopRecording 复位 noiseFloor**

在 `stopRecording()` 里，`speechActive = false` / `speechStreak = 0` / `silenceStreak = 0` 三行之后，新增：

```swift
    noiseFloor = FLOOR_INIT
```

- [ ] **Step 6: 语法校验**

Run: `swiftc -parse modules/microphone-stream/ios/MicrophoneStreamModule.swift`
Expected: 无语法错误（`swiftc -parse` 不解析模块依赖，输出为空即通过）。

- [ ] **Step 7: 读回确认**

Read `MicrophoneStreamModule.swift`，确认：
- 能量门控分支在 `fvad_process` 之前；
- 底噪只在「门控判 silence」或「libfvad 判 silence」时更新；
- speech 帧（libfvad 判 speech）不更新 floor；
- 状态机阈值（3/40）、frameLen、pre-roll、Int16 转换、fallback 均未被改动。

- [ ] **Step 8: Commit**

```bash
git add modules/microphone-stream/ios/MicrophoneStreamModule.swift
git commit -m "feat: iOS 能量门控前置粗筛与自适应底噪"
```

---

### Task 3: Android 集成能量门控 + 自适应底噪

**Files:**
- Modify: `modules/microphone-stream/android/src/main/java/expo/modules/microphonestream/MicrophoneStreamModule.kt`

**Interfaces:**
- Consumes: 现有 `vadHandle`/`sampleRate`/`speechActive`/`updateVadState(_:)`/读循环。
- Produces: 新增常量 `SNR_K`/`FLOOR_ALPHA_DOWN`/`FLOOR_ALPHA_UP`/`FLOOR_INIT`/`FLOOR_CAP`/`FLOOR_MIN`；新增字段 `noiseFloor`/`graceFramesRemaining`；新增私有方法 `computeRms(_:)`/`updateNoiseFloor(_:rms:)`；读循环内加能量门控分支与宽限期。

> 与 iOS（Task 2）完全对称，但：采样率 16kHz（frameLen=320）、数据为 `ShortArray`、能量计算前归一化为 Float（`x / 32768.0f`）。常量与 iOS/TS 参考完全一致。冷启动宽限期 25 帧。

- [ ] **Step 1: 加能量门控常量**

在 `MicrophoneStreamModule.kt` 的 `private val silenceEndFrames = 40` 之后，新增：

```kotlin
    // 能量门控 + 自适应底噪参数（RMS 幅度域，与 iOS/TS 参考一致）
    private val snrK = 4.0f          // 12dB：rms >= floor × 4 才喂 libfvad
    private val floorAlphaDown = 0.2f // 底噪下探（快）
    private val floorAlphaUp = 0.05f  // 底噪上升（慢）
    private val floorInit = 0.25f     // 冷启动保守初值
    private val floorCap = 8.0f       // 能量上限保护：瞬态不更新底噪
    private val floorMin = 1e-6f      // 底噪下限
```

- [ ] **Step 2: 加 noiseFloor 与 graceFramesRemaining 字段**

在 `private var preRollCapacity = 0` 之后，新增：

```kotlin
    private var noiseFloor = floorInit
    private var graceFramesRemaining = 0
```

- [ ] **Step 3: 改写读循环中的 VAD 帧处理，加入能量门控与宽限期**

把现有读循环里这段（`while (offset + frameLen <= read) { ... }` 的循环体）：

```kotlin
                        // 按 20ms 帧喂 VAD（Android 采样率为 16kHz，frameLen = 320）
                        val frameLen = sampleRate * vadFrameMs / 1000
                        var offset = 0
                        while (offset + frameLen <= read) {
                            val frame = buffer.copyOfRange(offset, offset + frameLen)
                            updateVadState(nativeVadProcess(vadHandle, frame, frameLen) == 1)
                            offset += frameLen
                        }
```

替换为：

```kotlin
                        // 按 20ms 帧喂 VAD（Android 采样率为 16kHz，frameLen = 320）
                        val frameLen = sampleRate * vadFrameMs / 1000
                        var offset = 0
                        while (offset + frameLen <= read) {
                            val frame = buffer.copyOfRange(offset, offset + frameLen)
                            val rms = computeRms(frame)

                            val inGrace = graceFramesRemaining > 0
                            if (inGrace) { graceFramesRemaining -= 1 }

                            if (!inGrace && rms < noiseFloor * snrK) {
                                // 能量门控：低能量直接判 silence，跳过 libfvad，并更新底噪（快降/慢升）
                                noiseFloor = updateNoiseFloor(noiseFloor, rms)
                                updateVadState(false)
                            } else {
                                // 冷启动宽限期内，或能量够高：直喂 libfvad 精判
                                val isSpeech = nativeVadProcess(vadHandle, frame, frameLen) == 1
                                if (!isSpeech) {
                                    // libfvad 判 silence 才更新底噪（含能量上限保护）
                                    noiseFloor = updateNoiseFloor(noiseFloor, rms)
                                }
                                updateVadState(isSpeech)
                            }
                            offset += frameLen
                        }
```

- [ ] **Step 4: 新增 computeRms 与 updateNoiseFloor 私有方法**

在 `initVad` 方法之后、`updateVadState` 方法之前，新增：

```kotlin
    // Short PCM 归一化为 Float 后算 RMS（幅度域，与 iOS/TS 参考一致）
    private fun computeRms(frame: ShortArray): Float {
        if (frame.isEmpty()) return 0f
        var sum = 0.0
        for (s in frame) {
            val x = s / 32768.0f
            sum += (x * x).toDouble()
        }
        return kotlin.math.sqrt(sum / frame.size).toFloat()
    }

    private fun updateNoiseFloor(floor: Float, rms: Float): Float {
        if (rms > floor * floorCap) return floor // 关门等瞬态不更新底噪
        val alpha = if (rms < floor) floorAlphaDown else floorAlphaUp
        val next = (1 - alpha) * floor + alpha * rms
        return maxOf(next, floorMin)
    }
```

- [ ] **Step 5: initVad 设置宽限期，stopRecording 复位状态**

在 `initVad()` 里 `preRollCapacity = sampleRate * 300 / 1000` 之后，新增：

```kotlin
        graceFramesRemaining = 25 // 500ms / 20ms：冷启动宽限期，直喂 libfvad 收敛底噪
```

在 `stopRecording()` 里 `silenceStreak = 0` 之后，新增：

```kotlin
        noiseFloor = floorInit
```

- [ ] **Step 6: 读回确认**

Read `MicrophoneStreamModule.kt`，确认：
- 能量门控分支在 `nativeVadProcess` 之前；
- 宽限期 25 帧内直喂 libfvad，之后门控才接管；
- 底噪只在「门控判 silence」或「libfvad 判 silence」时更新；
- speech 帧不更新 floor；
- `@Volatile`/`readThread`/`join`、状态机阈值（3/40）、pre-roll、fallback、事件名均未被改动。

> 注意：本环境无法可靠运行 gradle 编译（SDK 路径缺失）。语法正确性靠读回确认，完整编译需真机/本地 gradle 验证。

- [ ] **Step 7: Commit**

```bash
git add modules/microphone-stream/android/src/main/java/expo/modules/microphonestream/MicrophoneStreamModule.kt
git commit -m "feat: Android 能量门控前置粗筛与自适应底噪"
```
