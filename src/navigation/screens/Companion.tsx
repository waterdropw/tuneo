import React, { useEffect, useRef, useState } from "react"
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from "react-native"
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

  const { ageMode, voice, videoMode, setAgeMode, setVoice, setVideoMode } = useCompanionStore()
  const [cameraPermission, requestCameraPermission] = useCameraPermissions()

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

  const clearHistory = () => {
    setMessages([])
    setVisibleCount(DISPLAY_BATCH)
    messagesRef.current = []
    lastSavedLenRef.current = 0
    prevLenRef.current = 0
    persistMessages([])
  }

  const teardown = () => {
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

  const handleEvent = (event: OmniEvent, data?: any) => {
    switch (event) {
      case "session-updated":
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
      setMessages((prev) => {
        const last = prev[prev.length - 1]
        if (last && last.role === "assistant") {
          return [...prev.slice(0, -1), { ...last, text: last.text + text }]
        }
        return [...prev, { role: "assistant", text, ts: Date.now() }]
      })
      setStatus("responding")
      statusRef.current = "responding"
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
      audioSource.startProcessing((processed) => {
        if (processed?.data && service.isReady()) {
          try {
            service.appendAudio(processed.data)
          } catch (e) {
            console.warn("[companion] appendAudio failed", e)
          }
        }
      })

      if (videoMode !== "off" && cameraPermission?.granted) {
        const videoSource = new VideoFrameSource()
        videoSource.setCameraRef(cameraRef)
        videoSource.setFrameCallback((b64) => {
          if (service.isReady()) {
            try {
              service.appendImage(b64)
            } catch (e) {
              console.warn("[companion] appendImage failed", e)
            }
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
    setStatus("idle")
    statusRef.current = "idle"
  }

  useEffect(() => {
    return () => {
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

        {videoMode === "onDemand" && isRunning && cameraPermission?.granted && (
          <TouchableOpacity
            style={styles.captureButton}
            onPress={() => {
              setMessages((prev) => [...prev, { role: "user", text: "[图片]", ts: Date.now() }])
              videoSourceRef.current?.captureFrame()
            }}
          >
            <Text style={styles.buttonText}>看这个</Text>
          </TouchableOpacity>
        )}
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
              return (
                <View
                  key={idx}
                  style={[
                    styles.chatBubble,
                    m.role === "user" ? styles.userBubble : styles.assistantBubble,
                  ]}
                >
                  <Text
                    style={[
                      styles.chatText,
                      m.role === "user" ? styles.userChatText : styles.assistantChatText,
                    ]}
                  >
                    {m.text}
                  </Text>
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
  captureButton: {
    backgroundColor: Colors.primary,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: "center",
    marginTop: 10,
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
  chatBubble: {
    maxWidth: "85%",
    borderRadius: 12,
    paddingVertical: 8,
    paddingHorizontal: 12,
    marginBottom: 8,
  },
  userBubble: {
    alignSelf: "flex-end",
    backgroundColor: Colors.primary,
  },
  assistantBubble: {
    alignSelf: "flex-start",
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
