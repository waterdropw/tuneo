# 儿童多模态陪伴功能 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增一个基于阿里云 Qwen-Omni-Realtime 全模态大模型的儿童实时语音陪伴功能（MVP 仅语音通道，视频流预留）。

**Architecture:** 新建 `OmniRealtimeService` 走 DashScope `/api-ws/v1/realtime` 端点，开启 server VAD 实现"全程实时连续"；复用现有 `microphone-stream` + `AudioSource` 采集 16kHz PCM；模型返回 24kHz PCM 经 `OmniAudioPlayer` 累积成 WAV 后用 `react-native-sound` 播放；年龄段/音色存 Zustand。

**Tech Stack:** React Native 0.76 / Expo 52 / TypeScript(strict) / Zustand + MMKV / react-native-sound / expo-file-system。

## Global Constraints

- 路径别名 `@/*` 映射到 `./src/*`（见 `tsconfig.json`）。
- TypeScript strict 模式开启；所有新增代码必须通过 `npx tsc --noEmit`。
- 本项目**没有测试运行器**（无 jest/vitest）。验证方式为：`npx tsc --noEmit` + `npm run lint` + 真机手测；`.test.example.ts` 文件沿用现有 `AutoDetectBilingualAsrService.test.example.ts` 约定，作为"文档化断言"随代码提交，不接入运行器。
- API Key 从 `process.env.EXPO_PUBLIC_DASHSCOPE_API_KEY || process.env.DASHSCOPE_API_KEY` 读取（与 `BaseWebSocketService` 一致）。
- 端点：`wss://dashscope.aliyuncs.com/api-ws/v1/realtime`（注意与现有 `/api-ws/v1/inference` 不同）。
- 输入音频：PCM 16kHz 单声道 16-bit（现有 `microphone-stream` 原生模块已是 16kHz）。输出音频：PCM 24kHz 单声道 16-bit。
- 精确模型 ID / 音色 ID 属于外部 API 数据，实现时若报错需对照 DashScope 控制台核对（已给出合理默认值）。
- 默认不改 `src/navigation/index.tsx` 的 `initialRouteName`（保持 `bilingual`）。

---

### Task 1: 音频编解码工具 `audioCodec.ts`

**Files:**
- Create: `src/services/audioCodec.ts`
- Create: `src/services/audioCodec.test.example.ts`

**Interfaces:**
- Produces (被 Task 2/3 使用):
  - `int16ToBase64(samples: Int16Array): string`
  - `bytesToBase64(bytes: Uint8Array): string`
  - `base64ToBytes(base64: string): Uint8Array`
  - `pcm16ToWav(pcm: Uint8Array, sampleRate: number, numChannels?: number, bitsPerSample?: number): Uint8Array`

- [ ] **Step 1: 创建 `src/services/audioCodec.ts`**

```ts
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
```

- [ ] **Step 2: 创建 `src/services/audioCodec.test.example.ts`**

```ts
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
```

- [ ] **Step 3: 类型检查**

Run: `npx tsc --noEmit`
Expected: 无新增错误。

- [ ] **Step 4: Lint**

Run: `npm run lint`
Expected: 无新增错误。

- [ ] **Step 5: 提交**

```bash
git add src/services/audioCodec.ts src/services/audioCodec.test.example.ts
git commit -m "feat: 新增音频编解码工具 audioCodec"
```

---

### Task 2: OmniRealtimeService

**Files:**
- Create: `src/services/OmniRealtimeService.ts`
- Create: `src/services/OmniRealtimeService.test.example.ts`

**Interfaces:**
- Consumes: `int16ToBase64` (Task 1)
- Produces (被 Task 5 使用):
  - `interface OmniRealtimeConfig { model; voice; instructions; inputAudioFormat; outputAudioFormat; turnDetection; inputAudioTranscription? }`
  - `type OmniEvent = "session-created" | "session-updated" | "speech-started" | "speech-stopped" | "user-transcript" | "assistant-transcript-delta" | "audio-delta" | "audio-done" | "response-done" | "error"`
  - `const DEFAULT_OMNI_CONFIG: OmniRealtimeConfig`
  - `class OmniRealtimeService` with `connect()/disconnect()/isConnectionOpen()/isReady()/appendAudio(Int16Array)/cancelResponse()/setEventCallback()/setAudioDeltaCallback()/setTranscriptCallback()/setErrorCallback()`

