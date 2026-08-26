# 儿童多模态陪伴 — 视频流接入 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给现有儿童陪伴语音会话接入视频通道——摄像头取 JPEG 帧随语音发给 Qwen-Omni，解锁识物/绘本/涂鸦视觉场景。

**Architecture:** 新增 `VideoFrameSource`（封装 expo-camera 取帧 + expo-image-manipulator 压缩）；`OmniRealtimeService` 增加 `appendImage` 发 `input_image_buffer.append`；`companionStore` 增加 `videoMode`（off/onDemand/continuous）；`Companion.tsx` 加摄像头预览、模式切换与抓帧按钮。

**Tech Stack:** React Native 0.76 / Expo 52 / TypeScript(strict) / expo-camera / expo-image-manipulator / Zustand。

## Global Constraints

- 路径别名 `@/*` → `./src/*`；TypeScript strict 模式开启。
- 本项目**没有测试运行器**。验证方式：`npx tsc --noEmit` + `npm run lint`；`.test.example.ts` 为文档化断言（不接入运行器）。仓库已有 101 个 tsc 错误、16 个 lint 告警（历史遗留），本计划只保证**不新增**。
- 协议（Qwen-Omni-Realtime）：图像走 `input_image_buffer.append`（`{ type, image: base64Jpg }`）；仅 JPEG；目标 ≤720p、单帧 ≤256KB、最多 1fps；须「先发音频后发图像」。
- expo-camera 用新 API：`CameraView` + `useCameraPermissions`；`takePictureAsync({ base64, quality })` 返回 `{ uri, width, height, base64? }`。
- expo-image-manipulator 用 `manipulateAsync(uri, actions, saveOptions)`，`SaveFormat.JPEG`；resize 只允许传 width 或 height 之一（保持宽高比）。
- 默认 `videoMode: "off"`（不主动申请摄像头权限）。
- 不实现本地图像识别、视频录制/存储、家长控制面板、前后摄切换。

---

### Task 1: 安装依赖 + app.json 配置

**Files:**
- Modify: `package.json`（`npx expo install` 自动更新）
- Modify: `app.json`

**Interfaces:**
- Produces: 后续任务可 `import { CameraView, useCameraPermissions } from "expo-camera"`、`import { manipulateAsync, SaveFormat } from "expo-image-manipulator"`。

- [ ] **Step 1: 安装依赖**

Run: `npx expo install expo-camera expo-image-manipulator`
Expected: 安装成功，`package.json` 新增 `expo-camera` 与 `expo-image-manipulator`（SDK 52 兼容版本；expo-image-manipulator 需 ≥10.3.1 以保证 iOS `base64` 返回非 null）。

- [ ] **Step 2: app.json 新增 expo-camera 插件**

在 `app.json` 的 `plugins` 数组末尾（`expo-build-properties` 之后）新增：

```json
      [
        "expo-camera",
        {
          "cameraPermission": "允许使用摄像头来识别孩子指向的物体。"
        }
      ]
```

（`expo-build-properties` 条目以 `]` 结尾，需在其后加 `,` 再插入本条目。）

- [ ] **Step 3: 类型检查**

Run: `npx tsc --noEmit`
Expected: 仍为 101 个错误（baseline），无新增。

- [ ] **Step 4: 提交**

```bash
git add package.json package-lock.json app.json
git commit -m "feat: 添加 expo-camera 与 expo-image-manipulator 依赖"
```

---

### Task 2: OmniRealtimeService.appendImage

**Files:**
- Modify: `src/services/OmniRealtimeService.ts`（在 `appendAudio` 之后新增 `appendImage`）
- Create: `src/services/OmniRealtimeService.test.example.ts`（若尚未针对 appendImage 断言，则新增该文件；若已存在则追加用例）

**Interfaces:**
- Consumes: 无（本任务只改现有 service）
- Produces: `appendImage(base64Jpg: string): void`（被 Task 5 使用）

