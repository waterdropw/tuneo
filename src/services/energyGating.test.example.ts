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

// updateNoiseFloor：能量上限保护（关门瞬态不更新）
assert(updateNoiseFloor(0.02, 0.9, ENERGY_GATING) === 0.02, "loud transient does not raise floor")

// updateNoiseFloor：低能量下探（floor 从 0.25 向 0.01 收敛，但未一步到位）
const floorDown = updateNoiseFloor(0.25, 0.01, ENERGY_GATING)
assert(floorDown > 0.01 && floorDown < 0.25, "floor moves down toward quiet rms")

// updateNoiseFloor：min 下限
const floorMin = updateNoiseFloor(1e-7, 1e-9, ENERGY_GATING)
assert(floorMin >= ENERGY_GATING.min, "floor clamped above min")

// updateNoiseFloor：慢升路径（rms=0.05 在 [floor, floor×cap) 内，取 alphaUp=0.05）
const floorUp = updateNoiseFloor(0.02, 0.05, ENERGY_GATING)
assert(Math.abs(floorUp - 0.0215) < 1e-9, "slow-up: 0.95*0.02 + 0.05*0.05 = 0.0215")
assert(floorUp > 0.02, "slow-up floor is above input floor")

// shouldGateByEnergy：严格小于才门控，rms == floor×k 边界不门控
assert(shouldGateByEnergy(1.0, 0.25, 4.0) === false, "rms == floor*k is not gated")

console.log("energyGating example assertions passed")