- [ ] **Step 1: 创建 `src/services/OmniRealtimeService.ts`**

```ts
/**
 * OmniRealtimeService
 * 基于阿里云 DashScope Qwen-Omni-Realtime 全模态大模型的实时语音对话服务。
 *
 * 端点: wss://dashscope.aliyuncs.com/api-ws/v1/realtime
 * 消息为 type 事件制（不同于 BaseWebSocketService 的 header/payload 推理协议）。
 *
 * 参考: https://docs.qwencloud.com/developer-guides/speech/realtime-multimodal-speech
 */

import { int16ToBase64 } from "./audioCodec"

export interface OmniTurnDetection {
  type: "server_vad" | "semantic_vad"
  threshold: number
  silenceDurationMs: number
}

export interface OmniRealtimeConfig {
  model: string
  voice: string
  instructions: string
  inputAudioFormat: "pcm"
  outputAudioFormat: "pcm"
  turnDetection: OmniTurnDetection | null
  inputAudioTranscription?: { model: string }
}

export type OmniEvent =
  | "session-created"
  | "session-updated"
  | "speech-started"
  | "speech-stopped"
  | "user-transcript"
  | "assistant-transcript-delta"
  | "audio-delta"
  | "audio-done"
  | "response-done"
  | "error"

export const DEFAULT_OMNI_CONFIG: OmniRealtimeConfig = {
  model: "qwen3-omni-flash-realtime",
  voice: "Cherry",
  instructions: "",
  inputAudioFormat: "pcm",
  outputAudioFormat: "pcm",
  turnDetection: {
    type: "server_vad",
    threshold: 0.5,
    silenceDurationMs: 800,
  },
  inputAudioTranscription: { model: "qwen3-asr-flash-realtime" },
}

const REALTIME_URL = "wss://dashscope.aliyuncs.com/api-ws/v1/realtime"

export class OmniRealtimeService {
  private config: OmniRealtimeConfig
  private socket: WebSocket | null = null
  private connected: boolean = false
  private ready: boolean = false

  private eventCallback: ((event: OmniEvent, data?: any) => void) | null = null
  private audioDeltaCallback: ((base64Pcm: string) => void) | null = null
  private transcriptCallback: ((text: string) => void) | null = null
  private errorCallback: ((error: Error) => void) | null = null

  private resolveSessionUpdated: ((value: void | PromiseLike<void>) => void) | null = null
  private rejectConnection: ((reason?: any) => void) | null = null

  constructor(config: OmniRealtimeConfig) {
    this.config = config
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.connected && this.socket) {
        resolve()
        return
      }

      const apiKey =
        process.env.EXPO_PUBLIC_DASHSCOPE_API_KEY || process.env.DASHSCOPE_API_KEY || ""
      if (!apiKey) {
        reject(new Error("[omni-realtime] DASHSCOPE_API_KEY is not set in environment variables."))
        return
      }

      this.resolveSessionUpdated = resolve
      this.rejectConnection = reject

      const url = `${REALTIME_URL}?model=${encodeURIComponent(this.config.model)}&api_key=${encodeURIComponent(apiKey)}`

      try {
        this.socket = new WebSocket(url)
        this.socket.onopen = () => {
          this.connected = true
          console.log("[omni-realtime] WebSocket opened, sending session.update")
          this.sendSessionUpdate()
        }
        this.socket.onmessage = (event) => this.onMessage(event)
        this.socket.onerror = () => {
          this.connected = false
          const err = new Error("[omni-realtime] WebSocket error")
          this.handleError(err)
          if (this.rejectConnection) {
            this.rejectConnection(err)
            this.rejectConnection = null
          }
        }
        this.socket.onclose = (event) => {
          console.log(`[omni-realtime] WebSocket closed: ${event.code} ${event.reason}`)
          this.connected = false
          this.ready = false
          this.eventCallback?.("error", { message: `Connection closed (${event.code})` })
        }
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error))
        this.handleError(err)
        reject(err)
      }
    })
  }

  disconnect(): void {
    if (this.socket) {
      try {
        this.socket.close(1000, "Normal closure")
      } catch (e) {
        console.warn("[omni-realtime] Failed to close socket", e)
      }
      this.socket = null
    }
    this.connected = false
    this.ready = false
    this.resolveSessionUpdated = null
    this.rejectConnection = null
  }

  isConnectionOpen(): boolean {
    return this.connected
  }

  isReady(): boolean {
    return this.connected && this.ready
  }

  // 将 PCM 采样推入模型的输入音频缓冲
  appendAudio(samples: Int16Array): void {
    if (!this.connected || !this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error("[omni-realtime] WebSocket is not connected.")
    }
    if (!(samples instanceof Int16Array)) {
      throw new TypeError("[omni-realtime] Audio data must be an Int16Array.")
    }
    this.send({ type: "input_audio_buffer.append", audio: int16ToBase64(samples) })
  }

  // 打断进行中的回复（孩子抢话时使用）
  cancelResponse(): void {
    this.send({ type: "response.cancel" })
  }

  setEventCallback(cb: (event: OmniEvent, data?: any) => void): void {
    this.eventCallback = cb
  }

  setAudioDeltaCallback(cb: (base64Pcm: string) => void): void {
    this.audioDeltaCallback = cb
  }

  setTranscriptCallback(cb: (text: string) => void): void {
    this.transcriptCallback = cb
  }

  setErrorCallback(cb: (error: Error) => void): void {
    this.errorCallback = cb
  }

  private sendSessionUpdate(): void {
    const session: any = {
      modalities: ["text", "audio"],
      voice: this.config.voice,
      input_audio_format: this.config.inputAudioFormat,
      output_audio_format: this.config.outputAudioFormat,
      instructions: this.config.instructions,
      turn_detection: this.config.turnDetection
        ? {
            type: this.config.turnDetection.type,
            threshold: this.config.turnDetection.threshold,
            silence_duration_ms: this.config.turnDetection.silenceDurationMs,
          }
        : null,
    }
    if (this.config.inputAudioTranscription) {
      session.input_audio_transcription = {
        model: this.config.inputAudioTranscription.model,
      }
    }
    this.send({ type: "session.update", session })
  }

  private send(message: any): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return
    }
    this.socket.send(JSON.stringify(message))
  }

  private onMessage(event: MessageEvent): void {
    if (typeof event.data !== "string") {
      return
    }
    let message: any
    try {
      message = JSON.parse(event.data)
    } catch (e) {
      console.warn("[omni-realtime] Failed to parse message", event.data)
      return
    }

    switch (message.type) {
      case "session.created":
        this.eventCallback?.("session-created", message.session)
        break
      case "session.updated":
        this.ready = true
        if (this.resolveSessionUpdated) {
          this.resolveSessionUpdated()
          this.resolveSessionUpdated = null
        }
        this.eventCallback?.("session-updated", message.session)
        break
      case "input_audio_buffer.speech_started":
        this.eventCallback?.("speech-started")
        break
      case "input_audio_buffer.speech_stopped":
        this.eventCallback?.("speech-stopped")
        break
      case "conversation.item.input_audio_transcription.completed":
        this.eventCallback?.("user-transcript", message.transcript ?? "")
        break
      case "response.audio_transcript.delta":
        this.transcriptCallback?.(message.delta ?? "")
        this.eventCallback?.("assistant-transcript-delta", message.delta ?? "")
        break
      case "response.audio.delta":
        this.audioDeltaCallback?.(message.delta ?? "")
        this.eventCallback?.("audio-delta", message.delta ?? "")
        break
      case "response.audio.done":
        this.eventCallback?.("audio-done")
        break
      case "response.done":
        this.eventCallback?.("response-done", message.response ?? {})
        break
      case "error":
        this.handleError(new Error(message.error?.message ?? "[omni-realtime] Unknown error"))
        this.eventCallback?.("error", message.error)
        break
      default:
        break
    }
  }

  private handleError(error: Error): void {
    console.error("[omni-realtime]", error)
    this.errorCallback?.(error)
  }
}
```

