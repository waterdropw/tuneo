import { create } from "zustand"
import { persist, createJSONStorage } from "zustand/middleware"
import { zustandStorage } from "./localStorage"

export const AGE_MODES = ["toddler", "child", "auto"] as const
export type AgeMode = (typeof AGE_MODES)[number]

// 注：音色 ID 为外部 API 数据，若调用报错请对照 DashScope 控制台核对（qwen3.5-omni 系列默认 Tina）。
export const COMPANION_VOICES = ["Tina", "Cherry", "Serena", "Ethan", "Chelsie", "Jada"] as const
export type CompanionVoice = (typeof COMPANION_VOICES)[number]

export const VIDEO_MODES = ["off", "onDemand", "continuous"] as const
export type VideoMode = (typeof VIDEO_MODES)[number]

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
