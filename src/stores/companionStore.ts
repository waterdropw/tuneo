import { create } from "zustand"
import { persist, createJSONStorage } from "zustand/middleware"
import { zustandStorage } from "./localStorage"
import prompts from "@/config/prompts.json"

export const AGE_MODES = ["toddler", "child", "auto"] as const
export type AgeMode = (typeof AGE_MODES)[number]

// 注：音色 ID 为外部 API 数据，若调用报错请对照 DashScope 控制台核对（qwen3.5-omni 系列默认 Tina）。
export const COMPANION_VOICES = ["Tina", "Cherry", "Serena", "Ethan", "Chelsie", "Jada"] as const
export type CompanionVoice = (typeof COMPANION_VOICES)[number]

export const VIDEO_MODES = ["off", "onDemand", "continuous"] as const
export type VideoMode = (typeof VIDEO_MODES)[number]

export function getCompanionInstructions(ageMode: AgeMode): string {
  return prompts[ageMode]
}

interface CompanionState {
  ageMode: AgeMode
  voice: CompanionVoice
  videoMode: VideoMode
  setAgeMode: (mode: AgeMode) => void
  setVoice: (voice: CompanionVoice) => void
  setVideoMode: (mode: VideoMode) => void
}

export const useCompanionStore = create<CompanionState>()(
  persist(
    (set) => ({
      ageMode: "toddler",
      voice: "Tina",
      videoMode: "off",
      setAgeMode: (ageMode) => set({ ageMode }),
      setVoice: (voice) => set({ voice }),
      setVideoMode: (videoMode) => set({ videoMode }),
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
        if (saved.videoMode && VIDEO_MODES.includes(saved.videoMode as any)) {
          loaded.videoMode = saved.videoMode
        }
        return loaded
      },
    }
  )
)
