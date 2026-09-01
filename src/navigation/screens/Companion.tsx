import React, { useEffect, useRef, useState } from "react"
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, Vibration } from "react-native"
import { AudioModule } from "expo-audio"
import * as FileSystem from "expo-file-system"
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
import { VideoFrameSource } from "@/services/VideoFrameSource"
import { CameraView, useCameraPermissions } from "expo-camera"
import {
  useCompanionStore,
  getCompanionInstructions,
  AGE_MODES,
  COMPANION_VOICES,
  VIDEO_MODES,
  AgeMode,
  CompanionVoice,
  VideoMode,
} from "@/stores/companionStore"
import { MenuAction } from "@react-native-menu/menu"
import { Ionicons } from "@expo/vector-icons"
import { localStorage } from "@/stores/localStorage"

type MicrophoneAccess = "pending" | "granted" | "denied"
type SessionStatus = "idle" | "connecting" | "listening" | "responding"

const AGE_MODE_TITLES: Record<AgeMode, string> = {
  toddler: "幼儿 (2-6)",
  child: "儿童 (6-12)",
  auto: "自适应",
}

const VIDEO_MODE_TITLES: Record<VideoMode, string> = {
  off: "关",
  onDemand: "按需抓帧",
  continuous: "持续推送",
}

type ChatMessage = { role: "user" | "assistant"; text: string; ts: number }
const HISTORY_KEY = "companion-chat-history"

function avatarIcon(role: "user" | "assistant", ageMode: AgeMode): keyof typeof Ionicons.glyphMap {
  if (role === "user") return "person"
  switch (ageMode) {
    case "toddler":
      return "balloon"
    case "child":
      return "happy"
    case "auto":
      return "sparkles"
  }
}

