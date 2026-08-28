import AVFoundation
import ExpoModulesCore

let BUF_PER_SEC = 10
// tap 输出统一重采样到 48kHz（libfvad 仅支持 8/16/32/48k；模拟器硬件为 44.1k 会绕过 VAD）
let TARGET_SAMPLE_RATE = 48000.0

// libfvad C 接口声明（Task 2 已在 app target 的 bridging header 导入 fvad.h，
// 但本文件编译进独立的 MicrophoneStream pod target，看不到 app 的 bridging header，
// 故用 @_silgen_name 直接链接 C 符号，行为与 bridging header 导入等价）。
@_silgen_name("fvad_new") private func fvad_new() -> OpaquePointer?
@_silgen_name("fvad_set_sample_rate") private func fvad_set_sample_rate(_ inst: OpaquePointer?, _ rate: Int32) -> Int32
@_silgen_name("fvad_set_mode") private func fvad_set_mode(_ inst: OpaquePointer?, _ mode: Int32) -> Int32
@_silgen_name("fvad_process") private func fvad_process(_ inst: OpaquePointer?, _ frame: UnsafePointer<Int16>?, _ length: Int) -> Int32
@_silgen_name("fvad_free") private func fvad_free(_ inst: OpaquePointer?)

private let VAD_FRAME_MS = 20
private let SPEECH_TRIGGER_FRAMES = 15  // 300ms / 20ms：最小语音时长，过滤喷嚏等瞬态
private let SILENCE_END_FRAMES = 40   // 800ms / 20ms

// 能量门控 + 自适应底噪参数（RMS 幅度域）
private let SNR_K: Float = 4.0          // 12dB：rms >= floor × 4 才喂 libfvad
private let FLOOR_ALPHA_DOWN: Float = 0.2 // 底噪下探（快）
private let FLOOR_ALPHA_UP: Float = 0.05  // 底噪上升（慢）
private let FLOOR_INIT: Float = 0.25      // 冷启动保守初值
private let FLOOR_CAP: Float = 8.0        // 能量上限保护：瞬态不更新底噪
private let FLOOR_MIN: Float = 1e-6       // 底噪下限
private let RECALIB_WINDOW_FRAMES = 250  // 5s / 20ms：floor 重校准窗口

public class MicrophoneStreamModule: Module {

  private let audioSession = AVAudioSession.sharedInstance()
  private let audioEngine = AVAudioEngine()
  private var audioBufferHandler: (([Float]) -> Void)?

  // 播放：AVAudioPlayerNode 接入同一 engine 的 output，为 voice processing AEC 提供参考信号
  private let playerNode = AVAudioPlayerNode()
  private var playerNodeAttached = false

  // VAD 状态
  private var vad: OpaquePointer? = nil
  private var sampleRateForVad = 48000
  private var speechActive = false
  private var justStartedSpeech = false
  private var speechStreak = 0
  private var silenceStreak = 0
  private var preRoll: [Float] = []
  private var preRollCapacity = 0
  private var noiseFloor: Float = FLOOR_INIT
  private var recalibMin: Float = Float.greatestFiniteMagnitude
  private var recalibCounter = 0
  private var graceFramesRemaining = 0

