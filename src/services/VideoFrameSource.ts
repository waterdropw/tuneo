/**
 * VideoFrameSource
 * 封装 expo-camera 取帧与 expo-image-manipulator 压缩，产出符合协议约束的 JPEG base64 帧。
 */

import type { RefObject } from "react"
import { CameraView } from "expo-camera"
import { manipulateAsync, SaveFormat } from "expo-image-manipulator"
import * as FileSystem from "expo-file-system"
import { nextFrameState, diffRatio, ADAPTIVE_DEFAULTS, FrameState } from "./adaptiveFramerate"
import { FrameRingBuffer } from "./FrameRingBuffer"

export const MAX_FRAME_BYTES = 256 * 1024

// 协议限制的是 base64 编码后的长度（≤256KB），直接比较字符串长度
export function fitsSizeLimit(base64: string, maxBytes: number = MAX_FRAME_BYTES): boolean {
  return base64.length <= maxBytes
}

const CONTINUOUS_INTERVAL_MS = 5000
const ON_DEMAND_INTERVAL_MS = 10000
const TARGET_WIDTH = 224
const THUMB_SIZE = 16

export class VideoFrameSource {
  private cameraRef: RefObject<CameraView> | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  private baseInterval = 0
  private frameState: FrameState = { interval: 0, wasChanged: false }
  private lastThumbBase64: string | null = null
  private running = false
  private busy: boolean = false
  private frameBuffer = new FrameRingBuffer(3)
  private lastSentThumbBase64: string | null = null
  private changeCallback: (() => void) | null = null

  setCameraRef(ref: RefObject<CameraView>): void {
    this.cameraRef = ref
  }

  setChangeCallback(cb: () => void): void {
    this.changeCallback = cb
  }

  // response 前取最新一帧；与上次发送帧做帧差初筛，无显著变化则返回 null（跳过发送）
  takeLatestChangedFrame(): { base64Jpg: string } | null {
    const latest = this.frameBuffer.latest()
    if (!latest) return null
    if (
      this.lastSentThumbBase64 !== null &&
      diffRatio(latest.thumbBase64, this.lastSentThumbBase64) < ADAPTIVE_DEFAULTS.changeThreshold
    ) {
      return null
    }
    this.lastSentThumbBase64 = latest.thumbBase64
    return { base64Jpg: latest.base64Jpg }
  }

  start(mode: "onDemand" | "continuous"): void {
    this.stop()
    this.baseInterval = mode === "continuous" ? CONTINUOUS_INTERVAL_MS : ON_DEMAND_INTERVAL_MS
    this.frameState = { interval: this.baseInterval, wasChanged: false }
    this.lastThumbBase64 = null
    this.running = true
    this.scheduleNext()
  }

  stop(): void {
    this.running = false
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    this.busy = false
  }

  private scheduleNext(): void {
    if (!this.running) return
    this.timer = setTimeout(() => {
      this.captureFrame()
    }, this.frameState.interval)
  }

  async captureFrame(): Promise<void> {
    if (this.busy) {
      // 已有 capture 在跑，其 finally 会续链，直接返回避免并发
      return
    }
    if (!this.cameraRef?.current) {
      // 摄像头暂不可用：续链后再返回，避免 setTimeout 链永久中断
      this.scheduleNext()
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

      // 发送帧：224 宽 JPEG
      const sendResult = await manipulateAsync(
        photo.uri,
        [{ resize: { width: TARGET_WIDTH } }],
        { compress: 0.7, format: SaveFormat.JPEG, base64: true }
      )
      uris.push(sendResult.uri)

      // 检测帧：16×16 无损 PNG（用于画面变化检测 + 帧差初筛，不发模型）
      const thumbResult = await manipulateAsync(
        photo.uri,
        [{ resize: { width: THUMB_SIZE, height: THUMB_SIZE } }],
        { format: SaveFormat.PNG, base64: true }
      )
      uris.push(thumbResult.uri)
      const thumbBase64 = thumbResult.base64 ?? ""

      // 写入帧环形缓冲（response 前按需取最新一帧发送）
      if (sendResult.base64 && fitsSizeLimit(sendResult.base64)) {
        this.frameBuffer.push({ base64Jpg: sendResult.base64, thumbBase64, ts: Date.now() })
      } else {
        console.warn("[video-frame] Frame exceeds size limit, dropped")
      }

      // 更新状态机（相邻帧变化检测）
      const changed =
        this.lastThumbBase64 !== null &&
        diffRatio(thumbBase64, this.lastThumbBase64) >= ADAPTIVE_DEFAULTS.changeThreshold
      const isMutation = changed && !this.frameState.wasChanged
      if (isMutation) {
        this.changeCallback?.()
      }
      this.lastThumbBase64 = thumbBase64

      this.frameState = nextFrameState(
        this.frameState,
        this.baseInterval,
        changed,
        {
          accelFactor: ADAPTIVE_DEFAULTS.accelFactor,
          minInterval: ADAPTIVE_DEFAULTS.minInterval,
          decayFactor: ADAPTIVE_DEFAULTS.decayFactor,
        }
      )
    } catch (e) {
      console.warn("[video-frame] capture failed", e)
    } finally {
      for (const uri of uris) {
        FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {})
      }
      this.busy = false
      this.scheduleNext()
    }
  }
}