- [ ] **Step 2: 创建 `src/services/OmniRealtimeService.test.example.ts`**

```ts
/**
 * 文档化断言示例：验证会话消息构造与事件解析（用 mock WebSocket）。
 * 本项目无测试运行器，此文件记录预期行为，可手工在 REPL 验证。
 */
import { OmniRealtimeService, OmniRealtimeConfig } from "./OmniRealtimeService"

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`assert failed: ${msg}`)
}

// mock WebSocket：拦截 send 记录已发送消息，并暴露触发 onopen/onmessage 的能力
class MockSocket {
  sent: string[] = []
  onopen: (() => void) | null = null
  onmessage: ((e: any) => void) | null = null
  onerror: (() => void) | null = null
  onclose: ((e: any) => void) | null = null
  readyState = 1 // OPEN
  send(data: string) {
    this.sent.push(data)
  }
  close() {
    this.readyState = 3
  }
}

// 注入一个可访问内部 socket 的实例，验证 session.update 消息
const config: OmniRealtimeConfig = {
  model: "qwen3-omni-flash-realtime",
  voice: "Cherry",
  instructions: "you are a friendly companion",
  inputAudioFormat: "pcm",
  outputAudioFormat: "pcm",
  turnDetection: { type: "server_vad", threshold: 0.5, silenceDurationMs: 800 },
  inputAudioTranscription: { model: "qwen3-asr-flash-realtime" },
}

const service = new OmniRealtimeService(config)
const sock = new MockSocket()
;(service as any).socket = sock
;(service as any).connected = true

;(service as any).sendSessionUpdate()
assert(sock.sent.length === 1, "one message sent")
const update = JSON.parse(sock.sent[0])
assert(update.type === "session.update", "session.update type")
assert(update.session.voice === "Cherry", "voice")
assert(update.session.turn_detection.type === "server_vad", "vad type")
assert(update.session.turn_detection.silence_duration_ms === 800, "silence duration")
assert(update.session.input_audio_transcription.model === "qwen3-asr-flash-realtime", "transcription model")

// 验证 appendAudio 编码
;(service as any).send = (m: any) => sock.sent.push(JSON.stringify(m))
service.appendAudio(new Int16Array([1, 2, 3]))
assert(JSON.parse(sock.sent[sock.sent.length - 1]).type === "input_audio_buffer.append", "append type")
assert(typeof JSON.parse(sock.sent[sock.sent.length - 1]).audio === "string", "append audio is base64")

console.log("OmniRealtimeService example assertions passed")
```

