/**
 * 文档化断言示例：floor minimum tracking（本项目无测试运行器，记录预期行为，可手工在 REPL 验证）。
 */
import { updateFloor, initialFloorTracker, FLOOR_TRACKING } from "./floorTracking"

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`assert failed: ${msg}`)
}

const opts = { recalibWindowFrames: FLOOR_TRACKING.recalibWindowFrames, floorMin: FLOOR_TRACKING.floorMin }

// 逐帧只降：rms 高于 floor 时 floor 不升
let s = initialFloorTracker(0.1)
s = updateFloor(s, 0.5, opts)
assert(s.floor === 0.1, "rms 高于 floor 时 floor 不升")

// 逐帧下降：rms 低于 floor 时 floor 降到 rms
s = updateFloor(s, 0.02, opts)
assert(Math.abs(s.floor - 0.02) < 1e-9, "rms 低于 floor 时 floor 降到 rms")

// floor 下限
s = initialFloorTracker(1e-7)
s = updateFloor(s, 1e-9, opts)
assert(s.floor >= FLOOR_TRACKING.floorMin, "floor 不低于下限")

// 窗口满重校准：用窗口最低值允许 floor 上升
s = initialFloorTracker(0.01)
for (let i = 0; i < 249; i++) {
  s = updateFloor(s, 0.5, opts) // 249 帧高能量（不降 floor，但窗口最低值被拉高到 0.5）
}
assert(s.recalibCounter === 249, "未满窗不重校准")
s = updateFloor(s, 0.5, opts) // 第 250 帧，窗口满，触发重校准
assert(s.recalibCounter === 0, "满窗后计数器重置")
assert(Math.abs(s.floor - 0.5) < 1e-9, "重校准用窗口最低值，floor 上升到 0.5")

console.log("floorTracking example assertions passed")
