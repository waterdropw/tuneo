# VAD 唤醒调优 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复两个 VAD 唤醒缺陷——floor 改 minimum tracking（治漏唤醒）+ 最小语音时长 300ms（治误唤醒）。

**Architecture:** floor 更新从「双向平滑」改为「逐帧只降 + 5s 定时重校准」；`SPEECH_TRIGGER_FRAMES` 3→15。纯函数逻辑写成 TS 参考实现 + 文档化断言，iOS/Android 原生代码镜像。

**Tech Stack:** Swift、Kotlin、TypeScript（纯函数参考）。

## Global Constraints

- 改 `modules/microphone-stream/ios/MicrophoneStreamModule.swift`、`modules/microphone-stream/android/src/main/java/expo/modules/microphonestream/MicrophoneStreamModule.kt`；新增 TS 参考 `src/services/floorTracking.ts` + `.test.example.ts`。
- floor 逐帧：`floor = min(floor, rms)`（只降不升）。
- floor 5s 重校准：窗口满 250 帧（5s/20ms）时 `floor = max(floor, 窗口最低值)`，然后重置窗口。
- 重校准用「窗口最低值」而非平均值。
- `SPEECH_TRIGGER_FRAMES` 3→15（60ms→300ms）。
- 不引入新依赖；本项目无测试运行器，纯函数用文档化断言。

---

### Task 1: floor tracking 纯函数 + 文档化断言

**Files:**
- Create: `src/services/floorTracking.ts`
- Create: `src/services/floorTracking.test.example.ts`

**Interfaces:**
- Consumes: 无
- Produces:
  - `FloorTrackerState = { floor: number; recalibMin: number; recalibCounter: number }`
  - `updateFloor(state, rms, opts): FloorTrackerState` — 逐帧 min + 窗口累积 + 满窗重校准
  - `FLOOR_TRACKING` 常量（recalibWindowFrames=250 / floorMin=1e-6 / recalibInit=Infinity）

- [ ] **Step 1: 写 `src/services/floorTracking.ts`**

```ts
/**
 * 底噪 floor 的 minimum tracking（只降 + 定时重校准），供文档化断言验证；原生层镜像同一逻辑。
 */

export interface FloorTrackerState {
  floor: number          // 当前底噪估计（RMS 幅度域）
  recalibMin: number     // 重校准窗口内最低 rms
  recalibCounter: number // 重校准窗口已累计帧数
}

export interface FloorTrackerOptions {
  recalibWindowFrames: number // 重校准窗口帧数（5s/20ms = 250）
  floorMin: number            // floor 下限
}

export const FLOOR_TRACKING = {
  recalibWindowFrames: 250,
  floorMin: 1e-6,
} as const

export function initialFloorTracker(floor: number): FloorTrackerState {
  return { floor, recalibMin: Infinity, recalibCounter: 0 }
}

// 逐帧更新：floor 只降不升；窗口满则用窗口最低值重校准（允许上升）
export function updateFloor(
  state: FloorTrackerState,
  rms: number,
  opts: FloorTrackerOptions
): FloorTrackerState {
  const floor = Math.max(Math.min(state.floor, rms), opts.floorMin)
  const recalibMin = Math.min(state.recalibMin, rms)
  const recalibCounter = state.recalibCounter + 1

  if (recalibCounter >= opts.recalibWindowFrames) {
    // 窗口满：用窗口最低值重校准（允许 floor 上升以跟上环境变吵）
    return {
      floor: Math.max(floor, recalibMin),
      recalibMin: Infinity,
      recalibCounter: 0,
    }
  }

  return { floor, recalibMin, recalibCounter }
}
```

- [ ] **Step 2: 写 `src/services/floorTracking.test.example.ts`**

```ts
/**
 * 文档化断言示例：floor minimum tracking（本项目无测试运行器，记录预期行为，可手工在 REPL 验证）。
 */
import { updateFloor, initialFloorTracker, FLOOR_TRACKING } from "./floorTracking"

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`assert failed: ${msg}`)
}

const opts = { recalibWindowFrames: FLOOR_TRACKING.recalibWindowFrames, floorMin: FLOOR_TRACKING.floorMin }

// 逐帧只降：rms 高于 floor 时 floor 不升
let s = initialFloorTracker(0.1)
s = updateFloor(s, 0.5, opts)
assert(s.floor === 0.1, "rms 高于 floor 时 floor 不升")

// 逐帧下降：rms 低于 floor 时 floor 降到 rms
s = updateFloor(s, 0.02, opts)
assert(Math.abs(s.floor - 0.02) < 1e-9, "rms 低于 floor 时 floor 降到 rms")

// floor 下限
s = initialFloorTracker(1e-7)
s = updateFloor(s, 1e-9, opts)
assert(s.floor >= FLOOR_TRACKING.floorMin, "floor 不低于下限")

// 窗口满重校准：用窗口最低值允许 floor 上升
s = initialFloorTracker(0.01)
for (let i = 0; i < 249; i++) {
  s = updateFloor(s, 0.5, opts) // 249 帧高能量（不降 floor，但窗口最低值被拉高到 0.5）
}
assert(s.recalibCounter === 249, "未满窗不重校准")
s = updateFloor(s, 0.5, opts) // 第 250 帧，窗口满，触发重校准
assert(s.recalibCounter === 0, "满窗后计数器重置")
assert(Math.abs(s.floor - 0.5) < 1e-9, "重校准用窗口最低值，floor 上升到 0.5")

console.log("floorTracking example assertions passed")
```

- [ ] **Step 3: 类型检查**

Run: `npx tsc --noEmit`
Expected: 两个新文件无类型错误（既有错误与本任务无关）。

- [ ] **Step 4: Commit**

