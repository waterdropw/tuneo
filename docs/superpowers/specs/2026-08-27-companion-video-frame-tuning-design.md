# 儿童多模态陪伴 — 视频帧分辨率与频率调整设计文档

- 日期：2026-08-27
- 状态：已评审通过，待实现
- 前置：`2026-08-26-children-multimodal-companion-video-design.md`（视频帧接入，已实现）
- 相关分支：dev

## 1. 背景与目标

视频帧接入已实现，但当前参数偏「高画质」：`TARGET_WIDTH = 1280`，`continuous` 模式 1s 一帧，`onDemand` 模式手动点「看这个」按钮抓一帧。

经确认，实际需求是**低分辨率 + 自动定时**：

- 两种模式统一 **320 宽**（近似预览流画质）
- `continuous`（持续推送）：**1s 一帧**
- `onDemand`（按需抓取）：从手动按钮改为 **5s 一帧自动推送**

目的：降低单帧体积与拍照/压缩耗时，让「持续推送」更接近低帧率预览流；`onDemand` 改为自动定时，省去手动操作。

## 2. 范围

### 2.1 范围内

- `VideoFrameSource.ts`：`TARGET_WIDTH` 改 320，删除 `FALLBACK_WIDTH` 二级回退；`onDemand` 模式启用 5s 定时器
- `Companion.tsx`：移除「看这个」手动抓帧按钮
- 保留 `fitsSizeLimit` 兜底检查

### 2.2 范围外

- 换库到 react-native-vision-camera 拿真视频帧（expo-camera 无帧回调 API，低分辨率拍照已满足）
- 帧率提升到真视频级（>1fps）
- 视频帧计费优化（另见能量门控设计，本次只调参）

## 3. 参数

| 参数 | 现在 | 改为 |
|---|---|---|
| `TARGET_WIDTH` | 1280 | 320 |
| `FALLBACK_WIDTH` | 960 | 删除 |
| `CONTINUOUS_INTERVAL_MS` | 1000 | 保持 1000 |
| `ON_DEMAND_INTERVAL_MS` | 无（手动） | 新增 5000 |
| 压缩 `compress` | 0.7 | 保持 0.7 |
| `fitsSizeLimit` 检查 | 保留 | 保留（兜底丢弃超限帧） |

## 4. 组件改动

### 4.1 修改 `src/services/VideoFrameSource.ts`

- `TARGET_WIDTH` → 320；删除 `FALLBACK_WIDTH` 与二级回退分支
- 新增 `ON_DEMAND_INTERVAL_MS = 5000`
- `start(mode)`：`onDemand` 分支从「空操作」改为启动 5s 定时器（复用 `captureFrame`）
- `captureFrame` 保留：拍照 → `manipulateAsync` 缩放 320 → `fitsSizeLimit` 兜底 → 回调

> 用 `manipulateAsync` 缩放而非 `pictureSize` 属性：`pictureSize` 是设备相关枚举，不同设备支持值不同，需处理兼容；`manipulateAsync` 缩放路径改动最小、行为可控。

### 4.2 修改 `src/navigation/screens/Companion.tsx`

- 移除 `onDemand` 时显示的「看这个」`captureButton` 及其 `captureFrame` 触发
- `videoSource.start(videoMode)` 调用不变（`start` 内部按模式选频率）
- 视频模式选择 UI 保留三态（关 / 按需 / 持续）

## 5. 边界与错误处理

- 320 宽 JPEG 几乎不可能超 256KB，`fitsSizeLimit` 仍保留兜底，超限丢弃
- `captureFrame` try/catch 已吞异常，单帧失败不影响音频对话
- `busy` 标志防并发，5s/1s 间隔远大于拍照耗时，不堆积
- `onDemand` 语义从「手动」变「自动」，README「看这个」相关描述需同步更新

## 6. 测试

- 纯函数 `fitsSizeLimit` 逻辑不变，已有断言覆盖
- 真机验证：onDemand ≈5s 一帧、continuous ≈1s 一帧、帧宽 ≈320

## 7. 明确不做的（YAGNI）

- 换库拿真视频帧
- 真视频级帧率（>1fps）
- 视频帧计费优化
