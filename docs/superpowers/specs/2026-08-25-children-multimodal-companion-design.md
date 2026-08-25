# 儿童多模态陪伴功能设计文档

- 日期：2026-08-25
- 状态：已评审通过，待实现
- 相关分支：dev

## 1. 背景与目标

项目当前是一个 React Native 应用（吉他调音器 + 阿里云 DashScope ASR/TTS 实时转译），已具备麦克风采集、音频处理、WebSocket 服务基类等基建。

本功能新增一个面向幼儿/儿童的**实时多模态陪伴**能力：孩子对着手机说话，云端 Qwen-Omni-Realtime 全模态大模型用儿童友好的语音实时回应。识物、讲故事、陪伴对话、涂鸦理解等场景最终都通过同一套自然对话覆盖。

MVP 仅启用语音通道，视频流（摄像头取帧）在架构上预留、本期不实现。

## 2. 范围

### 2.1 MVP 范围内

- 实时语音对话（server VAD 自动检测说话结束，无需按钮交互）
- 全年龄段可切换（幼儿 2-6 / 儿童 6-12 / 自适应），通过系统提示词 + 音色切换实现
- 模型返回的语音实时播放 + 文字字幕
- 儿童内容安全约束（系统提示词 + DashScope 服务端内容审核兜底）

### 2.2 MVP 范围外（预留，不实现）

- 视频流输入（摄像头取帧）——协议上预留 `input_video_buffer` 通道
- 渐进式流式播放（MVP 采用「收完整段 → 播放」，而非边收边播）

## 3. 模型与端点

- 默认模型：`qwen3-omni-flash-realtime`（低成本、低延迟；可配置）。备选：`qwen3.5-omni-flash-realtime-2026-03-15`。
  - 注：精确模型 ID 需在实现阶段以 DashScope 控制台/文档为准确认。
- 端点：`wss://dashscope.aliyuncs.com/api-ws/v1/realtime`（与现有 ASR/TTS 使用的 `/api-ws/v1/inference` 不同）。
- 输入：PCM 16000Hz 单声道 16-bit 音频。
- 输出：PCM 24000Hz 单声道 16-bit 音频 + 文本。

## 4. 架构与组件

### 4.1 新增 `src/services/OmniRealtimeService.ts`（核心）

与现有 `BaseWebSocketService` 同级，但实现 Realtime 协议（`type` 事件制消息，非 `header`/`payload`）。

- 连接生命周期沿用现有模式：`connect()` / `disconnect()` / `isReady()` / `getTaskId()`。
- 会话配置：`session.update`（音色、系统提示词、输入/输出音频格式、`enable_turn_detection=true` 开启 server VAD）。
- 消息：`input_audio_buffer.append` 持续推音频；预留 `response.create`（手动模式）。
- 回调（仿现有服务风格）：
  - `setAudioDeltaCallback(cb)`：流式音频分片（base64 PCM 24kHz）
  - `setTranscriptCallback(cb)`：文字字幕
  - `setEventCallback(cb)`：生命周期 / 打断 / 结束事件
  - `setErrorCallback(cb)`

### 4.2 配置 `OmniRealtimeConfig`

字段：`model`、`voice`、`instructions`（按年龄段生成）、`turn_detection` 参数、音频格式。

### 4.3 音频采集

复用现有 `microphone-stream` 模块 + `AudioSource`（已有重采样到 16kHz 的管线，匹配模型输入）。

### 4.4 音频播放 `OmniAudioPlayer`

累积 PCM 分片 → 加 WAV 头 → 写临时文件 → `expo-audio` 播放。与现有 TTS「累积 → 写文件 → 播放」模式一致。

### 4.5 屏幕 `src/navigation/screens/Companion.tsx`

- 大按钮「开始/停止陪伴」+ 实时字幕区 + 说话/聆听状态指示
- 年龄段切换、音色选择（下拉，复用现有 `Picker`）
- 注册进 `RootStack`（`src/navigation/index.tsx`）。默认不改 `initialRouteName`（保持 `bilingual`），陪伴页通过导航进入；如需设为默认首页后续再调整。

### 4.6 状态与配置

年龄段、音色存入现有 Zustand `configStore`（或新建 `companionStore`），持久化到 MMKV。

## 5. 数据流

```
[孩子说话] → microphone-stream (PCM 16kHz 流)
              → AudioSource 处理（重采样/分帧）
                → OmniRealtimeService: input_audio_buffer.append（持续推流）
                    ↓ WebSocket /api-ws/v1/realtime
                [Qwen-Omni-Realtime] server VAD 检测说话结束 → 流式生成
                    ↓
                response.audio.delta（base64 PCM 24kHz）→ OmniAudioPlayer 累积→WAV→播放
                response.audio_transcript.delta（文字） → 字幕区实时显示
                response.done / 打断事件                   → 状态指示更新
```

### 轮次与打断

`enable_turn_detection=true` 时，服务端自动判断孩子说完并开始回复；孩子再次开口可打断当前回复，客户端监听对应事件停止播放、清空缓冲。

### 状态机（屏幕内）

`idle → connecting → listening（聆听中）→ responding（回复中，可被打断）→ idle`，字幕与指示随事件流转。

## 6. 错误处理与安全

- 连接/网络：断线自动重连（复用现有重试思路）；`onclose` / `onerror` 更新 UI 并提示。
- 无 API Key：启动前校验 `EXPO_PUBLIC_DASHSCOPE_API_KEY`，缺失则友好提示（沿用 `BaseWebSocketService` 抛错）。
- 播放失败：临时文件写失败/解码失败时清理文件并回到 `idle`，不崩溃。
- 内容安全：系统提示词强制「儿童友好、积极、无暴力/恐怖/成人内容」；DashScope 服务端内容审核兜底。
- 已知风险：`EXPO_PUBLIC_` 前缀的 Key 会打进客户端包，可被逆向提取。现有 ASR/TTS 已是此模式；若正式发布建议走服务端代理。本期沿用现状。

## 7. 测试

- 单测 `OmniRealtimeService`：消息构造（session.update / append 编码）、分片累积逻辑、状态机迁移（用 mock WebSocket）。
- `OmniAudioPlayer`：PCM→WAV 头拼接正确性、缓冲清空逻辑。
- 参考现有 `AutoDetectBilingualAsrService.test.example.ts` 风格写测试示例。
- 手工验收清单：开始 → 说话 → 收到语音回复；打断；年龄段切换后语气/音色变化；断网重连。

## 8. 明确不做的（YAGNI）

- 摄像头/视频流输入
- 渐进式流式播放
- 多模态工具调用（function calling）、联网搜索
- 服务端 Key 代理
- 用户账号/历史会话持久化