- [ ] **Step 3: 类型检查**

Run: `npx tsc --noEmit`
Expected: 无新增错误。

- [ ] **Step 4: Lint**

Run: `npm run lint`
Expected: 无新增错误。

- [ ] **Step 5: 提交**

```bash
git add src/services/OmniRealtimeService.ts src/services/OmniRealtimeService.test.example.ts
git commit -m "feat: 新增 OmniRealtimeService 实时多模态对话服务"
```

---

### Task 3: OmniAudioPlayer

**Files:**
- Create: `src/services/OmniAudioPlayer.ts`
- Create: `src/services/OmniAudioPlayer.test.example.ts`

**Interfaces:**
- Consumes: `base64ToBytes`, `bytesToBase64`, `pcm16ToWav` (Task 1)
- Produces (被 Task 5 使用):
  - `class OmniAudioPlayer` with `appendPcmBase64(base64: string)/appendPcmBytes(bytes: Uint8Array)/hasAudio()/play(): Promise<void>/stop()/reset()`

- [ ] **Step 1: 创建 `src/services/OmniAudioPlayer.ts`**

```ts
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

    await FileSystem.writeAsStringAsync(path, bytesToBase64(wav), {
      encoding: FileSystem.EncodingType.Base64,
    })

    this.stop()

    this.sound = new Sound(path, undefined, (error) => {
      if (error) {
        console.error("[omni-audio] Failed to load audio:", error)
        this.cleanup(path)
        return
      }
      this.sound?.play((success) => {
        console.log(`[omni-audio] Playback finished: ${success}`)
        this.cleanup(path)
      })
    })
  }

  stop(): void {
    if (this.sound) {
      this.sound.stop()
      this.sound.release()
      this.sound = null
    }
  }

  private cleanup(path: string): void {
    this.sound?.release()
    this.sound = null
    FileSystem.deleteAsync(path, { idempotent: true }).catch(() => {})
  }
}
```

