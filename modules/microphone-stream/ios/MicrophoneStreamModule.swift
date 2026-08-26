import AVFoundation
import ExpoModulesCore

let BUF_PER_SEC = 10

// libfvad C 接口声明（Task 2 已在 app target 的 bridging header 导入 fvad.h，
// 但本文件编译进独立的 MicrophoneStream pod target，看不到 app 的 bridging header，
// 故用 @_silgen_name 直接链接 C 符号，行为与 bridging header 导入等价）。
@_silgen_name("fvad_new") private func fvad_new() -> OpaquePointer?
@_silgen_name("fvad_set_sample_rate") private func fvad_set_sample_rate(_ inst: OpaquePointer?, _ rate: Int32) -> Int32
@_silgen_name("fvad_set_mode") private func fvad_set_mode(_ inst: OpaquePointer?, _ mode: Int32) -> Int32
@_silgen_name("fvad_process") private func fvad_process(_ inst: OpaquePointer?, _ frame: UnsafePointer<Int16>?, _ length: Int) -> Int32
@_silgen_name("fvad_reset") private func fvad_reset(_ inst: OpaquePointer?)
@_silgen_name("fvad_free") private func fvad_free(_ inst: OpaquePointer?)

private let VAD_FRAME_MS = 20
private let SPEECH_TRIGGER_FRAMES = 3
private let SILENCE_END_FRAMES = 40   // 800ms / 20ms

public class MicrophoneStreamModule: Module {

  private let audioSession = AVAudioSession.sharedInstance()
  private let audioEngine = AVAudioEngine()
  private var audioBufferHandler: (([Float]) -> Void)?

  // VAD 状态
  private var vad: OpaquePointer? = nil
  private var sampleRateForVad = 48000
  private var speechActive = false
  private var speechStreak = 0
  private var silenceStreak = 0
  private var preRoll: [Float] = []
  private var preRollCapacity = 0

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
                  try self.audioSession.setCategory(.playAndRecord, mode: .default, options: [.defaultToSpeaker])
                  try self.audioSession.setPreferredSampleRate(16000.0) // default sample rate 16kHz
                  try self.audioSession.setActive(true)

                  let inputNode = self.audioEngine.inputNode
                  let hwFormat = inputNode.inputFormat(forBus: 0)
                  let bufferSize = AVAudioFrameCount(self.audioSession.sampleRate / Double(BUF_PER_SEC))

                  inputNode.installTap(onBus: 0, bufferSize: bufferSize, format: hwFormat) { buffer, _ in
                      guard let channelData = buffer.floatChannelData else { return }
                      let frameLength = Int(buffer.frameLength)
                      let samples = Array(UnsafeBufferPointer(start: channelData[0], count: frameLength))

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

                      if self.speechActive {
                        self.sendEvent("onAudioBuffer", ["samples": samples])
                      }
                  }

                  // 以实际硬件采样率为准初始化 VAD（真机为 48kHz，frameLen=960）
                  self.sampleRateForVad = Int(hwFormat.sampleRate.rounded())
                  self.initVad()

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
      // Requires initializing inputNode before retrieving sampleRate
      return self.audioEngine.inputNode.inputFormat(forBus: 0).sampleRate
    }
  }

  private func stopRecording() {
    audioEngine.inputNode.removeTap(onBus: 0)
    audioEngine.stop()
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
  }

  private func initVad() {
    guard let v = fvad_new() else { return }
    vad = v
    if fvad_set_sample_rate(v, Int32(sampleRateForVad)) != 0 {
      // libfvad 仅支持 8k/16k/32k/48k：采样率不受支持时释放并回退为始终 emit
      fvad_free(v)
      vad = nil
      return
    }
    _ = fvad_set_mode(v, 2) // 2 = 中等激进度
    preRollCapacity = sampleRateForVad * 300 / 1000 // 300ms
    preRoll = Array(repeating: 0, count: preRollCapacity)
  }

  // 将一段 Float 样本切帧喂 VAD，内部按帧更新 speech 状态
  private func processVadFrames(_ samples: [Float]) {
    guard let v = vad else { return }
    let frameLen = sampleRateForVad * VAD_FRAME_MS / 1000
    var offset = 0
    while offset + frameLen <= samples.count {
      // libfvad 的 fvad_process 需要 Int16 PCM，而 tap 给出的是 Float(-1...1)，
      // 先 clamp 再转 Int16，避免越界崩溃。
      let frameInt16: [Int16] = samples[offset..<(offset + frameLen)].map { sample in
        let clamped = max(-1.0, min(1.0, sample))
        return Int16(clamped * 32767.0)
      }
      let isSpeech = frameInt16.withUnsafeBufferPointer { buf in
        fvad_process(v, buf.baseAddress, frameLen) == 1
      }
      updateVadState(isSpeech: isSpeech)
      offset += frameLen
    }
  }

  private func updateVadState(isSpeech: Bool) {
    if isSpeech {
      speechStreak += 1
      silenceStreak = 0
      if !speechActive && speechStreak >= SPEECH_TRIGGER_FRAMES {
        speechActive = true
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
