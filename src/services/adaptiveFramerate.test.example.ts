/**
 * 文档化断言示例：自适应帧率状态机（本项目无测试运行器，此文件记录预期行为，可手工在 REPL 验证）。
 */
import { diffRatio, nextFrameState, ADAPTIVE_DEFAULTS, FrameState } from "./adaptiveFramerate"

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`assert failed: ${msg}`)
}

const opts = {
  accelFactor: ADAPTIVE_DEFAULTS.accelFactor,
  minInterval: ADAPTIVE_DEFAULTS.minInterval,
  decayFactor: ADAPTIVE_DEFAULTS.decayFactor,
}

// diffRatio
assert(diffRatio("abc", "abc") === 0, "identical strings have 0 diff")
assert(diffRatio("abc", "xyz") === 1, "fully different strings have 1 diff")
assert(Math.abs(diffRatio("aaaa", "aaab") - 0.25) < 1e-9, "one of four chars differs")

// 突变（静止→变化）：加速到 base/3
let state: FrameState = { interval: 1000, wasChanged: false }
state = nextFrameState(state, 1000, true, opts)
assert(state.interval === 333 || Math.abs(state.interval - 1000 / 3) < 1, "突变加速到 base/3")
assert(state.wasChanged === true, "突变后 wasChanged=true")

// 持续变化（走动）：恢复正常间隔
state = nextFrameState(state, 1000, true, opts)
assert(state.interval === 1000, "持续变化恢复正常间隔")
assert(state.wasChanged === true, "持续变化后 wasChanged 仍 true")

// 静止：平滑回落 ×1.5，封顶 base
state = nextFrameState(state, 1000, false, opts)
assert(state.interval === 1000, "回落封顶基础间隔")
state = { interval: 333, wasChanged: false }
state = nextFrameState(state, 1000, false, opts)
assert(Math.abs(state.interval - 333 * 1.5) < 1, "静止时间隔 ×1.5")
assert(state.wasChanged === false, "静止后 wasChanged=false")

// 最小间隔下限
state = { interval: 333, wasChanged: false }
state = nextFrameState(state, 1000, true, opts)
assert(state.interval >= 200, "加速不低于 minInterval")

console.log("adaptiveFramerate example assertions passed")