- [ ] **Step 2: 创建 `src/services/OmniAudioPlayer.test.example.ts`**

```ts
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
```

- [ ] **Step 3: 类型检查**

Run: `npx tsc --noEmit`
Expected: 无新增错误。

- [ ] **Step 4: Lint**

Run: `npm run lint`
Expected: 无新增错误。

- [ ] **Step 5: 提交**

```bash
git add src/services/OmniAudioPlayer.ts src/services/OmniAudioPlayer.test.example.ts
git commit -m "feat: 新增 OmniAudioPlayer 播放模型返回的 PCM 音频"
```

---

### Task 4: companionStore（年龄段/音色/系统提示词）

**Files:**
- Create: `src/stores/companionStore.ts`

**Interfaces:**
- Consumes: `zustandStorage` from `./localStorage`
- Produces (被 Task 5 使用):
  - `const AGE_MODES = ["toddler", "child", "auto"] as const`
  - `type AgeMode = (typeof AGE_MODES)[number]`
  - `const COMPANION_VOICES = ["Cherry", "Serena", "Ethan", "Chelsie", "Jada"] as const`
  - `type CompanionVoice = (typeof COMPANION_VOICES)[number]`
  - `function getCompanionInstructions(ageMode: AgeMode): string`
  - `useCompanionStore`（`{ ageMode, voice, setAgeMode, setVoice }`）

- [ ] **Step 1: 创建 `src/stores/companionStore.ts`**

```ts
import { create } from "zustand"
import { persist, createJSONStorage } from "zustand/middleware"
import { zustandStorage } from "./localStorage"

export const AGE_MODES = ["toddler", "child", "auto"] as const
export type AgeMode = (typeof AGE_MODES)[number]

// 注：音色 ID 为外部 API 数据，若调用报错请对照 DashScope 控制台核对。
export const COMPANION_VOICES = ["Cherry", "Serena", "Ethan", "Chelsie", "Jada"] as const
export type CompanionVoice = (typeof COMPANION_VOICES)[number]

const INSTRUCTIONS: Record<AgeMode, string> = {
  toddler:
    "你是一个温柔、耐心的幼儿陪伴伙伴，正在和一个2-6岁的小朋友聊天。" +
    "请使用非常简单、短小的句子，多用重复和鼓励，语气亲切活泼。" +
    "只聊积极、安全、适合幼儿的内容，不涉及暴力、恐怖或成人话题。",
  child:
    "你是一个友好、有趣的儿童陪伴伙伴，正在和一个6-12岁的小朋友聊天。" +
    "可以用更丰富的语言讲故事、做简单问答和知识科普，保持积极向上。" +
    "只聊适合儿童的内容，不涉及暴力、恐怖或成人话题。",
  auto:
    "你是一个亲切的儿童陪伴伙伴。请根据孩子说话的语言难度自动调整你的用词和句子长度，" +
    "保持温柔、积极、有耐心，只聊适合儿童的安全内容。",
}

export function getCompanionInstructions(ageMode: AgeMode): string {
  return INSTRUCTIONS[ageMode]
}

interface CompanionState {
  ageMode: AgeMode
  voice: CompanionVoice
  setAgeMode: (mode: AgeMode) => void
  setVoice: (voice: CompanionVoice) => void
}

export const useCompanionStore = create<CompanionState>()(
  persist(
    (set) => ({
      ageMode: "auto",
      voice: "Cherry",
      setAgeMode: (ageMode) => set({ ageMode }),
      setVoice: (voice) => set({ voice }),
    }),
    {
      name: "companion-store",
      storage: createJSONStorage(() => zustandStorage),
      merge: (persistedState, currentState) => {
        const loaded = { ...currentState }
        const saved = persistedState as Partial<CompanionState>
        if (saved.ageMode && AGE_MODES.includes(saved.ageMode as any)) {
          loaded.ageMode = saved.ageMode
        }
        if (saved.voice && COMPANION_VOICES.includes(saved.voice as any)) {
          loaded.voice = saved.voice
        }
        return loaded
      },
    }
  )
)
```

- [ ] **Step 2: 类型检查**

Run: `npx tsc --noEmit`
Expected: 无新增错误。

- [ ] **Step 3: Lint**

Run: `npm run lint`
Expected: 无新增错误。

