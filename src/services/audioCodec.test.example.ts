/**
 * 文档化断言示例（本项目无测试运行器，此文件记录预期行为，可手工在 REPL 验证）。
 */
import { int16ToBase64, base64ToBytes, bytesToBase64, pcm16ToWav } from "./audioCodec"

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`assert failed: ${msg}`)
}

// bytesToBase64 / base64ToBytes 往返
const bytes = new Uint8Array([0, 1, 2, 253, 254, 255])
assert(base64ToBytes(bytesToBase64(bytes)).join(",") === bytes.join(","), "bytes base64 roundtrip")

// int16ToBase64：两个 int16 采样 [0x0102, 0x0304] → 小端字节 [2,1,4,3]
const int16 = new Int16Array([0x0102, 0x0304])
const decoded = base64ToBytes(int16ToBase64(int16))
assert(decoded[0] === 2 && decoded[1] === 1 && decoded[2] === 4 && decoded[3] === 3, "int16 little-endian encoding")

// pcm16ToWav 头字段
const pcm = new Uint8Array([1, 2, 3, 4])
const wav = pcm16ToWav(pcm, 24000)
const view = new DataView(wav.buffer)
assert(wav.length === 44 + 4, "wav length")
assert(view.getUint32(24, true) === 24000, "wav sample rate")
assert(view.getUint16(22, true) === 1, "wav channels")
assert(view.getUint16(34, true) === 16, "wav bits per sample")
assert(wav[44] === 1 && wav[47] === 4, "wav data payload copied")

console.log("audioCodec example assertions passed")
