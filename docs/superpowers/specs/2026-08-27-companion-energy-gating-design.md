# 儿童多模态陪伴 — 能量门控 + 自适应底噪设计文档

- 日期：2026-08-27
- 状态：已评审通过，待实现
- 前置：`2026-08-26-companion-vad-gating-design.md`（端侧 VAD 门控，已实现）
- 相关分支：dev

## 1. 背景与目标

端侧 VAD 门控已实现：libfvad 在原生层检测人声，静音/噪音期间不发送音频，从而省计费。但存在一个残余问题——libfvad 的 `mode` 参数固定（mode=2），在真实环境声（电视、房间背景）下可能把环境噪音误判为 speech，导致计费门控失效。

本设计引入**能量门控前置粗筛 + 自适应底噪估计（noise floor）**：在喂 libfvad 之前先算每帧 RMS 能量，低于自适应底噪一定信噪比（SNR）的帧直接判 silence 不喂 libfvad；只有能量够高的帧才交给 libfvad 做精判。底噪用「非语音期指数平滑」维护，随环境自动抬升/下降。

## 2. 范围

### 2.1 范围内

- iOS 原生层：能量（RMS）计算 + 自适应底噪估计 + 能量门控（前置粗筛）
- Android 原生层：同一套能量门控逻辑（16kHz、Short→Float 归一化，复用相同常量）
- 门控逻辑与现有 libfvad 状态机（3 帧触发 / 40 帧结束）协作
- 纯函数逻辑用文档化断言验证

### 2.2 范围外

- 真 VAD 语义增强（区分「孩子」vs「电视人声」）
- 降噪（AEC/ANR）、多麦克风、波束成形

## 3. 架构

```
麦克风帧（20ms）
  → ① 算 RMS 能量 energy
  → ② 对比自适应底噪 floor
      ├─ energy < floor × K → 直接判 silence（跳过 libfvad）
      └─ energy ≥ floor × K → 喂 libfvad → 精判 speech/silence
  → ③ 更新状态机（沿用现有 3帧触发 / 40帧结束）
  → ④ 若判 silence（门控判 silence 或 libfvad 判 silence）且 energy 未超上限 → 更新 floor（指数平滑）
```

### 3.1 关键设计点

1. **底噪只在「判 silence」（门控判 silence 或 libfvad 判 silence）时更新**——孩子说话的帧（speech）floor 冻结不动，避免把语音能量算进底噪。
2. **能量门控是「粗筛」不是「最终判定」**——高能量非语音（拍手、关门）会进 libfvad，由 libfvad 判 silence，两层各司其职。
3. **门控阈值用 SNR（信噪比）**——`energy >= floor × K`，K 对应固定 dB 数，随 floor 自适应，不依赖绝对能量。

### 3.2 参数（集中为常量）

| 参数 | 值 | 说明 |
|---|---|---|
| 帧长 | 20ms | 沿用现有 |
| SNR 门控阈值 | 12dB（`energy >= floor * 4.0`） | 低于则直接 silence |
| floor 指数平滑系数 α | 0.05（`floor = (1-α)·floor + α·energy`） | 仅在 silence 时更新 |
| floor 初值 | 高初值（如满幅 1/4） | 冷启动偏保守，靠快速下探收敛 |
| 下降/上升速度 | 下降快、上升慢（用不同 α） | 静音快速收敛；突发噪音不瞬间顶高 floor |
| 能量上限保护 | 超上限的帧即使判 silence 也不更新 floor | 防止关门声顶高 floor |

### 3.3 边界情况

- **冷启动**：floor 初值虚高会挡掉第一句，需「下降快」策略让 floor 几帧内收敛到真实底噪；SNR 阈值不宜过高（12dB 而非 20dB）。
- **孩子持续轻声**：能量只略高于 floor，SNR 阈值过高会漏检，12dB 是折中。
- **突发噪音（关门、拍手）**：能量高 → 进 libfvad → 判 silence → 但能量超上限，**不更新 floor**（能量上限保护）。

## 4. 组件改动

### 4.1 修改 `modules/microphone-stream/ios/MicrophoneStreamModule.swift`（已实现）

- 新增能量计算：每 20ms 帧算 RMS（`sqrt(Σx²/n)`，输入为 Float）
- 新增底噪状态字段：`noiseFloor`、平滑系数常量、能量上限常量
- 新增能量门控逻辑：在 `processVadFrames` 喂 libfvad 之前，先按 energy vs floor 判断
- `updateVadState` 之外新增/扩展 floor 更新逻辑：仅在 libfvad 判 silence 且 energy 未超上限时更新
- 冷启动宽限期 25 帧（~500ms）直喂 libfvad 收敛底噪

### 4.2 修改 `modules/microphone-stream/android/.../MicrophoneStreamModule.kt`

- 与 iOS 同一套逻辑，但采样率 16kHz（frameLen=320）、数据为 ShortArray
- 能量计算前先将 Short 归一化为 Float（`x / 32768.0f`），复用与 iOS 完全相同的常量（SNR_K=4.0 / alphaDown=0.2 / alphaUp=0.05 / floorInit=0.25 / cap=8.0 / min=1e-6）
- 冷启动宽限期 25 帧（`graceFramesRemaining`）直喂 libfvad

### 4.3 测试文件

- 已有 `src/services/energyGating.test.example.ts`（文档化断言），Android 复用同一套数学，无需新增

## 6. 测试

- 纯函数文档化断言：floor 更新逻辑、门控判定
- 真机验收：安静不发送、轻声可触发、关门/拍手不误触发、嘈杂环境门控随 floor 抬升

## 7. 明确不做的（YAGNI）

- 真 VAD 语义增强（孩子 vs 电视人声）
- 多麦克风、波束成形
- 降噪（AEC/ANR）
