import React, { useEffect, useMemo, useState } from "react"
import { View, useWindowDimensions, Alert } from "react-native"
import { Canvas } from "@shopify/react-native-skia"

import DSPModule from "@/../specs/NativeDSPModule"
import MicrophoneStreamModule, { AudioBuffer } from "@/../modules/microphone-stream"
import { AudioModule } from "expo-audio"
import Colors from "@/colors"
import { Spectrum } from "@/components/Spectrum"
import RequireMicAccess from "@/components/RequireMicAccess"
import ConfigButton from "@/components/ConfigButton"
import { useTranslation } from "@/configHooks"

const BUF_SIZE = 9000
const BUF_PER_SEC = MicrophoneStreamModule.BUF_PER_SEC

type MicrophoneAccess = "pending" | "granted" | "denied"

export const Avatar = () => {
  const { width, height } = useWindowDimensions()
  const t = useTranslation()

  // Audio buffer
  const [sampleRate, setSampleRate] = useState(0)
  const [audioBuffer, setAudioBuffer] = useState<number[]>(() => new Array(BUF_SIZE).fill(0))
  const [bufferId, setBufferId] = useState(0)

  // Flag for microphone access granted
  const [micAccess, setMicAccess] = useState<MicrophoneAccess>("pending")

  // Request recording permission
  useEffect(() => {
    ;(async () => {
      const status = await AudioModule.requestRecordingPermissionsAsync()
      if (status.granted) {
        console.log("Granted microphone permission")
        setMicAccess("granted")
      } else {
        setMicAccess("denied")
        Alert.alert(t("error_mic_access"))
      }
    })()
  }, [t])

  // Start microphone recording
  useEffect(() => {
    if (micAccess !== "granted") return

    // Start microphone
    MicrophoneStreamModule.startRecording()
    console.log("Start recording")

    // Suscribe to microphone buffer
    const subscriber = MicrophoneStreamModule.addListener(
      "onAudioBuffer",
      (buffer: AudioBuffer) => {
        // Append new audio samples to the end of the buffer
        const len = buffer.samples.length
        setAudioBuffer((prevBuffer) => [...prevBuffer.slice(len), ...buffer.samples])
        setBufferId((prevId) => prevId + 1)
        console.log(`onAudioBuffer: bufId=${bufferId}, samples.len=${buffer.samples.length}`)
      }
    )
    return () => {
      subscriber.remove()
      MicrophoneStreamModule.stopRecording()
    }
  }, [micAccess])

  // Set sampleRate after first audio buffer
  useEffect(() => {
    if (sampleRate || micAccess !== "granted") return
    
    const sr = MicrophoneStreamModule.getSampleRate()
    console.log(`Setting sample rate to ${sr}Hz`)
    setSampleRate(sr)
  }, [sampleRate, micAccess])

  // Calculate layout for 3 tracks
  const trackWidth = width
  const trackHeight = height / 3
  const trackMargin = 10
  const usableTrackHeight = trackHeight - trackMargin * 2

  return micAccess === "granted" ? (
    <View style={{ flex: 1, backgroundColor: Colors.bgInactive }}>
      <Canvas style={{ flex: 1 }}>
        {/* Track 1 */}
        <Spectrum
          audioBuffer={audioBuffer}
          positionY={trackMargin}
          height={usableTrackHeight}
          width={trackWidth}
          bufferId={bufferId}
          bufPerSec={BUF_PER_SEC}
        />
        
        {/* <Spectrum
          audioBuffer={audioBuffer}
          positionY={trackHeight + trackMargin}
          height={usableTrackHeight}
          width={trackWidth}
          bufferId={bufferId}
          bufPerSec={BUF_PER_SEC}
        />
        <Spectrum
          audioBuffer={audioBuffer}
          positionY={trackHeight * 2 + trackMargin}
          height={usableTrackHeight}
          width={trackWidth}
          bufferId={bufferId}
          bufPerSec={BUF_PER_SEC}
        /> */}
      </Canvas>
      
      {/* Config button */}
      <ConfigButton
        x={width - 50 * 1.5}
        y={height - 50 * 1.5}
        size={1.5}
      />
    </View>
  ) : micAccess === "denied" ? (
    <RequireMicAccess />
  ) : undefined // micAccess "pending"
}