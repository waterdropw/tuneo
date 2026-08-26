/**
 * VideoFrameSource
 * 封装 expo-camera 取帧与 expo-image-manipulator 压缩，产出符合协议约束的 JPEG base64 帧。
 */

import type { RefObject } from "react"
import { CameraView } from "expo-camera"
import { manipulateAsync, SaveFormat } from "expo-image-manipulator"

export const MAX_FRAME_BYTES = 256 * 1024

// 由 base64 长度估算原始字节数（base64 每 4 字符约编码 3 字节）
export function estimateJpegBytes(base64: string): number {
  return Math.floor((base64.length * 3) / 4)
}

export function fitsSizeLimit(base64: string, maxBytes: number = MAX_FRAME_BYTES): boolean {
  return estimateJpegBytes(base64) <= maxBytes
}

const CONTINUOUS_INTERVAL_MS = 1000
const TARGET_WIDTH = 1280
const FALLBACK_WIDTH = 960

export class VideoFrameSource {
  private cameraRef: RefObject<CameraView> | null = null
  private timer: ReturnType<typeof setInterval> | null = null
  private busy: boolean = false
  private frameCallback: ((base64Jpg: string) => void) | null = null

  setCameraRef(ref: RefObject<CameraView>): void {
    this.cameraRef = ref
  }

  setFrameCallback(cb: (base64Jpg: string) => void): void {
    this.frameCallback = cb
  }

  start(mode: "onDemand" | "continuous"): void {
    this.stop()
    if (mode === "continuous") {
      this.timer = setInterval(() => {
        this.captureFrame()
      }, CONTINUOUS_INTERVAL_MS)
    }
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
    this.busy = false
  }

  async captureFrame(): Promise<void> {
    if (this.busy || !this.cameraRef?.current) {
      return
    }
    this.busy = true
    try {
      const photo = await this.cameraRef.current.takePictureAsync({ base64: false })
      if (!photo) return

      let result = await manipulateAsync(
        photo.uri,
        [{ resize: { width: TARGET_WIDTH } }],
        { compress: 0.7, format: SaveFormat.JPEG, base64: true }
      )

      if (!result.base64 || !fitsSizeLimit(result.base64)) {
        result = await manipulateAsync(
          photo.uri,
          [{ resize: { width: FALLBACK_WIDTH } }],
          { compress: 0.5, format: SaveFormat.JPEG, base64: true }
        )
      }

      if (result.base64 && fitsSizeLimit(result.base64)) {
        this.frameCallback?.(result.base64)
      } else {
        console.warn("[video-frame] Frame exceeds size limit, dropped")
      }
    } catch (e) {
      console.warn("[video-frame] capture failed", e)
    } finally {
      this.busy = false
    }
  }
}