- [ ] **Step 1: 新增 `appendImage` 方法**

在 `appendAudio` 方法之后、`cancelResponse` 之前插入：

```ts
  // 将 JPEG 图像帧推入模型的输入图像缓冲（base64，单帧 ≤256KB）
  appendImage(base64Jpg: string): void {
    if (!this.connected || !this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error("[omni-realtime] WebSocket is not connected.")
    }
    if (typeof base64Jpg !== "string" || base64Jpg.length === 0) {
      throw new TypeError("[omni-realtime] Image must be a non-empty base64 string.")
    }
    this.send({ type: "input_image_buffer.append", image: base64Jpg })
  }
```

- [ ] **Step 2: 追加文档化断言**

若 `src/services/OmniRealtimeService.test.example.ts` 已存在，追加；否则创建。追加以下用例（沿用文件内已有的 `MockSocket`/`assert`）：

```ts
// appendImage 消息构造
;(service as any).send = (m: any) => sock.sent.push(JSON.stringify(m))
;(service as any).connected = true
service.appendImage("aGVsbG8=")
const img = JSON.parse(sock.sent[sock.sent.length - 1])
assert(img.type === "input_image_buffer.append", "appendImage type")
assert(img.image === "aGVsbG8=", "appendImage image field")
```

- [ ] **Step 3: 类型检查**

Run: `npx tsc --noEmit`
Expected: 仍为 101 个错误，无新增。

- [ ] **Step 4: Lint**

Run: `npm run lint`
Expected: 仍为 16 个告警，无新增。

- [ ] **Step 5: 提交**

```bash
git add src/services/OmniRealtimeService.ts src/services/OmniRealtimeService.test.example.ts
git commit -m "feat: OmniRealtimeService 增加 appendImage 图像帧发送"
```

---

### Task 3: VideoFrameSource

**Files:**
- Create: `src/services/VideoFrameSource.ts`
- Create: `src/services/VideoFrameSource.test.example.ts`

**Interfaces:**
- Consumes: `expo-camera`（`CameraView`）、`expo-image-manipulator`（`manipulateAsync`、`SaveFormat`）
- Produces（被 Task 5 使用）:
  - `const MAX_FRAME_BYTES = 256 * 1024`
  - `estimateJpegBytes(base64: string): number`
  - `fitsSizeLimit(base64: string, maxBytes?: number): boolean`
  - `class VideoFrameSource`：`setCameraRef(ref: RefObject<CameraView>)`、`setFrameCallback(cb: (base64Jpg: string) => void)`、`start(mode: "onDemand" | "continuous")`、`stop()`、`captureFrame(): Promise<void>`

- [ ] **Step 1: 创建 `src/services/VideoFrameSource.ts`**

