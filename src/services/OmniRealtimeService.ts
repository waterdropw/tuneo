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
    } catch {
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
