/**
 * 文档化断言示例：验证 PCM→WAV 头拼接与缓冲清空逻辑。
 * 本项目无测试运行器，此文件记录预期行为，可手工在 REPL 验证。
 */
import { pcm16ToWav } from "./audioCodec"

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`assert failed: ${msg}`)
}

const pcm = new Uint8Array([0, 128, 255, 127])
const wav = pcm16ToWav(pcm, 24000)
const view = new DataView(wav.buffer)

assert(wav.length === 44 + 4, "length = header + data")
assert(String.fromCharCode(wav[0], wav[1], wav[2], wav[3]) === "RIFF", "RIFF magic")
assert(String.fromCharCode(wav[8], wav[9], wav[10], wav[11]) === "WAVE", "WAVE magic")
assert(view.getUint16(20, true) === 1, "PCM format")
assert(view.getUint32(24, true) === 24000, "24kHz sample rate")
assert(view.getUint32(28, true) === 48000, "byte rate = 24000 * 2")
assert(view.getUint16(32, true) === 2, "block align = 2")
assert(view.getUint16(34, true) === 16, "16 bits per sample")
assert(wav[44] === 0 && wav[45] === 128 && wav[46] === 255 && wav[47] === 127, "payload copied")

console.log("OmniAudioPlayer example assertions passed")