  // Each module class must implement the definition function. The definition consists of components
  // that describes the module's functionality and behavior.
  // See https://docs.expo.dev/modules/module-api for more details about available components.
  public func definition() -> ModuleDefinition {
    // Sets the name of the module that JavaScript code will use to refer to the module. Takes a string as an argument.
    // Can be inferred from module's class name, but it's recommended to set it explicitly for clarity.
    // The module will be accessible from `requireNativeModule('MicrophoneStream')` in JavaScript.
    Name("MicrophoneStream")

    // Defines event names that the module can send to JavaScript.
    Events("onAudioBuffer", "onSpeechStart", "onSpeechEnd")

    Constants([
      "BUF_PER_SEC": BUF_PER_SEC
    ])

    Function("startRecording") {
      // audioBufferHandler = handler

      // Request microphone permission
      self.audioSession.requestRecordPermission { granted in
          guard granted else {
              print("Microphone permission not granted.")
              return
          }

          print("Configuring audioSession")
          DispatchQueue.main.async {
              do {
                  try self.audioSession.setCategory(.playAndRecord, mode: .voiceChat, options: [.defaultToSpeaker])
                  try self.audioSession.setPreferredSampleRate(TARGET_SAMPLE_RATE) // .voiceChat 锁定 48kHz，与 tap 输出一致
                  try self.audioSession.setActive(true)

                  let inputNode = self.audioEngine.inputNode

                  // 启用系统 voice processing（AEC + 降噪 + AGC），抑制回复回声被麦克风拾取后自打断。
                  // 必须在 engine stopped 时调用；失败则降级为不启用，维持现状不崩。
                  do {
                      try inputNode.setVoiceProcessingEnabled(true)
                  } catch {
                      print("Voice processing not available, continuing without AEC: \(error.localizedDescription)")
                  }

                  // 显式指定 48kHz 单声道浮点格式，AVAudioEngine 会自动把硬件采样率重采样过来
                  let targetFormat = AVAudioFormat(
                    commonFormat: .pcmFormatFloat32,
                    sampleRate: TARGET_SAMPLE_RATE,
                    channels: 1,
                    interleaved: false
                  )!
                  let bufferSize = AVAudioFrameCount(TARGET_SAMPLE_RATE / Double(BUF_PER_SEC))

                  inputNode.installTap(onBus: 0, bufferSize: bufferSize, format: targetFormat) { buffer, _ in
                      guard let channelData = buffer.floatChannelData else { return }
                      let frameLength = Int(buffer.frameLength)
                      let samples = Array(UnsafeBufferPointer(start: channelData[0], count: frameLength))

                      // 每次回调开始时复位「本回调内刚进入 speech」标记
                      self.justStartedSpeech = false

                      if self.vad == nil {
                        // VAD 不可用：回退为始终 emit（旧行为）
                        self.sendEvent("onAudioBuffer", ["samples": samples])
                        return
                      }

                      // 维护 pre-roll 环形缓冲（保留最近 300ms）
                      if self.preRollCapacity > 0 {
                        if samples.count >= self.preRollCapacity {
                          self.preRoll = samples
                        } else {
                          self.preRoll.removeFirst(samples.count)
                          self.preRoll.append(contentsOf: samples)
                        }
                      }

                      self.processVadFrames(samples)

                      // 若 speech 在本回调内刚触发，pre-roll flush 已包含当前 buffer，
                      // 此处跳过以避免约 100ms 重复发送
                      if self.speechActive && !self.justStartedSpeech {
                        self.sendEvent("onAudioBuffer", ["samples": samples])
                      }
                  }

                  // tap 输出已统一为 48kHz，VAD 始终以 48k 初始化（frameLen=960）
                  self.sampleRateForVad = Int(TARGET_SAMPLE_RATE)
                  self.initVad()

                  // 建立播放输出通路：playerNode → mainMixer → outputNode，
                  // 使 voice processing 的 AEC 能从同一 engine 的 output 取得参考信号。
                  if !self.playerNodeAttached {
                      self.audioEngine.attach(self.playerNode)
                      let playbackFormat = AVAudioFormat(
                        commonFormat: .pcmFormatFloat32,
                        sampleRate: TARGET_SAMPLE_RATE,
                        channels: 1,
                        interleaved: false
                      )!
                      self.audioEngine.connect(self.playerNode, to: self.audioEngine.mainMixerNode, format: playbackFormat)
                      self.audioEngine.connect(self.audioEngine.mainMixerNode, to: self.audioEngine.outputNode, format: nil)
                      self.playerNodeAttached = true
                  }

                  try self.audioEngine.start()
              } catch {
                  print("Error configuring audio engine: \(error.localizedDescription)")
              }
          }
      }
    }

    Function("stopRecording") {
      self.stopRecording()
    }

    Function("getSampleRate") { () -> Double in
      // tap 输出已统一重采样到 48kHz，返回该值供 JS 端重采样到 16k 使用
      return TARGET_SAMPLE_RATE
    }

    Function("playPcm") { (base64: String, sampleRate: Double) in
      self.playPcm(base64: base64, sampleRate: sampleRate)
    }

    Function("stopPlayback") {
      // playerNode 未 attach 到 engine 时调用 stop 会崩溃，故加保护
      if self.playerNodeAttached {
        self.playerNode.stop()
      }
    }

    Function("isPlaying") { () -> Bool in
      self.playerNodeAttached && self.playerNode.isPlaying
    }
  }

