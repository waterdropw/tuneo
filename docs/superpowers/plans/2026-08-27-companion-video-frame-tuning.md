# 视频帧分辨率与频率调整 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 视频帧统一降到 320 宽，`continuous` 保持 1s 一帧，`onDemand` 从手动按钮改为 5s 自动抓帧。

**Architecture:** `VideoFrameSource.ts` 里 `TARGET_WIDTH` 改 320、删除 `FALLBACK_WIDTH` 二级回退、`onDemand` 模式启用 5s 定时器（复用 `captureFrame`）；`Companion.tsx` 移除「看这个」手动按钮。仍用 `manipulateAsync` 缩放而非 `pictureSize`（设备相关枚举，兼容复杂）。

**Tech Stack:** TypeScript、expo-camera、expo-image-manipulator。

## Global Constraints

- `TARGET_WIDTH` 1280 → 320；删除 `FALLBACK_WIDTH`（960）与二级回退分支。
- `CONTINUOUS_INTERVAL_MS` 保持 1000；新增 `ON_DEMAND_INTERVAL_MS = 5000`。
- `compress: 0.7` 保持；`fitsSizeLimit` 检查保留（兜底丢弃超限帧）。
- `onDemand` 模式改为自动 5s 定时抓帧，复用现有 `captureFrame()`。
- 移除 `Companion.tsx` 中 `onDemand` 的「看这个」`captureButton` 及其 `captureFrame` 触发。
- 不引入新依赖；视频模式三态（关/按需/持续）UI 保留。
- 本项目无测试运行器；`fitsSizeLimit` 已有断言覆盖，本次调参无新增纯函数逻辑。

---

### Task 1: 视频帧 320 宽 + onDemand 5s 自动抓帧

**Files:**
- Modify: `src/services/VideoFrameSource.ts`
- Modify: `src/navigation/screens/Companion.tsx`

**Interfaces:**
- Consumes: `captureFrame(): Promise<void>`（现有，被两个模式的定时器复用）；`videoSource.start(mode: "onDemand" | "continuous")`（现有签名不变）。
- Produces: `start(mode)` 内部为 `onDemand` 模式启动 5s 定时器；`Companion.tsx` 移除手动抓帧按钮。

- [ ] **Step 1: 改 `VideoFrameSource.ts` 常量**

把 `src/services/VideoFrameSource.ts` 顶部的
```ts
const CONTINUOUS_INTERVAL_MS = 1000
const TARGET_WIDTH = 1280
const FALLBACK_WIDTH = 960
```
改为
```ts
const CONTINUOUS_INTERVAL_MS = 1000
const ON_DEMAND_INTERVAL_MS = 5000
const TARGET_WIDTH = 320
```

- [ ] **Step 2: `start(mode)` 让 onDemand 也启用定时器**

把 `src/services/VideoFrameSource.ts` 的
```ts
  start(mode: "onDemand" | "continuous"): void {
    this.stop()
    if (mode === "continuous") {
      this.timer = setInterval(() => {
        this.captureFrame()
      }, CONTINUOUS_INTERVAL_MS)
    }
  }
```
改为
```ts
  start(mode: "onDemand" | "continuous"): void {
    this.stop()
    const interval = mode === "continuous" ? CONTINUOUS_INTERVAL_MS : ON_DEMAND_INTERVAL_MS
    this.timer = setInterval(() => {
      this.captureFrame()
    }, interval)
  }
```

- [ ] **Step 3: 删除二级回退分支**

把 `src/services/VideoFrameSource.ts` 的 `captureFrame` 里这段
```ts
      let result = await manipulateAsync(
        photo.uri,
        [{ resize: { width: TARGET_WIDTH } }],
        { compress: 0.7, format: SaveFormat.JPEG, base64: true }
      )
      uris.push(result.uri)

      if (!result.base64 || !fitsSizeLimit(result.base64)) {
        result = await manipulateAsync(
          photo.uri,
          [{ resize: { width: FALLBACK_WIDTH } }],
          { compress: 0.5, format: SaveFormat.JPEG, base64: true }
        )
        uris.push(result.uri)
      }
```
改为
```ts
      const result = await manipulateAsync(
        photo.uri,
        [{ resize: { width: TARGET_WIDTH } }],
        { compress: 0.7, format: SaveFormat.JPEG, base64: true }
      )
      uris.push(result.uri)
```

- [ ] **Step 4: 移除「看这个」按钮**

删除 `src/navigation/screens/Companion.tsx` 里 `videoMode === "onDemand" && isRunning && cameraPermission?.granted && (...)` 这整块（`captureButton` TouchableOpacity），以及样式表里的 `captureButton` 样式定义。

具体：删除
```tsx
        {videoMode === "onDemand" && isRunning && cameraPermission?.granted && (
          <TouchableOpacity
            style={styles.captureButton}
            onPress={() => {
              setMessages((prev) => [...prev, { role: "user", text: "[图片]", ts: Date.now() }])
              videoSourceRef.current?.captureFrame()
            }}
          >
            <Text style={styles.buttonText}>看这个</Text>
          </TouchableOpacity>
        )}
```
和样式表中的
```ts
  captureButton: {
    backgroundColor: Colors.primary,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: "center",
    marginTop: 10,
  },
```

- [ ] **Step 5: lint + tsc 校验**

Run: `npx eslint src/services/VideoFrameSource.ts src/navigation/screens/Companion.tsx`
Expected: 无 error。

Run: `npx tsc --noEmit`
Expected: 无 NEW 错误（`Spectrum.tsx`/`notes.ts`/`AutoDetectBilingualAsrService.test.example.ts` 的既有错误与本任务无关，忽略）。

- [ ] **Step 6: Commit**

```bash
git add src/services/VideoFrameSource.ts src/navigation/screens/Companion.tsx
git commit -m "feat: 视频帧降为 320 宽，onDemand 改 5s 自动抓帧"
```