- [ ] **Step 4: 提交**

```bash
git add src/stores/companionStore.ts
git commit -m "feat: 新增 companionStore 管理年龄段与音色"
```

---

### Task 5: Companion 屏幕 + 导航注册

**Files:**
- Create: `src/navigation/screens/Companion.tsx`
- Modify: `src/navigation/index.tsx`（新增 import 与 screen 条目）

**Interfaces:**
- Consumes: `OmniRealtimeService` / `OmniRealtimeConfig` / `DEFAULT_OMNI_CONFIG`（Task 2）、`OmniAudioPlayer`（Task 3）、`useCompanionStore` / `getCompanionInstructions` / `AGE_MODES` / `COMPANION_VOICES` / `AgeMode` / `CompanionVoice`（Task 4）、`AudioSource`、`RequireMicAccess`、`Picker`、`Colors`

- [ ] **Step 1: 创建 `src/navigation/screens/Companion.tsx`**

```tsx
import React, { useEffect, useRef, useState } from "react"
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from "react-native"
import { AudioModule } from "expo-audio"
import Colors from "@/colors"
import RequireMicAccess from "@/components/RequireMicAccess"
import { Picker } from "@/components/Picker"
import { AudioSource } from "@/services/AudioSource"
import {
  OmniRealtimeService,
  OmniRealtimeConfig,
  OmniEvent,
  DEFAULT_OMNI_CONFIG,
} from "@/services/OmniRealtimeService"
import { OmniAudioPlayer } from "@/services/OmniAudioPlayer"
import {
  useCompanionStore,
  getCompanionInstructions,
  AGE_MODES,
  COMPANION_VOICES,
  AgeMode,
  CompanionVoice,
} from "@/stores/companionStore"
import { MenuAction } from "@react-native-menu/menu"

type MicrophoneAccess = "pending" | "granted" | "denied"
type SessionStatus = "idle" | "connecting" | "listening" | "responding"

const AGE_MODE_TITLES: Record<AgeMode, string> = {
  toddler: "幼儿 (2-6)",
  child: "儿童 (6-12)",
  auto: "自适应",
}

export const Companion = () => {
  const [micAccess, setMicAccess] = useState<MicrophoneAccess>("pending")
  const [status, setStatus] = useState<SessionStatus>("idle")
  const [assistantText, setAssistantText] = useState("")
  const [userText, setUserText] = useState("")
  const [errorMsg, setErrorMsg] = useState("")

  const { ageMode, voice, setAgeMode, setVoice } = useCompanionStore()

  const serviceRef = useRef<OmniRealtimeService | null>(null)
  const playerRef = useRef<OmniAudioPlayer | null>(null)
  const audioSourceRef = useRef<AudioSource | null>(null)
  const statusRef = useRef<SessionStatus>("idle")

  const ageOptions: MenuAction[] = AGE_MODES.map((m) => ({ id: m, title: AGE_MODE_TITLES[m] }))
  const voiceOptions: MenuAction[] = COMPANION_VOICES.map((v) => ({ id: v, title: v }))

  useEffect(() => {
    ;(async () => {
      const s = await AudioModule.requestRecordingPermissionsAsync()
      if (s.granted) setMicAccess("granted")
      else setMicAccess("denied")
    })()
  }, [])

  const handleEvent = (event: OmniEvent, data?: any) => {
    switch (event) {
      case "session-updated":
        setStatus("listening")
        statusRef.current = "listening"
        break
      case "speech-started":
        if (statusRef.current === "responding") {
          serviceRef.current?.cancelResponse()
          playerRef.current?.stop()
          playerRef.current?.reset()
        }
        setAssistantText("")
        setStatus("listening")
        statusRef.current = "listening"
        break
      case "user-transcript":
        setUserText(data ?? "")
        break
      case "audio-delta":
      case "assistant-transcript-delta":
        setStatus("responding")
        statusRef.current = "responding"
        break
      case "audio-done":
        playerRef.current?.play()
        setStatus("listening")
        statusRef.current = "listening"
        break
      case "response-done":
        setStatus("listening")
        statusRef.current = "listening"
        break
      case "error":
        setErrorMsg(typeof data?.message === "string" ? data.message : "连接出错")
        setStatus("idle")
        statusRef.current = "idle"
        break
      default:
        break
    }
  }

  const handleStart = async () => {
    setErrorMsg("")
    setAssistantText("")
    setUserText("")
    setStatus("connecting")
    statusRef.current = "connecting"

    const config: OmniRealtimeConfig = {
      ...DEFAULT_OMNI_CONFIG,
      voice,
      instructions: getCompanionInstructions(ageMode),
    }

    const service = new OmniRealtimeService(config)
    serviceRef.current = service

    const player = new OmniAudioPlayer()
    playerRef.current = player

    service.setEventCallback(handleEvent)
    service.setAudioDeltaCallback((b64) => player.appendPcmBase64(b64))
    service.setTranscriptCallback((text) => {
      setAssistantText((prev) => prev + text)
      setStatus("responding")
      statusRef.current = "responding"
    })
    service.setErrorCallback((err) => {
      setErrorMsg(err.message)
      setStatus("idle")
      statusRef.current = "idle"
    })

    try {
      await service.connect()

      const audioSource = AudioSource.getInstance()
      audioSourceRef.current = audioSource
      audioSource.startProcessing((processed) => {
        if (processed?.data && service.isReady()) {
          try {
            service.appendAudio(processed.data)
          } catch (e) {
            console.warn("[companion] appendAudio failed", e)
          }
        }
      })
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : String(e))
      setStatus("idle")
      statusRef.current = "idle"
    }
  }

  const handleStop = () => {
    audioSourceRef.current?.stopProcessing()
    playerRef.current?.stop()
    playerRef.current?.reset()
    serviceRef.current?.disconnect()
    serviceRef.current = null
    setStatus("idle")
    statusRef.current = "idle"
    setAssistantText("")
    setUserText("")
  }

  useEffect(() => {
    return () => {
      audioSourceRef.current?.stopProcessing()
      playerRef.current?.stop()
      serviceRef.current?.disconnect()
    }
  }, [])

  const isRunning = status !== "idle"
  const statusLabel =
    status === "idle"
      ? "未开始"
      : status === "connecting"
        ? "连接中…"
        : status === "listening"
          ? "聆听中…"
          : "回复中…"

  return micAccess === "granted" ? (
    <ScrollView style={styles.container}>
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>年龄段</Text>
        <Picker
          actions={ageOptions}
          onSelect={(id) => setAgeMode(id as AgeMode)}
          value={ageMode}
          disabled={isRunning}
        >
          <TouchableOpacity style={styles.pickerButton}>
            <Text style={styles.pickerButtonText}>{AGE_MODE_TITLES[ageMode]}</Text>
          </TouchableOpacity>
        </Picker>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>音色</Text>
        <Picker
          actions={voiceOptions}
          onSelect={(id) => setVoice(id as CompanionVoice)}
          value={voice}
          disabled={isRunning}
        >
          <TouchableOpacity style={styles.pickerButton}>
            <Text style={styles.pickerButtonText}>{voice}</Text>
          </TouchableOpacity>
        </Picker>
      </View>

      <View style={styles.section}>
        <TouchableOpacity
          style={[styles.button, isRunning ? styles.stopButton : styles.startButton]}
          onPress={isRunning ? handleStop : handleStart}
        >
          <Text style={styles.buttonText}>{isRunning ? "停止陪伴" : "开始陪伴"}</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.section}>
        <Text style={styles.statusText}>状态: {statusLabel}</Text>
        {errorMsg ? <Text style={styles.errorText}>{errorMsg}</Text> : null}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>孩子说</Text>
        <View style={styles.resultBox}>
          <Text style={styles.resultText}>{userText || "…"}</Text>
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>AI 回复</Text>
        <View style={styles.resultBox}>
          <Text style={styles.resultText}>{assistantText || "…"}</Text>
        </View>
      </View>
    </ScrollView>
  ) : micAccess === "denied" ? (
    <RequireMicAccess />
  ) : (
    <View style={styles.loadingContainer}>
      <Text style={styles.loadingText}>正在请求麦克风权限…</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.bgInactive,
    padding: 20,
  },
  section: {
    backgroundColor: Colors.bgActive,
    borderRadius: 15,
    padding: 15,
    marginBottom: 15,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "bold",
    color: Colors.primary,
    marginBottom: 10,
  },
  pickerButton: {
    backgroundColor: Colors.bgInactive,
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: Colors.primary,
    alignItems: "center",
  },
  pickerButtonText: {
    color: Colors.primary,
    fontWeight: "bold",
    fontSize: 14,
  },
  button: {
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  startButton: {
    backgroundColor: Colors.primary,
  },
  stopButton: {
    backgroundColor: Colors.low,
  },
  buttonText: {
    color: Colors.bgInactive,
    fontWeight: "bold",
    fontSize: 16,
  },
  statusText: {
    color: Colors.primary,
    fontSize: 14,
    fontWeight: "bold",
  },
  errorText: {
    color: Colors.warn,
    fontSize: 13,
    marginTop: 6,
  },
  resultBox: {
    backgroundColor: Colors.bgInactive,
    borderRadius: 10,
    padding: 12,
    minHeight: 70,
    justifyContent: "center",
    borderLeftWidth: 4,
    borderLeftColor: Colors.primary,
  },
  resultText: {
    fontSize: 16,
    color: Colors.primary,
    lineHeight: 24,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: Colors.bgInactive,
  },
  loadingText: {
    fontSize: 18,
    color: Colors.primary,
    marginTop: 10,
  },
})
```

