# 画面变化自适应帧率 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 视频帧抓取从固定频率改为画面变化自适应——翻页（突变）时加速、走动（持续变化）时恢复正常、静止时平滑回落。

**Architecture:** `VideoFrameSource` 从 `setInterval` 改为 `setTimeout` 链的动态间隔；每次抓帧额外生成 16×16 PNG 用于变化检测（不发模型），比较 base64 差异占比；状态机（突变→加速 / 持续→恢复 / 静止→回落）写成纯函数 TS 参考实现 + 文档化断言，供实现镜像。

**Tech Stack:** TypeScript、expo-camera、expo-image-manipulator。

## Global Constraints

- 仅改 `src/services/VideoFrameSource.ts`；新增 `src/services/adaptiveFramerate.ts` 与 `.test.example.ts`。
- 基础间隔：`continuous` 1000ms / `onDemand` 5000ms（沿用现有 `CONTINUOUS_INTERVAL_MS` / `ON_DEMAND_INTERVAL_MS`）。
- 加速倍数 3x（间隔 ÷3）；最小间隔下限 200ms；回落步长 ×1.5 封顶基础间隔；差异阈值 30%。
- 检测图 16×16 无损 PNG，仅用于检测，不发模型（发送给模型的仍是 320 宽 JPEG）。
- 动态间隔用 `setTimeout` 链（每次抓帧后按新间隔安排下一次），不再用 `setInterval`。
- 冷启动第一帧无上一帧可比，按基础间隔不加速。
- 本项目无测试运行器，纯函数用文档化断言（`.test.example.ts` 风格）。

---

### Task 1: 自适应帧率纯函数 + 文档化断言

**Files:**
- Create: `src/services/adaptiveFramerate.ts`
- Create: `src/services/adaptiveFramerate.test.example.ts`

**Interfaces:**
- Consumes: 无
- Produces:
  - `diffRatio(a: string, b: string): number` — 两字符串差异占比（0–1）
  - `nextFrameState(state: FrameState, baseInterval: number, changed: boolean, opts: AdaptiveOptions): FrameState`
  - `FrameState = { interval: number; wasChanged: boolean }`
  - `AdaptiveOptions = { accelFactor: number; minInterval: number; decayFactor: number }`
  - `ADAPTIVE_DEFAULTS` 常量（accelFactor=3 / minInterval=200 / decayFactor=1.5 / changeThreshold=0.3）

- [ ] **Step 1: 写纯函数模块 `src/services/adaptiveFramerate.ts`**

```ts
/**
 * 画面变化自适应帧率纯函数（参考实现，供文档化断言验证；VideoFrameSource 镜像同一逻辑）。
 */

export interface FrameState {
  interval: number // 当前帧间隔（ms）
  wasChanged: boolean // 上一帧是否判为「画面变化」
}

export interface AdaptiveOptions {
  accelFactor: number // 加速倍数（间隔 ÷ accelFactor）
  minInterval: number // 最小间隔下限（ms）
  decayFactor: number // 回落步长（间隔 × decayFactor）
}

export const ADAPTIVE_DEFAULTS = {
  accelFactor: 3,
  minInterval: 200,
  decayFactor: 1.5,
  changeThreshold: 0.3,
} as const

// 两字符串差异占比（0–1）；按较长长度遍历，缺失位置计为差异
export function diffRatio(a: string, b: string): number {
  const len = Math.max(a.length, b.length)
  if (len === 0) return 0
  let diff = 0
  for (let i = 0; i < len; i++) {
    if (a[i] !== b[i]) diff++
  }
  return diff / len
}

// 状态机：根据「本帧是否变化」与「上一帧是否变化」返回下一帧状态
export function nextFrameState(
  state: FrameState,
  baseInterval: number,
  changed: boolean,
  opts: AdaptiveOptions
): FrameState {
  if (changed) {
    if (!state.wasChanged) {
      // 突变（翻页）：加速
      return {
        interval: Math.max(baseInterval / opts.accelFactor, opts.minInterval),
        wasChanged: true,
      }
    }
    // 持续变化（走动）：恢复正常
    return { interval: baseInterval, wasChanged: true }
  }
  // 静止：平滑回落，封顶基础间隔
  return {
    interval: Math.min(state.interval * opts.decayFactor, baseInterval),
    wasChanged: false,
  }
}
```

