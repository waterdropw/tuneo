# 儿童多模态陪伴 — 原生视频流取帧设计文档

- 日期：2026-08-28
- 状态：备查（暂不实现，待产品确认「连续视觉」需求后再启动）
- 前置：`2026-08-26-children-multimodal-companion-video-design.md`（视频取帧）、`2026-08-27-companion-adaptive-framerate-design.md`（自适应帧率）
- 相关分支：dev

## 1. 背景与目标

当前视频取帧走 `expo-camera` 的「拍照」模式（`takePictureAsync`）+ `expo-image-manipulator` 压缩，产出的帧率很低（onDemand 5s / continuous 1s，即 0.2–1 fps）。这个频率下拍照模式完全够用、不是瓶颈。

本方案是为**未来可能的「连续视觉」**（实时识物 / 绘本跟随 / 安全提醒需要 10fps+ 的连续画面）预留的原生取帧设计：用系统原生相机管线直接产出视频帧，替代「拍照 + JS 层压缩」的低频链路。

**当前不实现**——只有产品确认需要连续视觉时才启动。

## 2. 范围

### 2.1 范围内

- iOS：`AVCaptureSession` + `AVCaptureVideoDataOutput` 原生取帧
- 原生层 JPEG 压缩（ImageIO/CoreGraphics）与缩略图变化检测
- 预览统一到原生 `AVCaptureVideoPreviewLayer`
- 通过 Expo Module event 把 base64 帧发 JS
- Android：`Camera2` API 对称设计（本方案只描述，不同步实现）

### 2.2 范围外

- 低频抓帧的即时优化（当前拍照模式够用）
- 视频编码 / 录制 / 推流
- 硬件编解码

## 3. 现状

`src/services/VideoFrameSource.ts` 的链路：

1. `CameraView.takePictureAsync({ base64: false })` —— 每次触发一次完整拍照，写文件
2. `manipulateAsync` resize 到 320 宽 JPEG（发模型）
3. `manipulateAsync` resize 到 16×16 PNG（仅用于画面变化检测，不发模型）
4. 每帧临时文件用完即删（`uris` 清理）
5. 自适应帧率状态机（`adaptiveFramerate`）控制抓帧间隔

问题：`takePictureAsync` 是「拍照」语义而非「视频流」，每帧都走「拍一张 → 落盘 → 读回 → 压缩」的完整链路，无法支撑高帧率。

## 4. 方案

### 4.1 iOS 原生取帧

核心：一个 `AVCaptureSession` 同时负责**预览**和**取帧**，避免与 `expo-camera` 内部 session 冲突。

```
AVCaptureSession
 ├─ AVCaptureDeviceInput (camera)
 ├─ AVCaptureVideoDataOutput   → 取帧（CMSampleBuffer → JPEG base64 → event 发 JS）
 │    └─ sampleBufferDelegate（设 min/max frame rate，或 JS 按需启停）
 └─ AVCaptureVideoPreviewLayer → 预览（嵌入原生 view，替代 CameraView）
```

- **取帧**：`AVCaptureVideoDataOutput` 的 delegate 回调 `CMSampleBuffer`，用 `CGImage` + `ImageIO` 压缩成 320 宽 JPEG；16×16 缩略图也用 `CoreGraphics` 缩放，原生层算变化检测。
- **输出**：新增 Expo Module（或扩展现有 native 模块），`Events("onFrame")` 把 `{ base64, thumbBase64 }` 发 JS。
- **预览**：`AVCaptureVideoPreviewLayer` 通过一个原生 view 组件嵌入 React 树，替代 `CameraView`。

### 4.2 Android 对称设计（仅描述）

`Camera2` API：`CameraDevice` + `ImageReader`（或 `Surface` + `MediaCodec`）取帧，`YUV_420_888`/JPEG 转 base64；预览走 `TextureView`/`SurfaceView`。同样用原生模块 event 发帧。

### 4.3 JS 层

`VideoFrameSource` 改为消费原生 `onFrame` event（而非调用 `takePictureAsync`），保留现有自适应帧率 / 变化检测 / `appendImage` 逻辑不变——只是「取帧」这一步从 JS 拍照换成原生推流。

## 5. 关键设计点

1. **session 独占**：iOS 摄像头同一时间通常只能被一个 capture session 占用。必须把「预览」也从 `expo-camera` 的 `CameraView` 切到原生 `previewLayer`，统一进同一个 session，否则两个 session 抢摄像头冲突。这是本方案与音频改造（录音/播放共用 engine）最大的不同点——改动面是「整条相机链路替换」。
2. **压缩下放到原生**：JPEG 压缩（320 宽）和 16×16 缩略图都在原生层完成，省掉 `expo-image-manipulator` 的 bridge 开销和每帧文件读写。
3. **帧率控制**：低帧率时用 JS 按需启停（start/stop 取帧），或原生 `AVCaptureVideoDataOutput` 的 frame rate 配置；高帧率连续视觉时再放开。
4. **变化检测下放**：16×16 缩略图的 diff 计算可保留在 JS（逻辑简单、已有实现），只把「生成缩略图」下放原生。
5. **内存**：`CMSampleBuffer` 需及时释放，delegate 回调里同步压缩后立即返回，避免队列积压。

## 6. 组件改动（实施时）

- 新建原生模块（如 `native-video-stream`）：iOS `AVCaptureSession` 取帧 + preview view；Android `Camera2` 对称实现
- 修改 `src/services/VideoFrameSource.ts`：消费原生 `onFrame` event，替换 `takePictureAsync`/`manipulateAsync`
- 修改 `Companion.tsx`：预览组件从 `CameraView` 换成原生 preview view

## 7. 触发条件（何时启动）

满足任一即启动：

- 产品确认需要**连续视觉**（10fps+ 实时识物/绘本/安全提醒）
- 实测低频抓帧出现明显延迟/卡顿，拍照模式成为瓶颈

在此之前维持现状（`expo-camera` 拍照模式）。

## 8. 测试

- 真机验证预览正常、帧率达标、`appendImage` 帧尺寸 ≤256KB 协议限制
- 连续视觉场景（高帧率）下无内存增长、无 session 冲突
- 与现有自适应帧率 / 变化检测逻辑兼容

## 9. 明确不做的（YAGNI）

- 视频编码 / 录制 / 推流
- 低频抓帧的即时优化（现状够用）
- 光流 / 运动估计