  private func stopRecording() {
    audioEngine.stop()
    audioEngine.inputNode.removeTap(onBus: 0)
    // Don't deactivate the audio session to allow for immediate playback
    audioBufferHandler = nil

    // 释放 VAD 并复位状态
    if let v = vad {
      fvad_free(v)
      vad = nil
    }
    speechActive = false
    speechStreak = 0
    silenceStreak = 0
    noiseFloor = FLOOR_INIT
    recalibMin = Float.greatestFiniteMagnitude
    recalibCounter = 0
  }

  // 将 base64 编码的 16-bit PCM（小端）解码、重采样到 engine 输出采样率（48kHz），
  // 转 Float32 后 schedule 到 playerNode，通过同一 engine 的 output 播放，
  // 使 voice processing AEC 能拿到与录音同源的参考信号。
  private func playPcm(base64: String, sampleRate: Double) {
    guard let data = Data(base64Encoded: base64), data.count >= 2, data.count % 2 == 0 else {
      print("[omni-audio] playPcm: invalid base64 or byte length")
      return
    }
    let int16Samples = data.withUnsafeBytes { raw -> [Int16] in
      Array(raw.bindMemory(to: Int16.self))
    }
    guard !int16Samples.isEmpty else { return }

    let floats = resampleToRate(int16Samples, from: sampleRate, to: TARGET_SAMPLE_RATE)
    guard !floats.isEmpty,
          let format = AVAudioFormat(
            commonFormat: .pcmFormatFloat32,
            sampleRate: TARGET_SAMPLE_RATE,
            channels: 1,
            interleaved: false
          ) else { return }

    let frameCount = AVAudioFrameCount(floats.count)
    guard let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: frameCount),
          let channel = buffer.floatChannelData?[0] else { return }
    buffer.frameLength = frameCount
    floats.withUnsafeBufferPointer { src in
      channel.update(from: src.baseAddress!, count: floats.count)
    }

