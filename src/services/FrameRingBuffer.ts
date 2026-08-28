/**
 * FrameRingBuffer
 * 客户端帧环形缓冲：抓帧线程持续写入，response 前取最新一帧发送，
 * 避免模型侧 input_image_buffer 累积多张图片（该 buffer 无法单独清图片）。
 */

export interface FrameEntry {
  base64Jpg: string // 压缩后的 JPEG base64（发模型用）
  thumbBase64: string // 16×16 缩略图（帧差判断用，不发模型）
  ts: number
}

export class FrameRingBuffer {
  private buffer: FrameEntry[] = []
  private readonly capacity: number

  constructor(capacity = 3) {
    this.capacity = capacity
  }

  push(entry: FrameEntry): void {
    this.buffer.push(entry)
    if (this.buffer.length > this.capacity) {
      this.buffer.shift()
    }
  }

  latest(): FrameEntry | null {
    return this.buffer.length > 0 ? this.buffer[this.buffer.length - 1] : null
  }

  clear(): void {
    this.buffer = []
  }

  get size(): number {
    return this.buffer.length
  }
}