```ts
/**
 * VideoFrameSource
 * 封装 expo-camera 取帧与 expo-image-manipulator 压缩，产出符合协议约束的 JPEG base64 帧。
 */

import type { RefObject } from "react"
import { CameraView } from "expo-camera"
import { manipulateAsync, SaveFormat } from "expo-image-manipulator"

export const MAX_FRAME_BYTES = 256 * 1024

// 由 base64 长度估算原始字节数（base64 每 4 字符约编码 3 字节）
export function estimateJpegBytes(base64: string): number {
  return Math.floor((base64.length * 3) / 4)
}

export function fitsSizeLimit(base64: string, maxBytes: number = MAX_FRAME_BYTES): boolean {
  return estimateJpegBytes(base64) <= maxBytes
}

const CONTINUOUS_INTERVAL_MS = 1000
const TARGET_WIDTH = 1280
const FALLBACK_WIDTH = 960

export class VideoFrameSource {
  private cameraRef: RefObject<CameraView> | null = null
  private timer: ReturnType<typeof setInterval> | null = null
  private busy: boolean = false
  private frameCallback: ((base64Jpg: string) => void) | null = null

  setCameraRef(ref: RefObject<CameraView>): void {
    this.cameraRef = ref
  }

  setFrameCallback(cb: (base64Jpg: string) => void): void {
    this.frameCallback = cb
  }

  start(mode: "onDemand" | "continuous"): void {
    this.stop()
    if (mode === "continuous") {
      this.timer = setInterval(() => {
        this.captureFrame()
      }, CONTINUOUS_INTERVAL_MS)
    }
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
    this.busy = false
  }

  async captureFrame(): Promise<void> {
    if (this.busy || !this.cameraRef?.current) {
      return
    }
    this.busy = true
    try {
      const photo = await this.cameraRef.current.takePictureAsync({ base64: false })

      let result = await manipulateAsync(
        photo.uri,
        [{ resize: { width: TARGET_WIDTH } }],
        { compress: 0.7, format: SaveFormat.JPEG, base64: true }
      )

      if (!result.base64 || !fitsSizeLimit(result.base64)) {
        result = await manipulateAsync(
          photo.uri,
          [{ resize: { width: FALLBACK_WIDTH } }],
          { compress: 0.5, format: SaveFormat.JPEG, base64: true }
        )
      }

      if (result.base64 && fitsSizeLimit(result.base64)) {
        this.frameCallback?.(result.base64)
      } else {
        console.warn("[video-frame] Frame exceeds size limit, dropped")
      }
    } catch (e) {
      console.warn("[video-frame] capture failed", e)
    } finally {
      this.busy = false
    }
  }
}
```

- [ ] **Step 2: 创建 `src/services/VideoFrameSource.test.example.ts`**

```ts
/**
 * 文档化断言示例：验证帧尺寸约束的纯函数逻辑。
 */
import { estimateJpegBytes, fitsSizeLimit, MAX_FRAME_BYTES } from "./VideoFrameSource"

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`assert failed: ${msg}`)
}

assert(estimateJpegBytes("") === 0, "empty base64 -> 0 bytes")
assert(estimateJpegBytes("aGVsbG8=") >= 3, "estimate is non-trivial")
assert(fitsSizeLimit("a".repeat(100)), "small frame fits")
assert(!fitsSizeLimit("a".repeat(400000)), "oversized frame rejected")
assert(MAX_FRAME_BYTES === 256 * 1024, "256KB limit")

console.log("VideoFrameSource example assertions passed")
```

- [ ] **Step 3: 类型检查**

Run: `npx tsc --noEmit`
Expected: 仍为 101 个错误，无新增。

- [ ] **Step 4: Lint**

Run: `npm run lint`
Expected: 仍为 16 个告警，无新增。

- [ ] **Step 5: 提交**

```bash
git add src/services/VideoFrameSource.ts src/services/VideoFrameSource.test.example.ts
git commit -m "feat: 新增 VideoFrameSource 视频帧采集与压缩"
```

---

### Task 4: companionStore 增加 videoMode

**Files:**
- Modify: `src/stores/companionStore.ts`

**Interfaces:**
- Consumes: 无
- Produces（被 Task 5 使用）: `VIDEO_MODES`、`VideoMode`、`useCompanionStore` 的 `videoMode` / `setVideoMode`

- [ ] **Step 1: 新增 VIDEO_MODES / VideoMode**

在 `COMPANION_VOICES` 定义之后新增：

```ts
export const VIDEO_MODES = ["off", "onDemand", "continuous"] as const
export type VideoMode = (typeof VIDEO_MODES)[number]
```

- [ ] **Step 2: 扩展 CompanionState 接口**

在 `CompanionState` 接口的 `voice` 之后新增字段：

```ts
  videoMode: VideoMode
  setVideoMode: (mode: VideoMode) => void
```

- [ ] **Step 3: 扩展 store 默认值与 setter**

在 `setVoice` 之后新增默认值与 setter：

```ts
      videoMode: "off",
      setVideoMode: (videoMode) => set({ videoMode }),
```

- [ ] **Step 4: 扩展 merge 校验**

在 `merge` 内、`saved.voice` 校验之后新增：

