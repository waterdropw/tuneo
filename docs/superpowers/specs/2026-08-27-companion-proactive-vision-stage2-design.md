# 儿童多模态陪伴 — 画面突变主动视觉触发设计文档（阶段二）

- 日期：2026-08-27
- 状态：已评审通过，待实现
- 前置：`2026-08-27-companion-proactive-vision-design.md`（阶段一定时触发，已实现）、`2026-08-27-companion-adaptive-framerate-design.md`（自适应帧率，已实现）
- 相关分支：dev

## 1. 背景与目标

阶段一已实现「10s 定时主动触发 createResponse」。阶段二补充「画面突变触发」：复用 `VideoFrameSource` 已算出的画面突变信号（`changed && !wasChanged`，即「静止→变化」），在突变时主动 createResponse，让模型对「新画面」（如翻页后的绘本页、场景切换）及时响应，而非等 10s 定时。

## 2. 范围

### 2.1 范围内

- `VideoFrameSource.ts`：暴露突变信号（`changeCallback`）
- `Companion.tsx`：接收突变信号，主动 createResponse；统一「上次交互」计时器

### 2.2 范围外

- 端侧 CV 检测触发（阶段三）
- 换 VisionCamera / 端侧检测模型

## 3. 参数

| 参数 | 值 |
|---|---|
| 突变判定 | `changed && !wasChanged`（静止→变化） |
| 冷却时长 | 10s（复用「距上次交互」计时） |
| 触发状态 | 仅 `listening` |
| 启动条件 | `videoMode !== "off"` |

## 4. 逻辑

```
VideoFrameSource.captureFrame：
  changed = diffRatio(...) >= threshold
  isMutation = changed && !wasChanged
  if isMutation: changeCallback?.()

Companion 收到突变：
  if status === "listening" && 距上次交互 > 10s:
      service.createResponse()
      记录交互时间
      armRebuild()
```

### 4.1 关键设计点

1. **复用现有突变检测**——`VideoFrameSource` 已算出 `changed`/`wasChanged`，突变 = `changed && !wasChanged`，不新增检测逻辑，只加回调。
2. **「上次交互」统一管理**——语音触发（`onSpeechEnd`）、定时触发（阶段一）、突变触发（阶段二）三者共用同一个 `lastInteractionRef`。突变触发后，10s 定时触发也顺延，避免重复。
3. **冷却复用「距上次交互 > 10s」**——不单独建冷却计时器，用统一时间基准。

## 5. 组件改动

### 5.1 修改 `src/services/VideoFrameSource.ts`

- 新增 `changeCallback` 字段 + `setChangeCallback(cb)`
- `captureFrame` 中，在更新 `frameState` 前判断 `changed && !this.frameState.wasChanged`，为真则调 `changeCallback?.()`

### 5.2 修改 `src/navigation/screens/Companion.tsx`

- 新增 `lastInteractionRef`（初始 0），统一记录「上次交互」时间
- `onSpeechEnd` 时记录交互时间（现有）
- 阶段一定时触发改为读 `lastInteractionRef` 判断（`Date.now() - lastInteractionRef.current > 10000`）
- 新增 `videoSource.setChangeCallback(...)`：突变时，若 `listening` 且距上次交互 > 10s，则 `createResponse` + 记录交互 + `armRebuild()`

## 6. 边界情况

- **走动（持续变化）**：`changed && wasChanged`，非突变，不触发
- **翻页（突变）**：触发一次，10s 内不再触发
- **连续快速翻页**：第一次触发后 10s 冷却
- **孩子说话中 / 模型回复中**：状态非 listening，不触发
- **冷启动**：`lastInteractionRef` 初始 0，第一帧突变会触发

## 7. 测试

- 真机验证：翻页后模型及时响应新页；走动不触发；连续翻页有冷却

## 8. 明确不做的（YAGNI）

- 端侧 CV 触发（阶段三）
- 换库
