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
  turnDetection: null,
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
assert(update.session.turn_detection === null, "turn_detection disabled (端侧 VAD 接管)")
assert(update.session.input_audio_transcription.model === "qwen3-asr-flash-realtime", "transcription model")

// 验证 appendAudio 编码
;(service as any).send = (m: any) => sock.sent.push(JSON.stringify(m))
service.appendAudio(new Int16Array([1, 2, 3]))
assert(JSON.parse(sock.sent[sock.sent.length - 1]).type === "input_audio_buffer.append", "append type")
assert(typeof JSON.parse(sock.sent[sock.sent.length - 1]).audio === "string", "append audio is base64")

// appendImage 消息构造
;(service as any).send = (m: any) => sock.sent.push(JSON.stringify(m))
;(service as any).connected = true
service.appendImage("aGVsbG8=")
const img = JSON.parse(sock.sent[sock.sent.length - 1])
assert(img.type === "input_image_buffer.append", "appendImage type")
assert(img.image === "aGVsbG8=", "appendImage image field")

// commitAudioBuffer / createResponse 消息构造
;(service as any).send = (m: any) => sock.sent.push(JSON.stringify(m))
service.commitAudioBuffer()
assert(JSON.parse(sock.sent[sock.sent.length - 1]).type === "input_audio_buffer.commit", "commit type")

service.createResponse()
assert(JSON.parse(sock.sent[sock.sent.length - 1]).type === "response.create", "createResponse type")

console.log("OmniRealtimeService example assertions passed")
