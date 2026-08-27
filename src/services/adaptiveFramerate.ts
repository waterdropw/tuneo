/**
 * 画面变化自适应帧率纯函数（参考实现，供文档化断言验证；VideoFrameSource 镜像同一逻辑）。
 */

export interface FrameState {
  interval: number // 当前帧间隔（ms）
  wasChanged: boolean // 上一帧是否判为「画面变化」
}

export interface AdaptiveOptions {
  accelFactor: number // 加速倍数（间隔 ÷ accelFactor）
  minInterval: number // 最小间隔下限（ms）
  decayFactor: number // 回落步长（间隔 × decayFactor）
}

export const ADAPTIVE_DEFAULTS = {
  accelFactor: 3,
  minInterval: 200,
  decayFactor: 1.5,
  changeThreshold: 0.3,
} as const

// 两字符串差异占比（0–1）；按较长长度遍历，缺失位置计为差异
export function diffRatio(a: string, b: string): number {
  const len = Math.max(a.length, b.length)
  if (len === 0) return 0
  let diff = 0
  for (let i = 0; i < len; i++) {
    if (a[i] !== b[i]) diff++
  }
  return diff / len
}

// 状态机：根据「本帧是否变化」与「上一帧是否变化」返回下一帧状态
export function nextFrameState(
  state: FrameState,
  baseInterval: number,
  changed: boolean,
  opts: AdaptiveOptions
): FrameState {
  if (changed) {
    if (!state.wasChanged) {
      // 突变（翻页）：加速
      return {
        interval: Math.max(baseInterval / opts.accelFactor, opts.minInterval),
        wasChanged: true,
      }
    }
    // 持续变化（走动）：恢复正常
    return { interval: baseInterval, wasChanged: true }
  }
  // 静止：平滑回落，封顶基础间隔
  return {
    interval: Math.min(state.interval * opts.decayFactor, baseInterval),
    wasChanged: false,
  }
}