```ts
        if (saved.videoMode && VIDEO_MODES.includes(saved.videoMode as any)) {
          loaded.videoMode = saved.videoMode
        }
```

- [ ] **Step 5: 类型检查**

Run: `npx tsc --noEmit`
Expected: 仍为 101 个错误，无新增。

- [ ] **Step 6: Lint**

Run: `npm run lint`
Expected: 仍为 16 个告警，无新增。

- [ ] **Step 7: 提交**

```bash
git add src/stores/companionStore.ts
git commit -m "feat: companionStore 增加 videoMode 视频模式"
```

---

### Task 5: Companion 屏幕集成视频

**Files:**
- Modify: `src/navigation/screens/Companion.tsx`

**Interfaces:**
- Consumes: `appendImage`（Task 2）、`VideoFrameSource`（Task 3）、`VIDEO_MODES`/`VideoMode`/`videoMode`/`setVideoMode`（Task 4）、`CameraView`/`useCameraPermissions`（Task 1）

- [ ] **Step 1: 新增 imports**

在顶部 import 区新增：

```ts
import { CameraView, useCameraPermissions } from "expo-camera"
import { VideoFrameSource } from "@/services/VideoFrameSource"
```

并将 companionStore 的 import 追加 `VIDEO_MODES`、`VideoMode`：

```ts
import {
  useCompanionStore,
  getCompanionInstructions,
  AGE_MODES,
  COMPANION_VOICES,
  VIDEO_MODES,
  AgeMode,
  CompanionVoice,
  VideoMode,
} from "@/stores/companionStore"
```

- [ ] **Step 2: 新增类型与常量**

在 `AGE_MODE_TITLES` 之后新增：

```ts
const VIDEO_MODE_TITLES: Record<VideoMode, string> = {
  off: "关",
  onDemand: "按需抓帧",
  continuous: "持续推送",
}
```

- [ ] **Step 3: 从 store 取 videoMode 并新增 refs / 权限**

把 `const { ageMode, voice, setAgeMode, setVoice } = useCompanionStore()` 改为：

```ts
  const { ageMode, voice, videoMode, setAgeMode, setVoice, setVideoMode } = useCompanionStore()
  const [cameraPermission, requestCameraPermission] = useCameraPermissions()
```

在现有 refs 之后新增：

```ts
  const cameraRef = useRef<CameraView>(null)
  const videoSourceRef = useRef<VideoFrameSource | null>(null)
```

在 `voiceOptions` 之后新增：

```ts
  const videoModeOptions: MenuAction[] = VIDEO_MODES.map((m) => ({ id: m, title: VIDEO_MODE_TITLES[m] }))
```

- [ ] **Step 4: 请求摄像头权限的 effect**

在麦克风权限 `useEffect` 之后新增：

```ts
  useEffect(() => {
    if (
      videoMode !== "off" &&
      cameraPermission &&
      !cameraPermission.granted &&
      cameraPermission.canAskAgain
    ) {
      requestCameraPermission()
    }
  }, [videoMode, cameraPermission])
```

- [ ] **Step 5: teardown 增加视频清理**

在 `teardown` 函数内、`serviceRef.current = null` 之前新增：

```ts
    videoSourceRef.current?.stop()
    videoSourceRef.current = null
```

- [ ] **Step 6: handleStart 启动视频源**

在 `handleStart` 的 `audioSource.startProcessing(...)` 之后（`try` 块内）新增：

```ts
      if (videoMode !== "off" && cameraPermission?.granted) {
        const videoSource = new VideoFrameSource()
        videoSource.setCameraRef(cameraRef)
        videoSource.setFrameCallback((b64) => {
          if (service.isReady()) {
            try {
              service.appendImage(b64)
            } catch (e) {
              console.warn("[companion] appendImage failed", e)
            }
          }
        })
        videoSource.start(videoMode)
        videoSourceRef.current = videoSource
      }
```

- [ ] **Step 7: cleanup effect 增加视频清理**

