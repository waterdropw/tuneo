# Tuneo 儿童多模态陪伴

基于阿里云 Qwen-Omni-Realtime 全模态大模型的儿童实时语音陪伴功能。孩子说话，AI 用温暖、符合年龄的语音实时回应。识物、讲故事、陪伴对话、涂鸦理解等场景都由同一套自然对话覆盖。

> 当前为语音版 MVP；视频流（摄像头取帧）已在架构上预留，尚未实现。

## 核心特性

- **全程实时连续**：服务端 VAD 自动检测说话开始/结束，无需按钮，随时能聊
- **全模态**：一个模型同时处理语音输入与语音输出（文字字幕同步）
- **年龄段可切换**：幼儿 / 儿童 / 自适应，切换人格与语言难度
- **儿童内容安全**：系统提示词约束 + 服务端内容审核兜底

## 应用场景

### 当前可用（仅语音）

| 场景 | 孩子做什么 | AI 回应 |
|------|-----------|---------|
| 陪伴对话 / 闲聊 | 自由说话 | 温柔、鼓励式语音回应 |
| 讲故事 | 「讲个小恐龙的故事」 | 语音编讲儿童故事 |
| 问答 / 知识科普 | 「为什么天是蓝的？」 | 用年龄匹配的语言解释 |
| 语言类互动（儿歌 / 绕口令 / 猜谜） | 提出要求 | 语音配合 |

### 需视频通道（预留，未实现）

| 场景 | 依赖 | 说明 |
|------|------|------|
| 识物认知学习 | 摄像头取帧 | 对准物体，AI 认出并告诉孩子「这是苹果」，可双语 |
| 看图讲故事 / 绘本讲解 | 摄像头 / 照片 | 拍绘本画面，AI 看图用儿童口吻讲解 |
| 涂鸦 / 绘画理解 | 摄像头取帧 | 孩子画画，AI 识别并鼓励、描述、延伸 |

## 年龄段模式

| 模式 | 目标年龄 | 特点 |
|------|---------|------|
| 幼儿 | 2–6 岁 | 短句、重复、鼓励、语气亲切活泼 |
| 儿童 | 6–12 岁 | 语言更丰富，可讲故事、科普 |
| 自适应 | 自动 | 根据孩子语言水平自动调整用词 |

## 技术架构

- 模型：`qwen3-omni-flash-realtime`（默认，可配置）
- 端点：`wss://dashscope.aliyuncs.com/api-ws/v1/realtime`
- 输入：PCM 16kHz 单声道 16-bit 音频（复用现有 `microphone-stream` 模块）
- 输出：PCM 24kHz 单声道 16-bit 音频 + 文本
- 交互：`session.update` / `input_audio_buffer.append` / `response.cancel`，服务端 VAD 模式

### 关键文件

| 文件 | 职责 |
|------|------|
| `src/services/OmniRealtimeService.ts` | 实时多模态对话服务（WebSocket 协议） |
| `src/services/OmniAudioPlayer.ts` | 累积 PCM → WAV → 播放 |
| `src/services/audioCodec.ts` | PCM / base64 / WAV 编解码工具 |
| `src/stores/companionStore.ts` | 年龄段 / 音色 / 系统提示词 |
| `src/navigation/screens/Companion.tsx` | 陪伴屏幕 |

## 快速开始

1. 配置 API Key（环境变量）：

   ```
   EXPO_PUBLIC_DASHSCOPE_API_KEY=sk-xxx
   ```

2. 启动 dev client 并导航到「儿童陪伴」屏幕：

   ```bash
   npm run ios      # 或 npm run android
   ```

3. 点「开始陪伴」，说话即可。

## 已知限制 / 后续计划

- 视频流输入（识物 / 绘本 / 涂鸦）尚未实现，架构已预留 `input_image_buffer`
- 断线自动重连未实现，断线后需手动重新开始
- 模型 / 音色 ID 属外部 API 数据，需对照 DashScope 控制台核对
- `EXPO_PUBLIC_` 前缀的 Key 会打进客户端包，正式发布建议走服务端代理

## 参考文档

- 设计文档：`docs/superpowers/specs/2026-08-25-children-multimodal-companion-design.md`
- 实现计划：`docs/superpowers/plans/2026-08-25-children-multimodal-companion.md`
