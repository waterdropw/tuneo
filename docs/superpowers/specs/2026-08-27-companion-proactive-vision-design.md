# 儿童多模态陪伴 — 定时主动视觉触发设计文档（阶段一）

- 日期：2026-08-27
- 状态：已评审通过，待实现
- 前置：`2026-08-27-companion-adaptive-framerate-design.md`（自适应帧率，已实现）
- 相关分支：dev

## 1. 背景与目标

危险预警是产品主场景（孩子自由行走不说话，靠画面判断危险）。但当前「端侧 VAD 完全接管」架构下，模型生成回复的唯一触发点是 `createResponse()`，且只在 `onSpeechEnd` 时调用——只发图片、孩子不说话时模型完全静默。

本设计（阶段一）验证「客户端主动触发 → 模型看图提醒」这条链路：在 `listening` 状态（静默聆听中）定时调用 `createResponse()`，让模型「看当前画面判断要不要提醒」。触发条件后续可渐进升级（画面突变 / 端侧 CV），本阶段只做最简的定时触发。

## 2. 范围

### 2.1 范围内

- `Companion.tsx` 新增 10s 定时器，在 `listening` 状态调用 `createResponse()`
- 触发时重置 30s 静音重建计时器
- 仅在 `videoMode !== "off"` 时启动该定时器

### 2.2 范围外

- 画面突变触发（阶段二）
- 端侧 CV 检测触发（阶段三）
- 换 VisionCamera / 端侧检测模型

## 3. 参数

| 参数 | 值 |
|---|---|
| 触发间隔 | 10s |
| 触发状态 | 仅 `listening`（静默聆听中） |
| 与 30s 重建关系 | 触发时重置重建计时器 |
| 启动条件 | `videoMode !== "off"` |

## 4. 逻辑

```
10s 定时器触发：
  if status === "listening" && videoMode !== "off":
      service.createResponse()  // 让模型看当前画面
      armRebuild()              // 重置 30s 静音重建计时器
```

### 4.1 关键设计点

1. **仅 listening 触发**——孩子说话（状态切到 responding）或模型回复中（responding）都不触发，避免打断。
2. **`createResponse` 独立调用，不带 `commitAudioBuffer`**——无新音频要提交，模型基于「已推图片 + 历史对话」生成回复。
3. **仅 `videoMode !== "off"` 启动定时器**——语音-only 模式无画面可看，定时 createResponse 纯属浪费计费。
4. **触发视为「有交互」**，重置 30s 静音重建计时器——重建仅在「完全无交互 30s」后发生。

## 5. 组件改动

### 5.1 修改 `src/navigation/screens/Companion.tsx`

- 新增 ref：`proactiveTimerRef`（`ReturnType<typeof setInterval> | null`）
- 新增 `startProactive()` / `stopProactive()`：启动/清理 10s 定时器
- `session-updated` 事件时，若 `videoMode !== "off"` 则 `startProactive()`
- `teardown()` 时 `stopProactive()`
- 定时器回调内：检查 `statusRef.current === "listening"`，若是则 try/catch 调 `serviceRef.current?.createResponse()` + `armRebuild()`

## 6. 边界情况

- **冷启动**：`session-updated` 后才启动定时器，避免连接未就绪就 createResponse
- **孩子说话中 / 模型回复中**：状态非 listening，定时器跳过
- **30s 重建后**：teardown 清理定时器，新会话 `session-updated` 重启
- **videoMode 切换**：当前 videoMode 在会话期间不可改（启动后 disabled），无需处理运行中切换

## 7. 测试

- 真机验证：视频开启时，静默 10s 后模型是否主动「看图提醒」；视频关闭时是否完全不触发
- 验证模型行为：是否会主动说「小心」、还是说废话（这是阶段一的核心验证目标）

## 8. 明确不做的（YAGNI）

- 画面突变触发（阶段二）
- 端侧 CV 触发（阶段三）
- 模型主动开口气质判断的可靠性兜底（后续换模型时再议）
