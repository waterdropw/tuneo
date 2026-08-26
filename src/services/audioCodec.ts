/**
 * 音频编解码工具（纯函数，无 React/RN 依赖，便于测试）。
 * 供 OmniRealtimeService 与 OmniAudioPlayer 共用。
 */

// Int16Array（小端 PCM 采样）→ base64 字符串
export function int16ToBase64(samples: Int16Array): string {
  const bytes = new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength)
  return bytesToBase64(bytes)
}

// Uint8Array → base64 字符串（分块避免大数组导致的栈溢出）
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = ""
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CHUNK)) as number[])
  }
  return btoa(binary)
}

// base64 字符串 → Uint8Array
export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

// 将 16-bit PCM 数据封装为 RIFF/WAVE 容器
export function pcm16ToWav(
  pcm: Uint8Array,
  sampleRate: number,
  numChannels: number = 1,
  bitsPerSample: number = 16
): Uint8Array {
  const blockAlign = (numChannels * bitsPerSample) / 8
  const byteRate = sampleRate * blockAlign
  const dataSize = pcm.length
  const buffer = new ArrayBuffer(44 + dataSize)
  const view = new DataView(buffer)

  const writeAscii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) {
      view.setUint8(offset + i, text.charCodeAt(i))
    }
  }

  writeAscii(0, "RIFF")
  view.setUint32(4, 36 + dataSize, true)
  writeAscii(8, "WAVE")
  writeAscii(12, "fmt ")
  view.setUint32(16, 16, true) // fmt chunk 大小
  view.setUint16(20, 1, true) // 音频格式 = PCM
  view.setUint16(22, numChannels, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, byteRate, true)
  view.setUint16(32, blockAlign, true)
  view.setUint16(34, bitsPerSample, true)
  writeAscii(36, "data")
  view.setUint32(40, dataSize, true)

  new Uint8Array(buffer, 44).set(pcm)
  return new Uint8Array(buffer)
}

// 将 PCM 采样重采样到 16kHz（线性插值）。sourceRate 为原始采样率。
export function resampleTo16k(samples: Int16Array, sourceRate: number): Int16Array {
  const targetRate = 16000
  if (!sourceRate || sourceRate <= 0 || sourceRate === targetRate) {
    return samples
  }
  const ratio = sourceRate / targetRate
  const outLen = Math.max(1, Math.round(samples.length / ratio))
  const out = new Int16Array(outLen)
  for (let i = 0; i < outLen; i++) {
    const srcPos = i * ratio
    const i0 = Math.min(Math.floor(srcPos), samples.length - 1)
    const i1 = Math.min(i0 + 1, samples.length - 1)
    const frac = srcPos - Math.floor(srcPos)
    const v = samples[i0] * (1 - frac) + samples[i1] * frac
    out[i] = Math.max(-32768, Math.min(32767, Math.round(v)))
  }
  return out
}