在组件卸载 cleanup `useEffect` 内（`serviceRef.current?.disconnect()` 之后）新增：

```ts
      videoSourceRef.current?.stop()
```

- [ ] **Step 8: 新增「视频」UI 区块**

在「音色」区块（`<View style={styles.section}>` … 音色 Picker …）之后、「开始/停止」按钮区块之前，新增：

```tsx
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>视频</Text>
        <Picker
          actions={videoModeOptions}
          onSelect={(id) => setVideoMode(id as VideoMode)}
          value={videoMode}
          disabled={isRunning}
        >
          <TouchableOpacity style={styles.pickerButton}>
            <Text style={styles.pickerButtonText}>{VIDEO_MODE_TITLES[videoMode]}</Text>
          </TouchableOpacity>
        </Picker>

        {videoMode !== "off" &&
          (cameraPermission?.granted ? (
            <>
              <CameraView ref={cameraRef} facing="back" style={styles.camera} />
              {videoMode === "onDemand" && (
                <TouchableOpacity
                  style={styles.captureButton}
                  onPress={() => videoSourceRef.current?.captureFrame()}
                >
                  <Text style={styles.buttonText}>看这个</Text>
                </TouchableOpacity>
              )}
            </>
          ) : (
            <Text style={styles.errorText}>未授权摄像头，请在系统设置中开启</Text>
          ))}
      </View>
```

- [ ] **Step 9: 新增样式**

在 `styles` 对象内新增：

```ts
  camera: {
    width: "100%",
    height: 200,
    borderRadius: 10,
    overflow: "hidden",
    marginTop: 10,
  },
  captureButton: {
    backgroundColor: Colors.primary,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: "center",
    marginTop: 10,
  },
```

- [ ] **Step 10: 类型检查**

Run: `npx tsc --noEmit`
Expected: 仍为 101 个错误，无新增。

- [ ] **Step 11: Lint**

Run: `npm run lint`
Expected: 仍为 16 个告警，无新增。

- [ ] **Step 12: 提交**

```bash
git add src/navigation/screens/Companion.tsx
git commit -m "feat: Companion 屏幕集成摄像头预览与视频模式"
```

---

### Task 6: 真机手测验收

无代码改动，按清单验收（`npm run ios` / `npm run android`，导航到「儿童陪伴」）。

- [ ] **Step 1: 按需抓帧** — 视频模式切「按需抓帧」，点「开始陪伴」→ 出现摄像头预览 → 把物体对准镜头 → 点「看这个」→ 问「这是什么」→ AI 用语音回答识别结果。
- [ ] **Step 2: 持续推送** — 切「持续推送」→ 开始后摄像头持续送帧（约 1fps）→ 拿物体到镜头前问话 → AI 能结合画面回答。
- [ ] **Step 3: 模式切换** — 运行中切换模式被禁用；停止后可切换。
- [ ] **Step 4: 权限拒绝** — 拒绝摄像头权限 → 视频区显示「未授权摄像头」提示，语音对话不受影响。
- [ ] **Step 5: 语音回退** — 视频模式「关」时无摄像头预览，纯语音对话正常。

---

## Self-Review 记录

- **Spec 覆盖**：依赖与权限（Task 1）、appendImage（Task 2）、VideoFrameSource 采集/压缩（Task 3）、videoMode 存储（Task 4）、Companion 预览/切换/抓帧/接线（Task 5）、真机验收（Task 6）。spec 的「范围外」（本地识别/录制/家长面板/前后摄切换）无对应任务，符合预期。
- **占位符**：无 TBD/TODO；expo 依赖版本由 `npx expo install` 自动匹配 SDK 52，非占位符。
- **类型一致性**：`appendImage(base64Jpg: string)`、`VideoFrameSource.setCameraRef/setFrameCallback/start/captureFrame`、`VIDEO_MODES`/`VideoMode`/`videoMode`/`setVideoMode` 在各任务间一致。
