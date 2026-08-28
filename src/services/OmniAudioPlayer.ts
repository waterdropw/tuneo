/**
 * OmniAudioPlayer
 * 累积模型返回的 PCM 音频分片，封装为 WAV 后用 react-native-sound 播放。
 */

import Sound from "react-native-sound"
import * as FileSystem from "expo-file-system"
import { base64ToBytes, bytesToBase64, pcm16ToWav } from "./audioCodec"

const OUTPUT_SAMPLE_RATE = 24000

export class OmniAudioPlayer {
  private chunks: Uint8Array[] = []
  private sound: Sound | null = null

  appendPcmBase64(base64: string): void {
    this.chunks.push(base64ToBytes(base64))
  }

  appendPcmBytes(bytes: Uint8Array): void {
    this.chunks.push(bytes)
  }

  hasAudio(): boolean {
    return this.chunks.length > 0
  }

  reset(): void {
    this.chunks = []
  }

  async play(): Promise<void> {
    if (this.chunks.length === 0) {
      return
    }

    const total = this.chunks.reduce((sum, c) => sum + c.length, 0)
    const pcm = new Uint8Array(total)
    let offset = 0
    for (const chunk of this.chunks) {
      pcm.set(chunk, offset)
      offset += chunk.length
    }
    this.chunks = []

    const wav = pcm16ToWav(pcm, OUTPUT_SAMPLE_RATE)
    const path = `${FileSystem.cacheDirectory}companion_${Date.now()}.wav`

    try {
      await FileSystem.writeAsStringAsync(path, bytesToBase64(wav), {
        encoding: FileSystem.EncodingType.Base64,
      })
    } catch (e) {
      console.error("[omni-audio] Failed to write audio file:", e)
      return
    }

    this.stop()

    const sound = new Sound(path, undefined, (error) => {
      if (error) {
        console.error("[omni-audio] Failed to load audio:", error)
        sound.release()
        FileSystem.deleteAsync(path, { idempotent: true }).catch(() => {})
        if (this.sound === sound) {
          this.sound = null
        }
        return
      }
      sound.play((success) => {
        console.log(`[omni-audio] Playback finished: ${success}`)
        sound.release()
        FileSystem.deleteAsync(path, { idempotent: true }).catch(() => {})
        if (this.sound === sound) {
          this.sound = null
        }
      })
    })
    this.sound = sound
  }

  isPlaying(): boolean {
    return this.sound != null
  }

  stop(): void {
    if (this.sound) {
      this.sound.stop()
      this.sound.release()
      this.sound = null
    }
  }
}