- [ ] **Step 2: 写文档化断言 `src/services/adaptiveFramerate.test.example.ts`**

```ts
/**
 * 文档化断言示例：自适应帧率状态机（本项目无测试运行器，此文件记录预期行为，可手工在 REPL 验证）。
 */
import { diffRatio, nextFrameState, ADAPTIVE_DEFAULTS, FrameState } from "./adaptiveFramerate"

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`assert failed: ${msg}`)
}

const opts = {
  accelFactor: ADAPTIVE_DEFAULTS.accelFactor,
  minInterval: ADAPTIVE_DEFAULTS.minInterval,
  decayFactor: ADAPTIVE_DEFAULTS.decayFactor,
}

// diffRatio
assert(diffRatio("abc", "abc") === 0, "identical strings have 0 diff")
assert(diffRatio("abc", "xyz") === 1, "fully different strings have 1 diff")
assert(Math.abs(diffRatio("aaaa", "aaab") - 0.25) < 1e-9, "one of four chars differs")

// 突变（静止→变化）：加速到 base/3
let state: FrameState = { interval: 1000, wasChanged: false }
state = nextFrameState(state, 1000, true, opts)
assert(state.interval === 333 || Math.abs(state.interval - 1000 / 3) < 1, "突变加速到 base/3")
assert(state.wasChanged === true, "突变后 wasChanged=true")

// 持续变化（走动）：恢复正常间隔
state = nextFrameState(state, 1000, true, opts)
assert(state.interval === 1000, "持续变化恢复正常间隔")
assert(state.wasChanged === true, "持续变化后 wasChanged 仍 true")

// 静止：平滑回落 ×1.5，封顶 base
state = nextFrameState(state, 1000, false, opts)
assert(state.interval === 1000, "回落封顶基础间隔")
state = { interval: 333, wasChanged: false }
state = nextFrameState(state, 1000, false, opts)
assert(Math.abs(state.interval - 333 * 1.5) < 1, "静止时间隔 ×1.5")
assert(state.wasChanged === false, "静止后 wasChanged=false")

// 最小间隔下限
state = { interval: 333, wasChanged: false }
state = nextFrameState(state, 1000, true, opts)
assert(state.interval >= 200, "加速不低于 minInterval")

console.log("adaptiveFramerate example assertions passed")
```

- [ ] **Step 3: 类型检查**

Run: `npx tsc --noEmit`
Expected: 两个新文件无类型错误（`Spectrum.tsx`/`notes.ts`/`AutoDetectBilingualAsrService.test.example.ts` 的既有错误与本任务无关，忽略）。

- [ ] **Step 4: Commit**

```bash
git add src/services/adaptiveFramerate.ts src/services/adaptiveFramerate.test.example.ts
git commit -m "feat: 自适应帧率状态机纯函数与文档化断言"
```

---

### Task 2: VideoFrameSource 集成自适应帧率

**Files:**
- Modify: `src/services/VideoFrameSource.ts`

**Interfaces:**
- Consumes: `nextFrameState`/`diffRatio`/`ADAPTIVE_DEFAULTS`（Task 1）；现有 `manipulateAsync`/`SaveFormat`/`takePictureAsync`/`FileSystem`。
- Produces: `VideoFrameSource` 改用 `setTimeout` 链动态间隔；`captureFrame` 双路生成 320 JPEG + 16×16 PNG 检测图。

- [ ] **Step 1: 引入依赖与常量**

把 `src/services/VideoFrameSource.ts` 顶部 import 区新增：

```ts
import { nextFrameState, diffRatio, ADAPTIVE_DEFAULTS, FrameState } from "./adaptiveFramerate"
```

在 `const TARGET_WIDTH = 320` 之后新增：

```ts
const THUMB_SIZE = 16
```

- [ ] **Step 2: 改造类字段**

把 `VideoFrameSource` 类里的 `private timer: ReturnType<typeof setInterval> | null = null` 改为：

