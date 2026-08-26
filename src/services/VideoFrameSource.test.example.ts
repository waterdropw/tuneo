/**
 * 文档化断言示例：验证帧尺寸约束的纯函数逻辑。
 */
import { fitsSizeLimit, MAX_FRAME_BYTES } from "./VideoFrameSource"

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`assert failed: ${msg}`)
}

assert(MAX_FRAME_BYTES === 256 * 1024, "256KB limit")
assert(fitsSizeLimit("a".repeat(100)), "small base64 fits")
assert(fitsSizeLimit("a".repeat(MAX_FRAME_BYTES)), "exactly at limit fits")
assert(!fitsSizeLimit("a".repeat(MAX_FRAME_BYTES + 1)), "over limit rejected")

console.log("VideoFrameSource example assertions passed")
