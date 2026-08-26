# 儿童多模态陪伴 — 视频流接入设计文档

- 日期：2026-08-26
- 状态：已评审通过，待实现
- 前置：`2026-08-25-children-multimodal-companion-design.md`（语音版，已实现）
- 相关分支：dev

## 1. 背景与目标

语音版陪伴功能已实现并提交（`OmniRealtimeService` / `OmniAudioPlayer` / `Companion.tsx` 等）。本设计在既有语音会话上接入**视频通道**：摄像头取 JPEG 帧随语音一起发给 Qwen-Omni-Realtime 模型，让 AI「看得见」，从而解锁识物认知、绘本讲解、涂鸦理解三个视觉场景。

视频帧走 DashScope Realtime 协议的 `input_image_buffer.append`（与音频 `input_audio_buffer.append` 并列）。

## 2. 范围

### 2.1 范围内

- 新增 expo-camera 依赖 + 摄像头权限
- 两种视频模式，可切换：
  - `onDemand`（按需抓帧）：点「看这个」按钮发一帧
  - `continuous`（持续推送）：1fps 自动发帧
- 帧规格：JPEG、目标 ≤720p、单帧 ≤256KB、最多 1fps（协议约束）
- 复用现有 `OmniRealtimeService`（新增 `appendImage`）与 `companionStore`（新增 `videoMode`）

### 2.2 范围外

- 本地物体识别 / 图像处理（全部交给云端模型）
- 视频录制 / 存储
- 家长控制面板（本期仅权限 + 模式切换）
- 多路摄像头 / 前后摄切换（默认后置）

## 3. 架构与组件

### 3.1 新增 `src/services/VideoFrameSource.ts`（核心）

封装 expo-camera 的 `CameraView` ref，负责取 JPEG 帧。

- 模式：`continuous`（内部 1s 定时器自动抓帧）、`onDemand`（对外暴露 `captureFrame()`）
- 帧约束：用 `expo-image-manipulator` 缩放到 ≤720p 并压缩到 ≤256KB（JPEG quality 回退策略）
- 接口：`start()/stop()/captureFrame(): Promise<void>` + `setFrameCallback(cb)`（cb 收到 base64 JPEG）

### 3.2 修改 `src/services/OmniRealtimeService.ts`

- 新增 `appendImage(base64Jpg: string): void`，发送 `{ type: "input_image_buffer.append", image: base64Jpg }`
- 其余不变

### 3.3 修改 `src/stores/companionStore.ts`

- 新增 `videoMode: "off" | "onDemand" | "continuous"` + `setVideoMode`，默认 `"off"`（语音优先，摄像头默认不申请权限）
- 持久化到 MMKV（沿用现有 persist 模式）

### 3.4 修改 `src/navigation/screens/Companion.tsx`

- 摄像头预览（`videoMode !== "off"` 时显示）
- 模式切换（三态：关 / 按需 / 持续）
- 「看这个」抓帧按钮（`onDemand` 模式显示）
- `onFrame` → `service.appendImage(base64)`

### 3.5 修改 `app.json`

- 新增 expo-camera 配置插件 + 摄像头权限描述（iOS `NSCameraUsageDescription` / Android `CAMERA`）

## 4. 数据流

```
[开始陪伴]
  → service.connect()  （session.updated）
  → AudioSource.startProcessing()  ← 麦克风先开始（满足「先音频后图像」）
  → videoMode !== "off" 时，VideoFrameSource.start()
        ├─ 持续模式：1s 定时器 → captureFrame → 压缩 → appendImage(base64)
        └─ 按需模式：点「看这个」→ captureFrame → 压缩 → appendImage(base64)
                    ↓ WebSocket
        音频(16kHz PCM) + 图像(JPEG ≤720p/≤256KB) → Qwen-Omni 服务端 VAD 切分轮次
                    ↓
        response.audio.delta / audio_transcript.delta（同语音版，不变）
```

关键点：麦克风先于摄像头启动，天然满足协议「先发音频才能发图像」；图像只进 `input_image_buffer`，与音频共用同一轮次的上下文。

## 5. 错误处理与隐私

- 摄像头权限被拒：回退到纯语音模式，显示「未授权摄像头」提示，不崩溃
- 取帧/压缩失败：跳过该帧并 log，不影响语音对话
- 单帧超 256KB：`expo-image-manipulator` 降分辨率/质量重试，仍超则丢弃
- 隐私：`videoMode` 默认 `"off"`（不主动申请摄像头权限）；仅当切到按需/持续才请求权限并显示预览；持续模式有明确「摄像头开启」指示
- API Key：沿用现有 `EXPO_PUBLIC_` 客户端模式（已知风险，正式发布建议服务端代理）

## 6. 测试

- 纯函数：帧压缩/尺寸约束逻辑（`VideoFrameSource` 里的 resize/quality 判定）
- `OmniRealtimeService.appendImage` 消息构造（`input_image_buffer.append` + `image` 字段）
- 参考现有 `.test.example.ts` 风格写文档化断言
- 真机验收：按需抓帧识物、持续推送、模式切换、权限拒绝回退

## 7. 明确不做的（YAGNI）

- 本地物体识别 / 图像处理
- 视频录制 / 存储
- 家长控制面板
- 前后摄切换、多路摄像头
- 视频帧的服务端缓存 / 重发优化
