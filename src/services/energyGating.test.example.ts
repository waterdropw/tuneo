/**
 * 文档化断言示例：能量门控纯函数（本项目无测试运行器，此文件记录预期行为，可手工在 REPL 验证）。
 */
import { computeRms, shouldGateByEnergy, updateNoiseFloor, ENERGY_GATING } from "./energyGating"

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`assert failed: ${msg}`)
}

// computeRms
assert(computeRms([0, 0, 0, 0]) === 0, "rms of silence is 0")
assert(Math.abs(computeRms([0.5, -0.5, 0.5, -0.5]) - 0.5) < 1e-9, "rms of ±0.5 is 0.5")

// shouldGateByEnergy：低于 floor×k 判 silence
assert(shouldGateByEnergy(0.1, 0.25, 4.0) === true, "0.1 < 1.0 → gate")
assert(shouldGateByEnergy(1.2, 0.25, 4.0) === false, "1.2 >= 1.0 → pass")

// 旧行为，已废弃：能量上限保护（updateNoiseFloor 已弃用，floor 现为 minimum tracking，见 ./floorTracking.ts）
// assert(updateNoiseFloor(0.02, 0.9, ENERGY_GATING) === 0.02, "loud transient does not raise floor")

// 旧行为，已废弃：低能量下探（双向平滑的部分下降；minimum tracking 会一步降到 rms）
// const floorDown = updateNoiseFloor(0.25, 0.01, ENERGY_GATING)
// assert(floorDown > 0.01 && floorDown < 0.25, "floor moves down toward quiet rms")

// updateNoiseFloor：min 下限
const floorMin = updateNoiseFloor(1e-7, 1e-9, ENERGY_GATING)
assert(floorMin >= ENERGY_GATING.min, "floor clamped above min")

// 旧行为，已废弃：慢升路径（双向平滑的 alphaUp 上升；minimum tracking 下 floor 不随 rms 升高而上升）
// const floorUp = updateNoiseFloor(0.02, 0.05, ENERGY_GATING)
// assert(Math.abs(floorUp - 0.0215) < 1e-9, "slow-up: 0.95*0.02 + 0.05*0.05 = 0.0215")
// assert(floorUp > 0.02, "slow-up floor is above input floor")

// shouldGateByEnergy：严格小于才门控，rms == floor×k 边界不门控
assert(shouldGateByEnergy(1.0, 0.25, 4.0) === false, "rms == floor*k is not gated")

console.log("energyGating example assertions passed")
