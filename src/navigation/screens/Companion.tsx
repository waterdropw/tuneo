import React, { useEffect, useRef, useState } from "react"
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from "react-native"
import { AudioModule } from "expo-audio"
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

export const Companion = () => {
  const [micAccess, setMicAccess] = useState<MicrophoneAccess>("pending")
  const [status, setStatus] = useState<SessionStatus>("idle")
  const [assistantText, setAssistantText] = useState("")
  const [userText, setUserText] = useState("")
  const [errorMsg, setErrorMsg] = useState("")

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
        setAssistantText("")
        setUserText("")
        setStatus("listening")
        statusRef.current = "listening"
        break
      case "user-transcript":
        setUserText(data ?? "")
        break
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
    setAssistantText("")
    setUserText("")
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
      setAssistantText((prev) => prev + text)
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
    setStatus("idle")
    statusRef.current = "idle"
    setAssistantText("")
    setUserText("")
  }

  useEffect(() => {
    return () => {
      audioSourceRef.current?.stopProcessing()
      playerRef.current?.stop()
      videoSourceRef.current?.stop()
      serviceRef.current?.disconnect()
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
        <Text style={styles.sectionTitle}>年龄段</Text>
        <Picker
          actions={ageOptions}
          onSelect={(id) => setAgeMode(id as AgeMode)}
          value={ageMode}
          disabled={isRunning}
        >
          <TouchableOpacity style={styles.pickerButton}>
            <Text style={styles.pickerButtonText}>{AGE_MODE_TITLES[ageMode]}</Text>
          </TouchableOpacity>
        </Picker>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>音色</Text>
        <Picker
          actions={voiceOptions}
          onSelect={(id) => setVoice(id as CompanionVoice)}
          value={voice}
          disabled={isRunning}
        >
          <TouchableOpacity style={styles.pickerButton}>
            <Text style={styles.pickerButtonText}>{voice}</Text>
          </TouchableOpacity>
        </Picker>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>视频</Text>
        <Picker
          actions={videoModeOptions}
          onSelect={(id) => setVideoMode(id as VideoMode)}
          value={videoMode}
          disabled={isRunning}
        >
          <TouchableOpacity style={styles.pickerButton}>
            <Text style={styles.pickerButtonText}>{VIDEO_MODE_TITLES[videoMode]}</Text>
          </TouchableOpacity>
        </Picker>

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
            onPress={() => videoSourceRef.current?.captureFrame()}
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
      </View>

      <View style={styles.section}>
        <Text style={styles.statusText}>状态: {statusLabel}</Text>
        {errorMsg ? <Text style={styles.errorText}>{errorMsg}</Text> : null}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>孩子说</Text>
        <View style={styles.resultBox}>
          <Text style={styles.resultText}>{userText || "…"}</Text>
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>AI 回复</Text>
        <View style={styles.resultBox}>
          <Text style={styles.resultText}>{assistantText || "…"}</Text>
        </View>
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
    borderRadius: 15,
    padding: 15,
    marginBottom: 15,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "bold",
    color: Colors.primary,
    marginBottom: 10,
  },
  pickerButton: {
    backgroundColor: Colors.bgInactive,
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: Colors.primary,
    alignItems: "center",
  },
  pickerButtonText: {
    color: Colors.primary,
    fontWeight: "bold",
    fontSize: 14,
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
  errorText: {
    color: Colors.warn,
    fontSize: 13,
    marginTop: 6,
  },
  resultBox: {
    backgroundColor: Colors.bgInactive,
    borderRadius: 10,
    padding: 12,
    minHeight: 70,
    justifyContent: "center",
    borderLeftWidth: 4,
    borderLeftColor: Colors.primary,
  },
  resultText: {
    fontSize: 16,
    color: Colors.primary,
    lineHeight: 24,
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
