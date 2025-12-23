import Colors from "@/colors"
import { Group, Path, SkPath } from "@shopify/react-native-skia"
import { useEffect, useMemo, useState } from "react"
import { useWindowDimensions } from "react-native"
import { Skia } from "@shopify/react-native-skia"
import { cancelAnimation, useSharedValue, withTiming } from "react-native-reanimated"

const REFRESH_FRAMES = 1

// FFT相关参数
const FFT_SIZE = 2048
const FREQ_BINS = 64

interface SpectrumProps {
  audioBuffer: number[]
  positionY: number
  height: number
  width: number
  bufferId: number
  bufPerSec: number
}

export const Spectrum = ({
  audioBuffer,
  positionY,
  height,
  width,
  bufferId,
  bufPerSec,
}: SpectrumProps) => {
  // Only refresh alignedAudio once every REFRESH_FRAMES
  const refresh = useMemo(() => Math.floor(bufferId / REFRESH_FRAMES), [bufferId])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const alignedAudio = useMemo(() => getAlignedAudio(audioBuffer, FFT_SIZE), [refresh])

  const [spectrumPath, setSpectrumPath] = useState<SkPath>()

  useEffect(() => {
    setSpectrumPath(getSpectrumPath(alignedAudio, width, height))
  }, [alignedAudio, width, height])

  const progress = useSharedValue(0)
  useEffect(() => {
    progress.value = 0
    progress.value = withTiming(1, { duration: (1000 * REFRESH_FRAMES) / bufPerSec })

    return () => cancelAnimation(progress)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bufPerSec, bufferId])

  return (
    spectrumPath && (
      <Group transform={[{ translateY: positionY }]}>
        <Path
          style="fill"
          path={spectrumPath}
          color={Colors.secondary}
          opacity={0.8}
        />
      </Group>
    )
  )
}

/**
 * 将音频缓冲区对齐到指定大小
 */
function getAlignedAudio(audioBuffer: number[], maxSize: number) {
  if (!audioBuffer.length) return []
  
  // 如果缓冲区太小，复制填充
  if (audioBuffer.length < maxSize) {
    const fullBuffer = new Array(maxSize).fill(0)
    fullBuffer.set(audioBuffer)
    return fullBuffer
  }
  
  // 如果缓冲区太大，截取中间部分
  const start = Math.floor((audioBuffer.length - maxSize) / 2)
  return audioBuffer.slice(start, start + maxSize)
}

/**
 * 生成频谱图路径
 * 简化实现：使用信号的绝对值作为频谱强度
 */
function getSpectrumPath(samples: number[], width: number, height: number) {
  "worklet"
  
  const path = Skia.Path.Make()
  
  // 计算每个频率 bin 的宽度
  const binWidth = width / FREQ_BINS
  
  // 计算每个 bin 的最大振幅
  const binAmplitudes = new Array(FREQ_BINS).fill(0)
  const binSize = Math.floor(samples.length / FREQ_BINS)
  
  // 计算每个 bin 的振幅
  for (let i = 0; i < FREQ_BINS; i++) {
    let sum = 0
    let count = 0
    for (let j = 0; j < binSize; j++) {
      const idx = i * binSize + j
      if (idx < samples.length) {
        sum += Math.abs(samples[idx])
        count++
      }
    }
    binAmplitudes[i] = count > 0 ? sum / count : 0
  }
  
  // 归一化振幅
  const maxAmplitude = Math.max(...binAmplitudes, 0.001) // 避免除以零
  const normalizedAmplitudes = binAmplitudes.map(amp => amp / maxAmplitude)
  
  // 创建频谱图路径
  path.moveTo(0, height)
  
  for (let i = 0; i < FREQ_BINS; i++) {
    const x = i * binWidth
    const amp = normalizedAmplitudes[i]
    const y = height - amp * height
    path.lineTo(x, y)
  }
  
  // 关闭路径
  path.lineTo(width, height)
  path.close()
  
  return path
}