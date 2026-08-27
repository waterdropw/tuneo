/**
 * 底噪 floor 的 minimum tracking（只降 + 定时重校准），供文档化断言验证；原生层镜像同一逻辑。
 */

export interface FloorTrackerState {
  floor: number          // 当前底噪估计（RMS 幅度域）
  recalibMin: number     // 重校准窗口内最低 rms
  recalibCounter: number // 重校准窗口已累计帧数
}

export interface FloorTrackerOptions {
  recalibWindowFrames: number // 重校准窗口帧数（5s/20ms = 250）
  floorMin: number            // floor 下限
}

export const FLOOR_TRACKING = {
  recalibWindowFrames: 250,
  floorMin: 1e-6,
} as const

export function initialFloorTracker(floor: number): FloorTrackerState {
  return { floor, recalibMin: Infinity, recalibCounter: 0 }
}

// 逐帧更新：floor 只降不升；窗口满则用窗口最低值重校准（允许上升）
export function updateFloor(
  state: FloorTrackerState,
  rms: number,
  opts: FloorTrackerOptions
): FloorTrackerState {
  const floor = Math.max(Math.min(state.floor, rms), opts.floorMin)
  const recalibMin = Math.min(state.recalibMin, rms)
  const recalibCounter = state.recalibCounter + 1

  if (recalibCounter >= opts.recalibWindowFrames) {
    // 窗口满：用窗口最低值重校准（允许 floor 上升以跟上环境变吵）
    return {
      floor: Math.max(floor, recalibMin),
      recalibMin: Infinity,
      recalibCounter: 0,
    }
  }

  return { floor, recalibMin, recalibCounter }
}
