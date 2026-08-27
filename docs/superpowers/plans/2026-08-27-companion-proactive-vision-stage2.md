# 画面突变主动视觉触发 实现计划（阶段二）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 复用 `VideoFrameSource` 已算出的画面突变信号（`changed && !wasChanged`），在突变时主动 `createResponse`，并统一「上次交互」计时器让语音/定时/突变三种触发协调。

**Architecture:** `VideoFrameSource` 新增 `changeCallback` 暴露突变信号；`Companion` 新增 `lastInteractionRef` 统一记录上次交互时间，`onSpeechEnd`、10s 定时触发、突变触发三处共用它判断「距上次交互 > 10s」。

**Tech Stack:** React Native、TypeScript。

## Global Constraints

- 改 `src/services/VideoFrameSource.ts` 与 `src/navigation/screens/Companion.tsx`。
- 突变判定：`changed && !wasChanged`（静止→变化），复用现有 `diffRatio`/`frameState.wasChanged`。
- 冷却/节流：`距上次交互 > 10s` 才触发（统一用 `lastInteractionRef`）。
- 触发状态：仅 `listening`。
- 启动条件：`videoMode !== "off"`。
- 不引入新依赖。

---

### Task 1: VideoFrameSource 暴露突变信号

**Files:**
- Modify: `src/services/VideoFrameSource.ts`

**Interfaces:**
- Consumes: 现有 `diffRatio`/`frameState.wasChanged`（`captureFrame` 内）。
- Produces: `setChangeCallback(cb: () => void): void`；`captureFrame` 在 `changed && !this.frameState.wasChanged` 时调用 `changeCallback?.()`。

- [ ] **Step 1: 新增字段与 setter**

在 `VideoFrameSource` 类的 `private frameCallback` 字段之后，新增：

```ts
  private changeCallback: (() => void) | null = null
```

在 `setFrameCallback` 方法之后，新增：

```ts
  setChangeCallback(cb: () => void): void {
    this.changeCallback = cb
  }
```

- [ ] **Step 2: captureFrame 中触发突变回调**

在 `captureFrame` 里，`const changed = ...` 计算之后、`this.lastThumbBase64 = thumbBase64` 之前，新增：

```ts
      const isMutation = changed && !this.frameState.wasChanged
      if (isMutation) {
        this.changeCallback?.()
      }
```

- [ ] **Step 3: 类型检查**

Run: `npx tsc --noEmit`
Expected: 无 NEW 错误（既有错误与本任务无关）。

- [ ] **Step 4: Commit**

```bash
git add src/services/VideoFrameSource.ts
git commit -m "feat: VideoFrameSource 暴露画面突变信号"
```

---

### Task 2: Companion 接入突变触发 + 统一交互计时器

**Files:**
- Modify: `src/navigation/screens/Companion.tsx`

**Interfaces:**
- Consumes: `VideoFrameSource.setChangeCallback`（Task 1）；现有 `onSpeechEnd` 回调、`startProactive`、`armRebuild`、`statusRef`、`serviceRef`。
- Produces: `lastInteractionRef`（`useRef<number>`，初始 0）；`onSpeechEnd`/定时触发/突变触发三处更新/读取它。

- [ ] **Step 1: 新增 lastInteractionRef**

在 `proactiveTimerRef`（约第 144 行）之后，新增：

```tsx
  const lastInteractionRef = useRef<number>(0)
```

- [ ] **Step 2: 重构 startProactive 读 lastInteractionRef**

把 `startProactive` 的 `setInterval` 回调体从：

```tsx
    proactiveTimerRef.current = setInterval(() => {
      if (statusRef.current === "listening") {
        try {
          serviceRef.current?.createResponse()
        } catch (e) {
          console.warn("[companion] proactive createResponse failed", e)
        }
        armRebuild()
      }
    }, 10000)
```

改为：

```tsx
    proactiveTimerRef.current = setInterval(() => {
      if (statusRef.current === "listening" && Date.now() - lastInteractionRef.current > 10000) {
        try {
          serviceRef.current?.createResponse()
        } catch (e) {
          console.warn("[companion] proactive createResponse failed", e)
        }
        lastInteractionRef.current = Date.now()
        armRebuild()
      }
    }, 10000)
```

- [ ] **Step 3: onSpeechEnd 记录交互时间**

在 `setSpeechCallbacks` 的第二个回调（`onSpeechEnd`，约第 380-389 行）里，`armRebuild()` 之前，新增：

```tsx
          lastInteractionRef.current = Date.now()
```

- [ ] **Step 4: videoSource 设置突变回调**

在 `videoSource.setFrameCallback(...)` 之后、`videoSource.start(videoMode)` 之前，新增：

```tsx
        videoSource.setChangeCallback(() => {
          if (statusRef.current === "listening" && Date.now() - lastInteractionRef.current > 10000) {
            try {
              service.createResponse()
            } catch (e) {
              console.warn("[companion] mutation createResponse failed", e)
            }
            lastInteractionRef.current = Date.now()
            armRebuild()
          }
        })
```

- [ ] **Step 5: lint + tsc 校验**

Run: `npx eslint src/navigation/screens/Companion.tsx`
Expected: 无 error。

Run: `npx tsc --noEmit`
Expected: 无 NEW 错误。

- [ ] **Step 6: 读回确认**

Read `Companion.tsx`，确认：
- `lastInteractionRef` 在 onSpeechEnd、定时触发、突变触发三处都更新；
- 定时触发与突变触发都检查 `Date.now() - lastInteractionRef.current > 10000`；
- 突变触发仅在 `listening` 状态；
- `armRebuild()` 在三处交互后都调用；
- 未改动其他逻辑。

- [ ] **Step 7: Commit**

```bash
git add src/navigation/screens/Companion.tsx
git commit -m "feat: 画面突变主动视觉触发 + 统一交互计时器（阶段二）"
```