```bash
git add src/services/floorTracking.ts src/services/floorTracking.test.example.ts
git commit -m "feat: floor minimum tracking 纯函数与文档化断言"
```

---

### Task 2: iOS 端 VAD 调优

**Files:**
- Modify: `modules/microphone-stream/ios/MicrophoneStreamModule.swift`

**Interfaces:**
- Consumes: 现有 `noiseFloor`、`updateNoiseFloor` 调用点（`processVadFrames` 两处）、`SPEECH_TRIGGER_FRAMES`。
- Produces: 新增 `recalibMin`/`recalibCounter` 字段；`updateNoiseFloor` 改为只降 + 窗口累积重校准；`SPEECH_TRIGGER_FRAMES` 改为 15。

- [ ] **Step 1: 改 SPEECH_TRIGGER_FRAMES**

把 `private let SPEECH_TRIGGER_FRAMES = 3` 改为：

```swift
private let SPEECH_TRIGGER_FRAMES = 15  // 300ms / 20ms：最小语音时长，过滤喷嚏等瞬态
```

- [ ] **Step 2: 新增重校准常量与字段**

在 `FLOOR_MIN` 常量之后，新增：

```swift
private let RECALIB_WINDOW_FRAMES = 250  // 5s / 20ms：floor 重校准窗口
```

在 `private var noiseFloor: Float = FLOOR_INIT` 之后，新增：

```swift
  private var recalibMin: Float = Float.greatestFiniteMagnitude
  private var recalibCounter = 0
```

- [ ] **Step 3: 重写 updateNoiseFloor 为 minimum tracking**

把 `updateNoiseFloor` 方法整体替换为：

```swift
  // floor 只降不升 + 窗口满重校准（用窗口最低值，允许 floor 上升跟上环境变吵）
  private func updateNoiseFloor(_ floor: Float, rms: Float) -> Float {
    let newFloor = max(min(floor, rms), FLOOR_MIN)
    recalibMin = min(recalibMin, rms)
    recalibCounter += 1
    if recalibCounter >= RECALIB_WINDOW_FRAMES {
      let recalibrated = max(newFloor, recalibMin)
      recalibMin = Float.greatestFiniteMagnitude
      recalibCounter = 0
      return recalibrated
    }
    return newFloor
  }
```

> 注：`updateNoiseFloor` 现在有副作用（更新 `recalibMin`/`recalibCounter` 字段）。它仍返回新 floor，调用点签名不变。

- [ ] **Step 4: 语法校验**

Run: `swiftc -parse modules/microphone-stream/ios/MicrophoneStreamModule.swift`
Expected: 无输出（语法 OK）。

- [ ] **Step 5: 读回确认**

Read 文件，确认：`SPEECH_TRIGGER_FRAMES=15`；`updateNoiseFloor` 只降不升 + 满窗重校准；调用点（两处）签名不变；FLOOR_CAP/FLOOR_ALPHA_DOWN/FLOOR_ALPHA_UP 常量可删除或保留（本次不改，避免范围扩大）。

- [ ] **Step 6: Commit**

```bash
git add modules/microphone-stream/ios/MicrophoneStreamModule.swift
git commit -m "fix: iOS VAD 调优——floor minimum tracking + 最小语音时长 300ms"
```

---

### Task 3: Android 端 VAD 调优

**Files:**
- Modify: `modules/microphone-stream/android/src/main/java/expo/modules/microphonestream/MicrophoneStreamModule.kt`

**Interfaces:**
- Consumes: 现有 `noiseFloor`、`updateNoiseFloor` 调用点、`speechTriggerFrames`。
- Produces: 新增 `recalibMin`/`recalibCounter` 字段；`updateNoiseFloor` 改为只降 + 窗口累积重校准；`speechTriggerFrames` 改为 15。

- [ ] **Step 1: 改 speechTriggerFrames**

把 `private val speechTriggerFrames = 3` 改为：

```kotlin
    private val speechTriggerFrames = 15 // 300ms / 20ms：最小语音时长，过滤喷嚏等瞬态
```

- [ ] **Step 2: 新增重校准常量与字段**

在 `private val floorMin = 1e-6f` 之后，新增：

```kotlin
    private val recalibWindowFrames = 250 // 5s / 20ms：floor 重校准窗口
```

在 `private var noiseFloor = floorInit` 之后，新增：

```kotlin
    private var recalibMin = Float.MAX_VALUE
    private var recalibCounter = 0
```

- [ ] **Step 3: 重写 updateNoiseFloor 为 minimum tracking**

把 `updateNoiseFloor` 方法整体替换为：

```kotlin
    // floor 只降不升 + 窗口满重校准（用窗口最低值，允许 floor 上升跟上环境变吵）
    private fun updateNoiseFloor(floor: Float, rms: Float): Float {
        val newFloor = maxOf(minOf(floor, rms), floorMin)
        recalibMin = minOf(recalibMin, rms)
        recalibCounter++
        if (recalibCounter >= recalibWindowFrames) {
            val recalibrated = maxOf(newFloor, recalibMin)
            recalibMin = Float.MAX_VALUE
            recalibCounter = 0
            return recalibrated
        }
        return newFloor
    }
```

- [ ] **Step 4: 读回确认**

Read 文件，确认：`speechTriggerFrames=15`；`updateNoiseFloor` 只降不升 + 满窗重校准；调用点签名不变。

> 注：本环境无法可靠跑 gradle（SDK 路径缺失），语法正确性靠读回确认。

- [ ] **Step 5: Commit**

```bash
git add modules/microphone-stream/android/src/main/java/expo/modules/microphonestream/MicrophoneStreamModule.kt
git commit -m "fix: Android VAD 调优——floor minimum tracking + 最小语音时长 300ms"
```