function dayKey(ts: number): string {
  const d = new Date(ts || Date.now())
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

async function saveDailyHistory(messages: ChatMessage[]): Promise<void> {
  try {
    const byDay = new Map<string, ChatMessage[]>()
    for (const m of messages) {
      const k = dayKey(m.ts)
      const list = byDay.get(k) ?? []
      list.push(m)
      byDay.set(k, list)
    }
    for (const [day, list] of byDay) {
      const path = `${FileSystem.documentDirectory}chat-${day}.json`
      await FileSystem.writeAsStringAsync(path, JSON.stringify(list, null, 2))
    }
  } catch (e) {
    console.warn("[companion] failed to save daily history", e)
  }
}

const SAVE_BATCH = 100
const DISPLAY_BATCH = 100

function persistMessages(list: ChatMessage[]): void {
  try {
    localStorage.set(HISTORY_KEY, JSON.stringify(list))
  } catch (e) {
    console.warn("[companion] failed to save chat history", e)
  }
  saveDailyHistory(list)
}

export const Companion = () => {
  const [micAccess, setMicAccess] = useState<MicrophoneAccess>("pending")
  const [status, setStatus] = useState<SessionStatus>("idle")
  const [messages, setMessages] = useState<ChatMessage[]>(() => {
    try {
      const raw = localStorage.getString(HISTORY_KEY)
      if (raw) return JSON.parse(raw) as ChatMessage[]
    } catch (e) {
      console.warn("[companion] failed to load chat history", e)
    }
    return []
  })
  const [errorMsg, setErrorMsg] = useState("")
  const [visibleCount, setVisibleCount] = useState(DISPLAY_BATCH)
  const [sentStats, setSentStats] = useState({ audio: 0, image: 0 })

  const { ageMode, voice, videoMode, setAgeMode, setVoice, setVideoMode } = useCompanionStore()
  const [cameraPermission, requestCameraPermission] = useCameraPermissions()

  // TODO(dev): 发版前移除 —— Prompt 调试（state + effect + resetPrompt）
  const [promptText, setPromptText] = useState(() => getCompanionInstructions(ageMode))

  useEffect(() => {
    setPromptText(getCompanionInstructions(ageMode))
  }, [ageMode])

  const resetPrompt = () => setPromptText(getCompanionInstructions(ageMode))
  // TODO(dev): 发版前移除 结束

  const serviceRef = useRef<OmniRealtimeService | null>(null)
  const playerRef = useRef<OmniAudioPlayer | null>(null)
  const audioSourceRef = useRef<AudioSource | null>(null)
  const statusRef = useRef<SessionStatus>("idle")
  const stoppingRef = useRef(false)
  const cameraRequestedRef = useRef(false)
  const cameraRef = useRef<CameraView>(null)
  const videoSourceRef = useRef<VideoFrameSource | null>(null)
  const chatScrollRef = useRef<ScrollView>(null)
  const messagesRef = useRef<ChatMessage[]>([])
  const lastSavedLenRef = useRef(0)
  const prevLenRef = useRef(0)
  const audioSentRef = useRef(0)
  const imageSentRef = useRef(0)
  const rebuildTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const proactiveTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const lastInteractionRef = useRef<number>(0)
  const userSpeakingRef = useRef<boolean>(false)
  const pendingAudioRef = useRef<Int16Array[]>([])

  const ageOptions: MenuAction[] = AGE_MODES.map((m) => ({ id: m, title: AGE_MODE_TITLES[m] }))
  const voiceOptions: MenuAction[] = COMPANION_VOICES.map((v) => ({ id: v, title: v }))
  const videoModeOptions: MenuAction[] = VIDEO_MODES.map((m) => ({ id: m, title: VIDEO_MODE_TITLES[m] }))

  useEffect(() => {
    ;(async () => {
      const s = await AudioModule.requestRecordingPermissionsAsync()
      if (s.granted) setMicAccess("granted")
      else setMicAccess("denied")
    })()
  }, [])

  useEffect(() => {
    if (
      videoMode !== "off" &&
      cameraPermission &&
      !cameraPermission.granted &&
      cameraPermission.canAskAgain &&
      !cameraRequestedRef.current
    ) {
      cameraRequestedRef.current = true
      requestCameraPermission()
    }
  }, [videoMode, cameraPermission, requestCameraPermission])

  useEffect(() => {
    messagesRef.current = messages
    if (messages.length > prevLenRef.current) {
      prevLenRef.current = messages.length
      chatScrollRef.current?.scrollToEnd({ animated: true })
    }
    if (messages.length - lastSavedLenRef.current >= SAVE_BATCH) {
      lastSavedLenRef.current = messages.length
      persistMessages(messages)
    }
  }, [messages])

  useEffect(() => {
    const timer = setInterval(() => {
      setSentStats({ audio: audioSentRef.current, image: imageSentRef.current })
    }, 1000)
    return () => clearInterval(timer)
  }, [])

  const clearHistory = () => {
    setMessages([])
    setVisibleCount(DISPLAY_BATCH)
    messagesRef.current = []
    lastSavedLenRef.current = 0
    prevLenRef.current = 0
    persistMessages([])
  }

  const teardown = () => {
    if (rebuildTimerRef.current) {
      clearTimeout(rebuildTimerRef.current)
      rebuildTimerRef.current = null
    }
    stopProactive()
    audioSourceRef.current?.stopProcessing()
    audioSourceRef.current = null
    playerRef.current?.stop()
    playerRef.current?.reset()
    playerRef.current = null
    videoSourceRef.current?.stop()
    videoSourceRef.current = null
    serviceRef.current?.disconnect()
    serviceRef.current = null
  }

  // 30s 静音重建会话：距最近一次 onSpeechEnd 满 30s 且期间无新语音则重连
  const armRebuild = () => {
    if (rebuildTimerRef.current) clearTimeout(rebuildTimerRef.current)
    rebuildTimerRef.current = setTimeout(async () => {
      if (statusRef.current !== "idle") {
        console.log("[companion] 30s silence, rebuilding session")
        const s = serviceRef.current
        if (s) {
          s.disconnect()
          try {
            await s.connect()
          } catch (e) {
            console.warn("[companion] rebuild connect failed", e)
          }
        }
      }
    }, 30000)
  }

  // response 前按需发最新帧：从环形缓冲取最新一帧，帧差初筛无变化则跳过
  const sendLatestFrameIfChanged = () => {
    const frame = videoSourceRef.current?.takeLatestChangedFrame()
    if (frame && serviceRef.current?.isReady()) {
      try {
        serviceRef.current.appendImage(frame.base64Jpg)
        imageSentRef.current += 1
      } catch (e) {
        console.warn("[companion] appendImage failed", e)
      }
    }
  }

  // 将 AI 播放期间缓存的孩子语音 flush 到服务端，并提交触发回复
  const flushAndCreate = () => {
    const s = serviceRef.current
    if (!s || !s.isReady()) return
    const pending = pendingAudioRef.current
    pendingAudioRef.current = []
    try {
      for (const samples of pending) {
        s.appendAudio(samples)
        audioSentRef.current += 1
      }
      s.commitAudioBuffer()
      s.createResponse()
    } catch (e) {
      console.warn("[companion] flush/createResponse failed", e)
    }
  }

  // 10s 定时主动触发：静默聆听中让模型看当前画面，判断是否提醒（阶段一）
  const startProactive = () => {
    stopProactive()
    proactiveTimerRef.current = setInterval(() => {
      if (
        statusRef.current === "listening" &&
        !userSpeakingRef.current &&
        Date.now() - lastInteractionRef.current > 10000
      ) {
        sendLatestFrameIfChanged()
        try {
          serviceRef.current?.createResponse()
        } catch (e) {
          console.warn("[companion] proactive createResponse failed", e)
        }
        lastInteractionRef.current = Date.now()
        armRebuild()
      }
    }, 10000)
  }

  const stopProactive = () => {
    if (proactiveTimerRef.current) {
      clearInterval(proactiveTimerRef.current)
      proactiveTimerRef.current = null
    }
  }

  const handleEvent = (event: OmniEvent, data?: any) => {
    switch (event) {
      case "session-updated":
        Vibration.vibrate(80)
        if (videoMode !== "off") {
          startProactive()
        }
        setStatus("listening")
        statusRef.current = "listening"
        break
      case "speech-started":
        serviceRef.current?.cancelResponse()
        playerRef.current?.stop()
        playerRef.current?.reset()
        setStatus("listening")
        statusRef.current = "listening"
        break
      case "user-transcript": {
        const text = (data ?? "").trim()
        if (text) {
          setMessages((prev) => [...prev, { role: "user", text, ts: Date.now() }])
        }
        break
      }
      case "audio-delta":
      case "assistant-transcript-delta":
        setStatus("responding")
        statusRef.current = "responding"
        // 回复进行中不计静音时长：取消 30s 重建定时器，避免回复中途被重建
        if (rebuildTimerRef.current) {
          clearTimeout(rebuildTimerRef.current)
          rebuildTimerRef.current = null
        }
        break
      case "audio-done":
        playerRef.current?.play()
        setStatus("listening")
        statusRef.current = "listening"
        // 回复结束回到聆听：重新武装 30s 静音重建定时器
        armRebuild()
        break
      case "response-done":
        setStatus("listening")
        statusRef.current = "listening"
        // 回复结束回到聆听：重新武装 30s 静音重建定时器
        armRebuild()
        // 若 AI 播放期间缓存了孩子语音且孩子已说完，flush 触发新回复
        if (pendingAudioRef.current.length > 0 && !userSpeakingRef.current) {
          flushAndCreate()
        }
        break
      case "error":
        Vibration.vibrate([0, 200, 100, 200])
        teardown()
        setErrorMsg(typeof data?.message === "string" ? data.message : "连接出错")
        setStatus("idle")
        statusRef.current = "idle"
        break
      default:
        break
    }
  }

  const handleStart = async () => {
    stoppingRef.current = false
    setErrorMsg("")
    audioSentRef.current = 0
    imageSentRef.current = 0
    lastInteractionRef.current = 0
    userSpeakingRef.current = false
    setSentStats({ audio: 0, image: 0 })
    setStatus("connecting")
    statusRef.current = "connecting"

    const config: OmniRealtimeConfig = {
      ...DEFAULT_OMNI_CONFIG,
      voice,
      instructions: promptText, // TODO(dev): 发版前改回 getCompanionInstructions(ageMode)
    }

    const service = new OmniRealtimeService(config)
    serviceRef.current = service

    const player = new OmniAudioPlayer()
    playerRef.current = player

    service.setEventCallback(handleEvent)
    service.setAudioDeltaCallback((b64) => player.appendPcmBase64(b64))
    service.setTranscriptCallback((text) => {
      setMessages((prev) => {
        const last = prev[prev.length - 1]
        if (last && last.role === "assistant") {
          return [...prev.slice(0, -1), { ...last, text: last.text + text }]
        }
        return [...prev, { role: "assistant", text, ts: Date.now() }]
      })
      setStatus("responding")
      statusRef.current = "responding"
      // 回复进行中不计静音时长：取消 30s 重建定时器，避免回复中途被重建
      if (rebuildTimerRef.current) {
        clearTimeout(rebuildTimerRef.current)
        rebuildTimerRef.current = null
      }
    })
    service.setErrorCallback((err) => {
      teardown()
      setErrorMsg(err.message)
      setStatus("idle")
      statusRef.current = "idle"
    })

    try {
      await service.connect()

      const audioSource = AudioSource.getInstance()
      audioSourceRef.current = audioSource
      audioSource.setSpeechCallbacks(
        () => {
          // AI 播放期间孩子说话：标记在说，语音会被缓存，等播放完一起发（不打断）
          if (playerRef.current?.isPlaying()) {
            userSpeakingRef.current = true
            return
          }
          // 孩子开口：标记用户说话并取消静音重建定时器
          userSpeakingRef.current = true
          if (rebuildTimerRef.current) {
            clearTimeout(rebuildTimerRef.current)
            rebuildTimerRef.current = null
          }
          // 生成期间（尚未播放、无回声）：孩子真实说话，打断生成
          if (statusRef.current === "responding") {
            service.cancelResponse()
            playerRef.current?.stop()
            playerRef.current?.reset()
            setStatus("listening")
            statusRef.current = "listening"
          }
        },
        () => {
          userSpeakingRef.current = false
          lastInteractionRef.current = Date.now()
          armRebuild()
          // AI 播放中孩子说完：语音已缓存，等播放完（response-done）再 flush
          if (playerRef.current?.isPlaying()) return
          flushAndCreate()
        }
      )
      audioSource.startProcessing((processed) => {
        if (!processed?.data || !service.isReady()) return
        // AI 播放期间（或已有缓存待发）：缓存孩子语音，等播放完一起发
        if (playerRef.current?.isPlaying() || pendingAudioRef.current.length > 0) {
          pendingAudioRef.current.push(processed.data)
          return
        }
        try {
          service.appendAudio(processed.data)
          audioSentRef.current += 1
        } catch (e) {
          console.warn("[companion] appendAudio failed", e)
        }
      })

      // 启动 30s 静音重建定时器
      armRebuild()

      if (videoMode !== "off" && cameraPermission?.granted) {
        const videoSource = new VideoFrameSource()
        videoSource.setCameraRef(cameraRef)
        videoSource.setChangeCallback(() => {
          if (
            statusRef.current === "listening" &&
            !userSpeakingRef.current &&
            Date.now() - lastInteractionRef.current > 10000
          ) {
            sendLatestFrameIfChanged()
            try {
              service.createResponse()
            } catch (e) {
              console.warn("[companion] mutation createResponse failed", e)
            }
            lastInteractionRef.current = Date.now()
            armRebuild()
          }
        })
        videoSource.start(videoMode)
        videoSourceRef.current = videoSource
      }
    } catch (e) {
      if (stoppingRef.current) {
        return
      }
      teardown()
      setErrorMsg(e instanceof Error ? e.message : String(e))
      setStatus("idle")
      statusRef.current = "idle"
    }
  }

  const handleStop = () => {
    stoppingRef.current = true
    teardown()
    persistMessages(messagesRef.current)
    lastSavedLenRef.current = messagesRef.current.length
    setSentStats({ audio: audioSentRef.current, image: imageSentRef.current })
    setStatus("idle")
    statusRef.current = "idle"
  }

  useEffect(() => {
    return () => {
      stopProactive()
      audioSourceRef.current?.stopProcessing()
      playerRef.current?.stop()
      videoSourceRef.current?.stop()
      serviceRef.current?.disconnect()
      persistMessages(messagesRef.current)
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
        <View style={styles.optionRow}>
          <Text style={styles.optionLabel}>年龄段</Text>
          <Picker
            actions={ageOptions}
            onSelect={(id) => setAgeMode(id as AgeMode)}
            value={ageMode}
            disabled={isRunning}
          >
            <TouchableOpacity style={styles.optionButton}>
              <Text style={styles.optionButtonText}>{AGE_MODE_TITLES[ageMode]}</Text>
            </TouchableOpacity>
          </Picker>
        </View>

        <View style={styles.optionRow}>
          <Text style={styles.optionLabel}>音色</Text>
          <Picker
            actions={voiceOptions}
            onSelect={(id) => setVoice(id as CompanionVoice)}
            value={voice}
            disabled={isRunning}
          >
            <TouchableOpacity style={styles.optionButton}>
              <Text style={styles.optionButtonText}>{voice}</Text>
            </TouchableOpacity>
          </Picker>
        </View>

        <View style={styles.optionRow}>
          <Text style={styles.optionLabel}>视频</Text>
          <Picker
            actions={videoModeOptions}
            onSelect={(id) => setVideoMode(id as VideoMode)}
            value={videoMode}
            disabled={isRunning}
          >
            <TouchableOpacity style={styles.optionButton}>
              <Text style={styles.optionButtonText}>{VIDEO_MODE_TITLES[videoMode]}</Text>
            </TouchableOpacity>
          </Picker>
        </View>

        {videoMode !== "off" &&
          (isRunning && cameraPermission?.granted ? (
            <CameraView ref={cameraRef} facing="back" style={styles.camera} />
          ) : (
            <View style={styles.cameraPlaceholder}>
              <Text style={styles.cameraPlaceholderText}>
                {cameraPermission && !cameraPermission.granted
                  ? "未授权摄像头，请在系统设置中开启"
                  : "开始陪伴后显示摄像头画面"}
              </Text>
            </View>
          ))}

      </View>

      {/* TODO(dev): 发版前移除 —— Prompt 调试区块（下面整个 section） */}
      <View style={styles.section}>
        <View style={styles.chatHeader}>
          <Text style={styles.sectionTitle}>Prompt（调试，发版前移除）</Text>
          <TouchableOpacity onPress={resetPrompt}>
            <Text style={styles.clearButton}>重置</Text>
          </TouchableOpacity>
        </View>
        <TextInput
          style={styles.promptInput}
          value={promptText}
          onChangeText={setPromptText}
          editable={!isRunning}
          multiline
          placeholder="输入系统提示词"
          placeholderTextColor={Colors.secondary}
        />
      </View>

      <View style={styles.section}>
        <TouchableOpacity
          style={[styles.button, isRunning ? styles.stopButton : styles.startButton]}
          onPress={isRunning ? handleStop : handleStart}
        >
          <Text style={styles.buttonText}>{isRunning ? "停止陪伴" : "开始陪伴"}</Text>
        </TouchableOpacity>

        <View style={styles.statusRow}>
          <Text style={styles.statusText}>状态: {statusLabel}</Text>
          {errorMsg ? (
            <Text style={styles.errorText} numberOfLines={1}>
              {errorMsg}
            </Text>
          ) : null}
        </View>
        <Text style={styles.sentStatsText}>
          音频 {sentStats.audio} 块 · 图片 {sentStats.image} 帧
        </Text>
      </View>

      <View style={styles.section}>
        <View style={styles.chatHeader}>
          <Text style={styles.sectionTitle}>对话</Text>
          <TouchableOpacity onPress={clearHistory} disabled={messages.length === 0}>
            <Text style={[styles.clearButton, messages.length === 0 && styles.clearButtonDisabled]}>
              清空
            </Text>
          </TouchableOpacity>
        </View>

        <ScrollView
          ref={chatScrollRef}
          style={styles.chatBox}
          maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
          onScroll={({ nativeEvent }) => {
            if (nativeEvent.contentOffset.y <= 10 && visibleCount < messages.length) {
              setVisibleCount((c) => c + DISPLAY_BATCH)
            }
          }}
          scrollEventThrottle={100}
        >
          {messages.length === 0 ? (
            <Text style={styles.chatEmpty}>开始对话吧…</Text>
          ) : (
            messages.slice(Math.max(0, messages.length - visibleCount)).map((m, i) => {
              const idx = Math.max(0, messages.length - visibleCount) + i
              const isUser = m.role === "user"
              return (
                <View
                  key={idx}
                  style={[styles.messageRow, isUser ? styles.userRow : styles.assistantRow]}
                >
                  {!isUser && (
                    <View style={[styles.avatar, styles.assistantAvatar]}>
                      <Ionicons name={avatarIcon(m.role, ageMode)} size={18} color={Colors.primary} />
                    </View>
                  )}
                  <View style={[styles.chatBubble, isUser ? styles.userBubble : styles.assistantBubble]}>
                    <Text
                      style={[styles.chatText, isUser ? styles.userChatText : styles.assistantChatText]}
                    >
                      {m.text}
                    </Text>
                  </View>
                  {isUser && (
                    <View style={[styles.avatar, styles.userAvatar]}>
                      <Ionicons name={avatarIcon(m.role, ageMode)} size={18} color={Colors.primary} />
                    </View>
                  )}
                </View>
              )
            })
          )}
        </ScrollView>
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
    borderRadius: 12,
    padding: 12,
    marginBottom: 10,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "bold",
    color: Colors.primary,
    marginBottom: 0,
  },
  optionRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 6,
  },
  optionLabel: {
    color: Colors.primary,
    fontSize: 15,
    fontWeight: "bold",
  },
  optionButton: {
    backgroundColor: Colors.bgInactive,
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: Colors.primary,
  },
  optionButtonText: {
    color: Colors.primary,
    fontWeight: "bold",
    fontSize: 13,
  },
  camera: {
    width: "100%",
    height: 200,
    borderRadius: 10,
    overflow: "hidden",
    marginTop: 10,
  },
  cameraPlaceholder: {
    width: "100%",
    height: 200,
    borderRadius: 10,
    backgroundColor: Colors.bgInactive,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 10,
  },
  cameraPlaceholderText: {
    color: Colors.secondary,
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
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 8,
  },
  errorText: {
    color: Colors.warn,
    fontSize: 12,
    marginLeft: 10,
    flexShrink: 1,
  },
  sentStatsText: {
    color: Colors.secondary,
    fontSize: 12,
    marginTop: 4,
  },
  // TODO(dev): 发版前移除
  promptInput: {
    backgroundColor: Colors.bgInactive,
    borderRadius: 10,
    padding: 12,
    color: Colors.primary,
    fontSize: 13,
    lineHeight: 19,
    minHeight: 120,
    maxHeight: 220,
    textAlignVertical: "top",
  },
  chatHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  clearButton: {
    color: Colors.secondary,
    fontSize: 13,
  },
  clearButtonDisabled: {
    opacity: 0.4,
  },
  chatBox: {
    backgroundColor: Colors.bgInactive,
    borderRadius: 10,
    padding: 10,
    maxHeight: 320,
  },
  chatEmpty: {
    color: Colors.secondary,
    fontSize: 14,
    textAlign: "center",
    paddingVertical: 24,
  },
  messageRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    marginBottom: 8,
  },
  userRow: {
    justifyContent: "flex-end",
  },
  assistantRow: {
    justifyContent: "flex-start",
  },
  avatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  assistantAvatar: {
    backgroundColor: Colors.accent,
    marginRight: 8,
  },
  userAvatar: {
    backgroundColor: Colors.secondary,
    marginLeft: 8,
  },
  chatBubble: {
    maxWidth: "75%",
    borderRadius: 12,
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  userBubble: {
    backgroundColor: Colors.primary,
  },
  assistantBubble: {
    backgroundColor: Colors.bgActive,
  },
  chatText: {
    fontSize: 15,
    lineHeight: 21,
  },
  userChatText: {
    color: Colors.bgInactive,
  },
  assistantChatText: {
    color: Colors.primary,
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
