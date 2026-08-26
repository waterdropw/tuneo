# 儿童多模态陪伴 — 端侧 VAD 门控计费优化设计文档

- 日期：2026-08-26
- 状态：已评审通过，待实现
- 前置：`2026-08-25-children-multimodal-companion-design.md`（语音版，已实现）、`2026-08-26-children-multimodal-companion-video-design.md`（视频版，已实现）
- 相关分支：dev

## 1. 背景与目标

百炼 Realtime API 按「音频时长（秒）× 12.5」折算 Token 计费，**只要客户端持续 `input_audio_buffer.append` 就计费，无论服务端 VAD 是否检测到语音**。当前 `Companion.tsx` 对每帧麦克风音频无条件 `appendAudio`，静音与环境噪音也照发，产生大量无效费用；且多轮对话的音频历史会累积在会话中，后续每轮重复计费。

本设计引入**端侧 VAD（人声检测）门控** + **安静超时会话重建**，在无有效语音输入时不发送音频流，从而：

1. 静音/环境噪音期间零计费（端侧 VAD 挡住，不发音频）
2. 长时间安静后重建会话，避免上下文累积导致的历史音频重复计费

## 2. 范围

### 2.1 范围内

- 原生层（`microphone-stream` 模块）集成 libfvad（WebRTC VAD 的 C 实现）
- 端侧 VAD 门控：只在检测到人声时 emit `onAudioBuffer`；新增 `onSpeechStart` / `onSpeechEnd` 事件
- 服务端 VAD 关闭（`turn_detection: null`），改由端侧 `commit` + `response.create` 控制轮次
- 安静超时 30 秒后重建会话（断开重连）

### 2.2 范围外

- 视频帧的计费优化（`onDemand` / `continuous` 保持现状，视频功能正式启用时再单独设计）
- 降噪、回声消除、多麦克风、说话人分离
- 端侧语义 VAD（区分「孩子说话」与「电视人声」）
- 无感重连（重连期间孩子开口不丢字）

## 3. 架构

```
原生层 MicrophoneStreamModule（集成 libfvad）
  ├─ 每 100ms 一帧 PCM → 切块喂给 VAD
  ├─ VAD 判「人声」→ emit onAudioBuffer（发音频）+ onSpeechStart
  ├─ VAD 判「静音/噪音」→ 不 emit（不产生计费）
  └─ 连续非人声 800ms → emit onSpeechEnd

JS 层（Companion）
  ├─ onSpeechStart → 取消进行中的回复（barge-in）+ 开始 appendAudio
  ├─ onSpeechEnd → commitAudioBuffer() + createResponse()
  └─ 30 秒无人声 → disconnect() + 重连（重建会话）

服务端
  └─ turn_detection = null（关闭服务端 VAD，完全靠端侧控制轮次）
```

### 3.1 端侧 VAD 状态机

```
[静音] --VAD 连续 N 帧判 speech--> [人声进行中]
                                        │
                  连续非 speech 达 800ms
                                        ▼
                               [发 commit + response.create]
                                        │
                                        ▼
                                    [回到静音]
```

- **触发人声开始**：VAD 连续 3 帧（20ms/帧，共约 60ms）判 speech，且带 pre-roll 前置缓冲 300ms（补发 VAD 判定前丢失的开头音节）
- **判定人声结束**：VAD 连续判非 speech 达 800ms（对齐现有 `silenceDurationMs`）

## 4. 组件改动

### 4.1 原生层 `modules/microphone-stream`（核心）

集成 libfvad（纯 C 源码，几个 `.c`/`.h`），iOS 与 Android 跑同一套 C 代码：

- **iOS**：`MicrophoneStream.podspec` 的 `source_files` 已是 `**/*.{h,m,mm,swift,hpp,cpp}`，libfvad `.c/.h` 放入 module 目录即可编译；Swift 经 bridging header 调用
- **Android**：`build.gradle` 加 `externalNativeBuild`（CMake）编译同一套 libfvad C 源码，Kotlin 经 JNI 调用

在 tap 回调（iOS）/ AudioRecord 读循环（Android）中：

1. 每帧 100ms 音频切块喂 libfvad（48kHz 下 20ms/帧，约 960 samples/帧）
2. 维护 pre-roll 环形缓冲（300ms），暂存最近音频
3. VAD 连续判 speech 达阈值 → 先 flush pre-roll 缓冲，再开始 emit `onAudioBuffer`，并 emit `onSpeechStart`
4. VAD 连续判非 speech 达 800ms → emit `onSpeechEnd`，停止 emit `onAudioBuffer`
5. 静音/噪音期间不 emit 任何音频

新增事件：`onSpeechStart`、`onSpeechEnd`（与现有 `onAudioBuffer` 并列）。

### 4.2 修改 `src/services/OmniRealtimeService.ts`

- `DEFAULT_OMNI_CONFIG.turnDetection` 改为 `null`（关闭服务端 VAD）
- 新增 `commitAudioBuffer()`：发送 `{ type: "input_audio_buffer.commit" }`
- 新增 `createResponse()`：发送 `{ type: "response.create" }`
- 保留 `appendAudio` / `appendImage` / `cancelResponse` / `disconnect` 不变

### 4.3 修改 `src/services/AudioSource.ts`

- 监听并转发 `onSpeechStart` / `onSpeechEnd` 事件（新增回调参数或新增回调方法）

### 4.4 修改 `src/navigation/screens/Companion.tsx`

- `onSpeechStart` → 置 `speaking=true`，`service.cancelResponse()` + `playerRef.stop()`（替代原 `case "speech-started"` 打断逻辑），音频帧继续 `appendAudio`
- `onSpeechEnd` → `service.commitAudioBuffer()` + `service.createResponse()`，置 `speaking=false`
- 新增 30 秒静音定时器：距上次 `onSpeechEnd` 满 30s 且无新 speech → `disconnect()` + 重连

## 5. 边界与错误处理

- **打断（barge-in）**：服务端 VAD 关闭后 `speech-started` 事件不再触发，现有打断逻辑改由端侧 `onSpeechStart` 驱动（孩子开口 → 取消进行中回复 + 停播放）
- **VAD 不可用**（集成/初始化失败）：回退为「始终 emit 音频」的旧行为（= 持续发送），不崩溃
- **重连失败**：复用现有 `connect()` 错误路径（`setErrorCallback` → `teardown` + 显示错误），不无限重试
- **pre-roll 越界**：环形缓冲固定 300ms，超出丢弃，只 flush 最近 300ms
- **commit/response.create 时序**：`onSpeechEnd` 先 commit 再 create，严格顺序；socket 未 ready 时静默丢弃

## 6. 测试

- 纯函数：VAD 状态机转换（silence → speech → silence，含 pre-roll flush 判定），参考 `.test.example.ts` 风格写文档化断言
- `commitAudioBuffer` / `createResponse` 消息构造
- 原生层 VAD 门控与事件需真机验证（模拟器无麦克风）

## 7. 明确不做的（YAGNI）

- 视频帧门控/计费优化
- 降噪、回声消除、多麦克风、说话人分离
- 端侧语义 VAD（孩子 vs 电视人声）
- 无感重连
