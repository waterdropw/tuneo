/**
 * VideoFrameSource
 * 封装 expo-camera 取帧与 expo-image-manipulator 压缩，产出符合协议约束的 JPEG base64 帧。
 */

import type { RefObject } from "react"
import { CameraView } from "expo-camera"
import { manipulateAsync, SaveFormat } from "expo-image-manipulator"
import * as FileSystem from "expo-file-system"

export const MAX_FRAME_BYTES = 256 * 1024

// 协议限制的是 base64 编码后的长度（≤256KB），直接比较字符串长度
export function fitsSizeLimit(base64: string, maxBytes: number = MAX_FRAME_BYTES): boolean {
  return base64.length <= maxBytes
}

const CONTINUOUS_INTERVAL_MS = 1000
const ON_DEMAND_INTERVAL_MS = 5000
const TARGET_WIDTH = 320

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
    const interval = mode === "continuous" ? CONTINUOUS_INTERVAL_MS : ON_DEMAND_INTERVAL_MS
    this.timer = setInterval(() => {
      this.captureFrame()
    }, interval)
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
    const uris: string[] = []
    try {
      const photo = await this.cameraRef.current.takePictureAsync({ base64: false })
      if (!photo) {
        return
      }
      uris.push(photo.uri)

      const result = await manipulateAsync(
        photo.uri,
        [{ resize: { width: TARGET_WIDTH } }],
        { compress: 0.7, format: SaveFormat.JPEG, base64: true }
      )
      uris.push(result.uri)

      if (result.base64 && fitsSizeLimit(result.base64)) {
        this.frameCallback?.(result.base64)
      } else {
        console.warn("[video-frame] Frame exceeds size limit, dropped")
      }
    } catch (e) {
      console.warn("[video-frame] capture failed", e)
    } finally {
      for (const uri of uris) {
        FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {})
      }
      this.busy = false
    }
  }
}
