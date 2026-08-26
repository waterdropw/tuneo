/**
 * 文档化断言示例：验证帧尺寸约束的纯函数逻辑。
 */
import { estimateJpegBytes, fitsSizeLimit, MAX_FRAME_BYTES } from "./VideoFrameSource"

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`assert failed: ${msg}`)
}

assert(estimateJpegBytes("") === 0, "empty base64 -> 0 bytes")
assert(estimateJpegBytes("aGVsbG8=") >= 3, "estimate is non-trivial")
assert(fitsSizeLimit("a".repeat(100)), "small frame fits")
assert(!fitsSizeLimit("a".repeat(400000)), "oversized frame rejected")
assert(MAX_FRAME_BYTES === 256 * 1024, "256KB limit")

console.log("VideoFrameSource example assertions passed")
