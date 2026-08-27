/**
 * OmniRealtimeService
 * 基于阿里云 DashScope Qwen-Omni-Realtime 全模态大模型的实时语音对话服务。
 *
 * 端点: wss://dashscope.aliyuncs.com/api-ws/v1/realtime
 * 消息为 type 事件制（不同于 BaseWebSocketService 的 header/payload 推理协议）。
 *
 * 参考: https://docs.qwencloud.com/developer-guides/speech/realtime-multimodal-speech
 */

import { int16ToBase64, resampleTo16k } from "./audioCodec"
import MicrophoneStreamModule from "../../modules/microphone-stream"

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
  model: "qwen3.5-omni-plus-realtime",
  voice: "Tina",
  instructions: "",
  inputAudioFormat: "pcm",
  outputAudioFormat: "pcm",
  turnDetection: null,
  inputAudioTranscription: { model: "qwen3-asr-flash-realtime" },
}

const WORKSPACE_ID = process.env.EXPO_PUBLIC_DASHSCOPE_WORKSPACE_ID || "llm-3beld8asoiessbjf"
const REALTIME_URL = `wss://${WORKSPACE_ID}.cn-beijing.maas.aliyuncs.com/api-ws/v1/realtime`

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
  private sourceSampleRate: number | null = null

  constructor(config: OmniRealtimeConfig) {
    this.config = config
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.connected && this.socket && this.ready) {
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

      const url = `${REALTIME_URL}?model=${encodeURIComponent(this.config.model)}`

      try {
        // RN 的 WebSocket 运行时支持第三个 options 参数（headers），但 TS 类型未声明，故此处断言。
        const sock = new (WebSocket as any)(url, null, {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "OpenAI-Beta": "realtime=v1",
          },
        }) as WebSocket
        this.socket = sock
        // 所有回调先比对 this.socket 是否仍是本连接：disconnect() 后立即重连时，
        // 旧 socket 的异步 onclose 会晚于新 socket 建立，若不加守卫会污染新连接的状态。
        sock.onopen = () => {
          if (this.socket !== sock) return
          this.connected = true
          console.log("[omni-realtime] WebSocket opened, sending session.update")
          this.sendSessionUpdate()
        }
        sock.onmessage = (event) => {
          if (this.socket !== sock) return
          this.onMessage(event)
        }
        sock.onerror = (event: any) => {
          if (this.socket !== sock) return
          this.connected = false
          console.error(
            "[omni-realtime] WebSocket error event:",
            JSON.stringify(event),
            "message:",
            (event as any)?.message ?? (event as any)?.nativeEvent?.message ?? "n/a"
          )
          const err = new Error("[omni-realtime] WebSocket error")
          this.handleError(err)
          if (this.rejectConnection) {
            this.rejectConnection(err)
            this.rejectConnection = null
          }
        }
        sock.onclose = (event) => {
          if (this.socket !== sock) return
          console.log(
            `[omni-realtime] WebSocket closed: code=${event.code} reason=${event.reason} message=${(event as any)?.message ?? "n/a"}`
          )
          this.connected = false
          this.ready = false
          if (event.code !== 1000) {
            this.eventCallback?.("error", { message: `Connection closed (${event.code})` })
          }
          if (this.rejectConnection) {
            this.rejectConnection(new Error(`[omni-realtime] Connection closed (${event.code})`))
            this.rejectConnection = null
          }
          this.resolveSessionUpdated = null
        }
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error))
        this.handleError(err)
        reject(err)
      }
    })
  }

  disconnect(): void {
    if (this.rejectConnection) {
      this.rejectConnection(new Error("[omni-realtime] Disconnected before session was established."))
      this.rejectConnection = null
    }
    this.resolveSessionUpdated = null

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
  }

  isConnectionOpen(): boolean {
    return this.connected
  }

  isReady(): boolean {
    return this.connected && this.ready
  }

  // 将 PCM 采样推入模型的输入音频缓冲（模型要求 16kHz，发送前统一重采样）
  appendAudio(samples: Int16Array): void {
    if (!this.connected || !this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error("[omni-realtime] WebSocket is not connected.")
    }
    if (!(samples instanceof Int16Array)) {
      throw new TypeError("[omni-realtime] Audio data must be an Int16Array.")
    }
    const resampled = resampleTo16k(samples, this.getSourceSampleRate())
    this.send({ type: "input_audio_buffer.append", audio: int16ToBase64(resampled) })
  }

  private getSourceSampleRate(): number {
    if (this.sourceSampleRate === null) {
      this.sourceSampleRate = MicrophoneStreamModule.getSampleRate() || 16000
      console.log(`[omni-realtime] Mic sample rate: ${this.sourceSampleRate}Hz`)
    }
    return this.sourceSampleRate
  }

  // 将 JPEG 图像帧推入模型的输入图像缓冲（base64，单帧 ≤256KB）
  appendImage(base64Jpg: string): void {
    if (!this.connected || !this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error("[omni-realtime] WebSocket is not connected.")
    }
    if (typeof base64Jpg !== "string" || base64Jpg.length === 0) {
      throw new TypeError("[omni-realtime] Image must be a non-empty base64 string.")
    }
    this.send({ type: "input_image_buffer.append", image: base64Jpg })
  }

  // 打断进行中的回复（孩子抢话时使用）
  cancelResponse(): void {
    this.send({ type: "response.cancel" })
  }

  // 提交输入音频缓冲，通知服务端「这轮人声已结束，请处理」（端侧 VAD 接管轮次时使用）
  commitAudioBuffer(): void {
    this.send({ type: "input_audio_buffer.commit" })
  }

  // 请求服务端生成回复（配合 commit 使用；服务端 VAD 关闭后需显式触发）
  createResponse(): void {
    this.send({ type: "response.create" })
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
    this.logOutgoing(message)
  }

  private logOutgoing(message: any): void {
    const type = message.type
    if (type === "input_audio_buffer.append") {
      console.log(`[omni-realtime] SEND ${type} base64_len=${message.audio?.length ?? 0}`)
    } else if (type === "input_image_buffer.append") {
      console.log(`[omni-realtime] SEND ${type} base64_len=${message.image?.length ?? 0}`)
    } else {
      console.log(`[omni-realtime] SEND ${type}`)
    }
  }

  private logIncoming(message: any): void {
    const type = message.type
    if (type === "response.audio.delta") {
      console.log(`[omni-realtime] RECV ${type} base64_len=${message.delta?.length ?? 0}`)
    } else if (type === "response.audio_transcript.delta") {
      console.log(`[omni-realtime] RECV ${type} ${message.delta ?? ""}`)
    } else if (type === "conversation.item.input_audio_transcription.completed") {
      console.log(`[omni-realtime] RECV ${type} ${message.transcript ?? ""}`)
    } else {
      console.log(`[omni-realtime] RECV ${type}`, JSON.stringify(message))
    }
  }

  private onMessage(event: MessageEvent): void {
    if (typeof event.data !== "string") {
      return
    }
    let message: any
    try {
      message = JSON.parse(event.data)
    } catch {
      console.warn("[omni-realtime] Failed to parse message", event.data)
      return
    }

    this.logIncoming(message)

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