```ts
  private timer: ReturnType<typeof setTimeout> | null = null
  private baseInterval = 0
  private frameState: FrameState = { interval: 0, wasChanged: false }
  private lastThumbBase64: string | null = null
  private running = false
```

- [ ] **Step 3: 重写 `start` 与 `stop`**

把现有 `start` 方法替换为：

```ts
  start(mode: "onDemand" | "continuous"): void {
    this.stop()
    this.baseInterval = mode === "continuous" ? CONTINUOUS_INTERVAL_MS : ON_DEMAND_INTERVAL_MS
    this.frameState = { interval: this.baseInterval, wasChanged: false }
    this.lastThumbBase64 = null
    this.running = true
    this.scheduleNext()
  }

  stop(): void {
    this.running = false
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    this.busy = false
  }
```

- [ ] **Step 4: 新增 `scheduleNext` 私有方法**

在 `stop` 之后新增：

```ts
  private scheduleNext(): void {
    if (!this.running) return
    this.timer = setTimeout(() => {
      this.captureFrame()
    }, this.frameState.interval)
  }
```

- [ ] **Step 5: 改造 `captureFrame` 为双路生成 + 状态机**

把 `captureFrame` 方法整体替换为：

```ts
  async captureFrame(): Promise<void> {
    if (this.busy || !this.cameraRef?.current) {
      return
    }
    this.busy = true
    const uris: string[] = []
    try {
      const photo = await this.cameraRef.current.takePictureAsync({ base64: false })
      if (!photo) {
        return
      }
      uris.push(photo.uri)

      // 发送帧：320 宽 JPEG
      const sendResult = await manipulateAsync(
        photo.uri,
        [{ resize: { width: TARGET_WIDTH } }],
        { compress: 0.7, format: SaveFormat.JPEG, base64: true }
      )
      uris.push(sendResult.uri)

      if (sendResult.base64 && fitsSizeLimit(sendResult.base64)) {
        this.frameCallback?.(sendResult.base64)
      } else {
        console.warn("[video-frame] Frame exceeds size limit, dropped")
      }

      // 检测帧：16×16 无损 PNG（仅用于画面变化检测，不发模型）
      const thumbResult = await manipulateAsync(
        photo.uri,
        [{ resize: { width: THUMB_SIZE, height: THUMB_SIZE } }],
        { format: SaveFormat.PNG, base64: true }
      )
      uris.push(thumbResult.uri)

      // 更新状态机
      const thumbBase64 = thumbResult.base64 ?? ""
      const changed =
        this.lastThumbBase64 !== null &&
        diffRatio(thumbBase64, this.lastThumbBase64) >= ADAPTIVE_DEFAULTS.changeThreshold
      this.lastThumbBase64 = thumbBase64

      this.frameState = nextFrameState(
        this.frameState,
        this.baseInterval,
        changed,
        {
          accelFactor: ADAPTIVE_DEFAULTS.accelFactor,
          minInterval: ADAPTIVE_DEFAULTS.minInterval,
          decayFactor: ADAPTIVE_DEFAULTS.decayFactor,
        }
      )
    } catch (e) {
      console.warn("[video-frame] capture failed", e)
    } finally {
      for (const uri of uris) {
        FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {})
      }
      this.busy = false
      this.scheduleNext()
    }
  }
```

- [ ] **Step 6: lint + tsc 校验**

Run: `npx eslint src/services/VideoFrameSource.ts`
Expected: 无 error。

Run: `npx tsc --noEmit`
Expected: 无 NEW 错误（既有错误与本任务无关）。

- [ ] **Step 7: 读回确认**

Read `VideoFrameSource.ts`，确认：
- `setInterval` 已全部移除，改为 `setTimeout` 链；
- `captureFrame` 双路生成（320 JPEG 发送 + 16×16 PNG 检测），检测图不发 `frameCallback`；
- 冷启动第一帧 `lastThumbBase64 === null` 时 `changed` 为 false，按基础间隔；
- 状态机更新在 `finally` 中 `scheduleNext` 之前，动态间隔生效；
- `stop` 清 `running` 标志并 `clearTimeout`。

- [ ] **Step 8: Commit**

```bash
git add src/services/VideoFrameSource.ts
git commit -m "feat: 视频帧画面变化自适应帧率"
```
