import { NativeModule, requireNativeModule } from "expo"

export type MicrophoneStreamModuleEvents = {
  onAudioBuffer: (params: AudioBuffer) => void
  onSpeechStart: () => void
  onSpeechEnd: () => void
}

export type AudioBuffer = {
  samples: number[]
}

declare class MicrophoneStreamModule extends NativeModule<MicrophoneStreamModuleEvents> {
  stopRecording(): void
  startRecording(): void
  getSampleRate(): number
  playPcm(base64: string, sampleRate: number): void
  stopPlayback(): void
  isPlaying(): boolean
  BUF_PER_SEC: number
}

// This call loads the native module object from the JSI.
export default requireNativeModule<MicrophoneStreamModule>("MicrophoneStream")