    playerNode.scheduleBuffer(buffer) {
      print("[omni-audio] Playback finished via engine")
    }
    if !playerNode.isPlaying {
      playerNode.play()
    }
  }

  // 16-bit PCM 线性插值重采样到目标采样率，并归一化到 Float32（-1.0...1.0）
  private func resampleToRate(_ samples: [Int16], from: Double, to: Double) -> [Float] {
    guard from > 0, to > 0 else { return [] }
    if from == to {
      return samples.map { Float($0) / 32768.0 }
    }
    let ratio = from / to
    let outLen = Int(Double(samples.count) / ratio)
    guard outLen > 0 else { return [] }
    var out = [Float](repeating: 0, count: outLen)
    for i in 0..<outLen {
      let pos = Double(i) * ratio
      let i0 = min(Int(pos), samples.count - 1)
      let i1 = min(i0 + 1, samples.count - 1)
      let frac = Float(pos - Double(Int(pos)))
      let v = Float(samples[i0]) * (1 - frac) + Float(samples[i1]) * frac
      out[i] = max(-1.0, min(1.0, v / 32768.0))
    }
    return out
  }

  private func initVad() {
    if vad != nil { fvad_free(vad) }
    guard let v = fvad_new() else {
      print("[vad] fvad_new failed — will fall back to always-emit")
      return
    }
    vad = v
    if fvad_set_sample_rate(v, Int32(sampleRateForVad)) != 0 {
      // libfvad 仅支持 8k/16k/32k/48k：采样率不受支持时释放并回退为始终 emit
      print("[vad] unsupported sample rate \(sampleRateForVad) — will fall back to always-emit")
      fvad_free(v)
      vad = nil
      return
    }
    _ = fvad_set_mode(v, 2) // 2 = 中等激进度
    preRollCapacity = sampleRateForVad * 300 / 1000 // 300ms
    preRoll = Array(repeating: 0, count: preRollCapacity)
    graceFramesRemaining = 25 // 500ms / 20ms：冷启动宽限期，直喂 libfvad 收敛底噪
    print("[vad] initialized at \(sampleRateForVad)Hz, preRollCapacity=\(preRollCapacity)")
  }

  // 将一段 Float 样本切帧喂 VAD；先做能量门控粗筛，再交给 libfvad 精判
  private func processVadFrames(_ samples: [Float]) {
    guard let v = vad else { return }
    let frameLen = sampleRateForVad * VAD_FRAME_MS / 1000
    var offset = 0
    while offset + frameLen <= samples.count {
      let frame = Array(samples[offset..<(offset + frameLen)])
      let rms = computeRms(frame)

      let inGrace = graceFramesRemaining > 0
      if inGrace { graceFramesRemaining -= 1 }

      if !inGrace && rms < noiseFloor * SNR_K {
        // 能量门控：低能量直接判 silence，跳过 libfvad，并更新底噪（快降/慢升）
        noiseFloor = updateNoiseFloor(noiseFloor, rms: rms)
        updateVadState(isSpeech: false)
      } else {
        // 冷启动宽限期内，或能量够高：直喂 libfvad 精判
        // libfvad 的 fvad_process 需要 Int16 PCM，先 clamp 再转 Int16
        let frameInt16: [Int16] = frame.map { sample in
          let clamped = max(-1.0, min(1.0, sample))
          return Int16(clamped * 32767.0)
        }
        let isSpeech = frameInt16.withUnsafeBufferPointer { buf in
          fvad_process(v, buf.baseAddress, frameLen) == 1
        }
        if !isSpeech {
          // libfvad 判 silence 才更新底噪（含能量上限保护）
          noiseFloor = updateNoiseFloor(noiseFloor, rms: rms)
        }
        // 宽限期内抑制 speech 触发：floor 照常收敛，但不触发 onSpeechStart
        updateVadState(isSpeech: inGrace ? false : isSpeech)
      }
      offset += frameLen
    }
  }

  private func computeRms(_ samples: [Float]) -> Float {
    guard !samples.isEmpty else { return 0 }
    var sum: Float = 0
    for x in samples { sum += x * x }
    return (sum / Float(samples.count)).squareRoot()
  }

  // floor 只降不升 + 窗口满重校准（用窗口最低值，允许 floor 上升跟上环境变吵）
  private func updateNoiseFloor(_ floor: Float, rms: Float) -> Float {
    let newFloor = max(min(floor, rms), FLOOR_MIN)
    recalibMin = min(recalibMin, rms)
    recalibCounter += 1
    if recalibCounter >= RECALIB_WINDOW_FRAMES {
      let recalibrated = max(newFloor, recalibMin)
      recalibMin = Float.greatestFiniteMagnitude
      recalibCounter = 0
      return recalibrated
    }
    return newFloor
  }

  private func updateVadState(isSpeech: Bool) {
    if isSpeech {
      speechStreak += 1
      silenceStreak = 0
      if !speechActive && speechStreak >= SPEECH_TRIGGER_FRAMES {
        speechActive = true
        justStartedSpeech = true
        // flush pre-roll 缓冲
        if !preRoll.isEmpty {
          sendEvent("onAudioBuffer", ["samples": preRoll])
        }
        sendEvent("onSpeechStart", [:])
      }
    } else {
      silenceStreak += 1
      speechStreak = 0
      if speechActive && silenceStreak >= SILENCE_END_FRAMES {
        speechActive = false
        sendEvent("onSpeechEnd", [:])
      }
    }
  }
}
