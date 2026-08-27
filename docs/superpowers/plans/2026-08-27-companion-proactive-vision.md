# 定时主动视觉触发 实现计划（阶段一）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 `listening` 状态每 10s 定时调用 `createResponse()`，让模型「看当前画面判断要不要提醒」，验证「客户端主动触发 → 模型看图提醒」链路。

**Architecture:** `Companion.tsx` 新增一个 10s `setInterval` 定时器 ref，在 `session-updated` 后、且 `videoMode !== "off"` 时启动；每次触发检查 `statusRef.current === "listening"`，若是则 try/catch 调 `createResponse()` 并重置 30s 静音重建计时器。`teardown()` 与组件卸载时清理。

**Tech Stack:** React Native、TypeScript。

## Global Constraints

- 仅改 `src/navigation/screens/Companion.tsx`。
- 触发间隔 10s；仅 `listening` 状态触发；触发时重置 30s 静音重建计时器（`armRebuild()`）。
- 仅在 `videoMode !== "off"` 时启动定时器。
- `createResponse` 独立调用，不带 `commitAudioBuffer`；用 try/catch 包裹，失败不影响会话。
- 冷启动：`session-updated` 后才启动定时器。
- 不引入新依赖。

---

### Task 1: 定时主动视觉触发

**Files:**
- Modify: `src/navigation/screens/Companion.tsx`

**Interfaces:**
- Consumes: `statusRef`（现有）、`serviceRef`（现有）、`armRebuild()`（现有）、`videoMode`（来自 `useCompanionStore()`，现有）、`teardown()`（现有）。
- Produces: 新增 ref `proactiveTimerRef`；新增 `startProactive()` / `stopProactive()`；在 `session-updated` 分支调用 `startProactive()`；在 `teardown()` 与组件卸载 effect 中调用 `stopProactive()`。

- [ ] **Step 1: 新增 proactiveTimerRef**

在 `Companion.tsx` 的 `rebuildTimerRef`（约第 143 行）之后新增：

```tsx
  const proactiveTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
```

- [ ] **Step 2: 新增 startProactive / stopProactive**

在 `armRebuild` 函数（约第 231 行结束）之后新增：

```tsx
  // 10s 定时主动触发：静默聆听中让模型看当前画面，判断是否提醒（阶段一）
  const startProactive = () => {
    stopProactive()
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
  }

  const stopProactive = () => {
    if (proactiveTimerRef.current) {
      clearInterval(proactiveTimerRef.current)
      proactiveTimerRef.current = null
    }
  }
```

- [ ] **Step 3: session-updated 时启动定时器**

在 `handleEvent` 的 `case "session-updated":` 分支（约第 235-239 行）里，`Vibration.vibrate(80)` 之后、`setStatus("listening")` 之前，新增：

```tsx
        if (videoMode !== "off") {
          startProactive()
        }
```

- [ ] **Step 4: teardown 清理定时器**

在 `teardown()` 函数（约第 198-212 行）里，`rebuildTimerRef` 清理块之后，新增：

```tsx
    stopProactive()
```

- [ ] **Step 5: 组件卸载清理定时器**

在组件卸载 effect（约第 415-423 行）的 cleanup 里，`persistMessages(...)` 之前，新增：

```tsx
      stopProactive()
```

- [ ] **Step 6: lint + tsc 校验**

Run: `npx eslint src/navigation/screens/Companion.tsx`
Expected: 无 error。

Run: `npx tsc --noEmit`
Expected: 无 NEW 错误（`Spectrum.tsx`/`notes.ts`/`AutoDetectBilingualAsrService.test.example.ts` 的既有错误与本任务无关）。

- [ ] **Step 7: 读回确认**

Read `Companion.tsx`，确认：
- 定时器仅在 `videoMode !== "off"` 且 `session-updated` 后启动；
- 每次触发检查 `statusRef.current === "listening"`，非 listening 跳过；
- `createResponse` 有 try/catch；
- 触发后调用 `armRebuild()` 重置 30s 重建计时器；
- `teardown()` 与组件卸载都 `stopProactive()`；
- 未改动其他逻辑（语音触发、30s 重建、对话渲染等）。

- [ ] **Step 8: Commit**

```bash
git add src/navigation/screens/Companion.tsx
git commit -m "feat: 定时主动视觉触发（阶段一，10s 静默时 createResponse）"
```