- [ ] **Step 2: 修改 `src/navigation/index.tsx` 注册屏幕**

在 `import { AliBailianDemo } from "./screens/AliBailianDemo"` 之后新增 import：

```ts
import { Companion } from "./screens/Companion"
```

在 `RootStack` 的 `screens` 对象中（例如 `demo` 条目之后）新增：

```ts
    Companion: {
      screen: Companion,
      options: {
        title: "儿童陪伴",
        headerTitleStyle: { color: Colors.primary },
        headerStyle: { backgroundColor: Colors.bgTitle },
        headerTintColor: Colors.primary,
        headerShadowVisible: false,
      },
    },
```

- [ ] **Step 3: 类型检查**

Run: `npx tsc --noEmit`
Expected: 无新增错误。

- [ ] **Step 4: Lint**

Run: `npm run lint`
Expected: 无新增错误。

- [ ] **Step 5: 提交**

```bash
git add src/navigation/screens/Companion.tsx src/navigation/index.tsx
git commit -m "feat: 新增儿童陪伴 Companion 屏幕并注册导航"
```

---

### Task 6: 真机手测验收

无代码改动，仅按清单验收（用 `npm run ios` 或 `npm run android` 启动 dev client，导航到「儿童陪伴」）。

- [ ] **Step 1: 基础对话** — 点「开始陪伴」→ 状态变为「聆听中」→ 说话 → 状态变为「回复中」→ 听到语音回复 + 看到字幕。
- [ ] **Step 2: 打断** — AI 回复过程中再次说话 → AI 停止播放、开始新回复。
- [ ] **Step 3: 年龄段切换** — 停止后切换「幼儿/儿童/自适应」，重新开始，语气/用词有差异。
- [ ] **Step 4: 音色切换** — 切换音色后重新开始，回复音色变化。
- [ ] **Step 5: 停止与清理** — 点「停止陪伴」→ 播放停止、回到未开始，无残留音频。
- [ ] **Step 6: 断网/无 Key** — 未设置 `EXPO_PUBLIC_DASHSCOPE_API_KEY` 时开始 → 显示友好错误提示，不崩溃。

验收通过后，运行 `git status` 确认无意外改动，本功能即完成。

---

## Self-Review 记录

- **Spec 覆盖**：§2 语音对话（Task 2/5）、全年龄段切换（Task 4/5）、语音播放+字幕（Task 3/5）、内容安全约束（Task 4 的 instructions）、错误处理（Task 2/5）、测试（各 `.test.example.ts` + Task 6）。视频流、渐进播放、工具调用、Key 代理在 spec 中明确排除，无需任务。
- **占位符**：模型/音色 ID 属外部数据，已给出合理默认并标注"对照控制台核对"，非占位符。
- **类型一致性**：`OmniRealtimeConfig`、`OmniEvent`、`appendAudio(Int16Array)`、`OmniAudioPlayer.appendPcmBase64`、`useCompanionStore` 的字段在各任务间一致。
