/**
 * 能量门控纯函数（参考实现，供文档化断言验证；iOS Swift 端镜像同一数学）。
 * 所有能量均在 RMS 幅度域（sqrt(Σx²/n)），输入为 [-1,1] 浮点采样。
 */

export const ENERGY_GATING = {
  // 12dB 门控阈值：rms >= floor × snrK 才喂 libfvad
  snrK: 4.0,
  // 底噪指数平滑系数：下降快、上升慢
  alphaDown: 0.2,
  alphaUp: 0.05,
  // 冷启动保守初值（满幅 RMS 约 1.0 的 1/4）
  floorInit: 0.25,
  // 能量上限保护：rms > floor × cap 的帧（关门等瞬态）不更新底噪
  cap: 8.0,
  // 底噪下限，防止收敛到 0
  min: 1e-6,
} as const

// 计算 RMS（均方根，幅度域）
export function computeRms(samples: ArrayLike<number>): number {
  if (samples.length === 0) return 0
  let sum = 0
  for (let i = 0; i < samples.length; i++) {
    const x = samples[i]
    sum += x * x
  }
  return Math.sqrt(sum / samples.length)
}

// 能量门控判定：rms 低于 floor×k 时判 silence（跳过 libfvad）
export function shouldGateByEnergy(rms: number, floor: number, k: number): boolean {
  return rms < floor * k
}

// 底噪更新：仅在判 silence（门控判 silence 或 libfvad 判 silence）时调用；能量超上限（瞬态）则不更新
export function updateNoiseFloor(
  floor: number,
  rms: number,
  opts: { alphaDown: number; alphaUp: number; cap: number; min: number }
): number {
  if (rms > floor * opts.cap) return floor
  const alpha = rms < floor ? opts.alphaDown : opts.alphaUp
  const next = (1 - alpha) * floor + alpha * rms
  return Math.max(next, opts.min)
}
