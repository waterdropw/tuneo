package expo.modules.microphonestream

import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.Promise
import kotlin.concurrent.thread

val BUF_PER_SEC = 10

class MicrophoneStreamModule : Module() {

    private var audioRecord: AudioRecord? = null
    private var readThread: Thread? = null
    @Volatile private var isRecording = false
    private val sampleRate = 16000 // Default sample rate
    private val bufferSize = maxOf(
        sampleRate / BUF_PER_SEC,
        AudioRecord.getMinBufferSize(
            sampleRate,
            AudioFormat.CHANNEL_IN_MONO,
            AudioFormat.ENCODING_PCM_16BIT
        )
    )

    // --- 原生 VAD（libfvad via JNI，函数名与 jni/microphonestream_jni.c 一一对应） ---
    private external fun nativeVadCreate(sampleRate: Int, mode: Int): Long
    private external fun nativeVadProcess(handle: Long, frame: ShortArray, length: Int): Int
    private external fun nativeVadFree(handle: Long)

    @Volatile private var vadHandle = 0L
    private val vadFrameMs = 20
    private val speechTriggerFrames = 15 // 300ms / 20ms：最小语音时长，过滤喷嚏等瞬态
    private val silenceEndFrames = 40
    // 能量门控 + 自适应底噪参数（RMS 幅度域，与 iOS/TS 参考一致）
    private val snrK = 4.0f          // 12dB：rms >= floor × 4 才喂 libfvad
    private val floorAlphaDown = 0.2f // 底噪下探（快）
    private val floorAlphaUp = 0.05f  // 底噪上升（慢）
    private val floorInit = 0.25f     // 冷启动保守初值
    private val floorCap = 8.0f       // 能量上限保护：瞬态不更新底噪
    private val floorMin = 1e-6f      // 底噪下限
    private val recalibWindowFrames = 250 // 5s / 20ms：floor 重校准窗口
    private var speechActive = false
    private var justStartedSpeech = false
    private var speechStreak = 0
    private var silenceStreak = 0
    private val preRoll = ArrayDeque<Short>()
    private var preRollCapacity = 0
    private var noiseFloor = floorInit
    private var recalibMin = Float.MAX_VALUE
    private var recalibCounter = 0
    private var graceFramesRemaining = 0

    init {
        try {
            // CMake 构建产物为 libmicrophonestream-jni.so。
            // 加载失败（如未走 externalNativeBuild 的环境）时保持 vadHandle == 0，
            // 读循环会回退为始终 emit（旧行为），与 iOS 端回退策略一致。
            System.loadLibrary("microphonestream-jni")
        } catch (_: Throwable) {
            // VAD 不可用：保持 vadHandle == 0
        }
    }

    override fun definition() = ModuleDefinition {
        Name("MicrophoneStream")

        Events("onAudioBuffer", "onSpeechStart", "onSpeechEnd")

        Constants(
            "BUF_PER_SEC" to BUF_PER_SEC
        )

        Function("startRecording") {
            startRecording()
        }

        Function("stopRecording") {
            stopRecording()
        }

        Function("getSampleRate") { ->
            sampleRate.toDouble()
        }
    }

    private fun startRecording() {
        if (isRecording) return

        audioRecord = AudioRecord(
            MediaRecorder.AudioSource.MIC,
            sampleRate,
            AudioFormat.CHANNEL_IN_MONO,
            AudioFormat.ENCODING_PCM_16BIT,
            bufferSize
        )

        isRecording = true
        audioRecord?.startRecording()

        initVad()

        readThread = thread {
            val buffer = ShortArray(bufferSize)
            while (isRecording) {
                val read = audioRecord?.read(buffer, 0, buffer.size) ?: 0
                if (read > 0) {
                    if (vadHandle == 0L) {
                        // VAD 不可用：回退为始终 emit（旧行为）
                        val floatBuffer = buffer.map { it / 32768.0f }
                        sendEvent("onAudioBuffer", mapOf("samples" to floatBuffer))
                    } else {
                        // 每次读迭代复位「本迭代内刚进入 speech」标记，
                        // 避免 speech 触发瞬间 pre-roll flush 与 live emit 重复约 100ms
                        justStartedSpeech = false

                        // pre-roll 环形缓冲（保留最近 300ms）
                        if (preRollCapacity > 0) {
                            if (read >= preRollCapacity) {
                                preRoll.clear()
                                preRoll.addAll(buffer.take(read))
                            } else {
                                repeat(read) { if (preRoll.size >= preRollCapacity) preRoll.removeFirst() }
                                preRoll.addAll(buffer.take(read))
                            }
                        }

                        // 按 20ms 帧喂 VAD（Android 采样率为 16kHz，frameLen = 320）
                        val frameLen = sampleRate * vadFrameMs / 1000
                        var offset = 0
                        while (offset + frameLen <= read) {
                            val frame = buffer.copyOfRange(offset, offset + frameLen)
                            val rms = computeRms(frame)

                            val inGrace = graceFramesRemaining > 0
                            if (inGrace) { graceFramesRemaining -= 1 }

                            if (!inGrace && rms < noiseFloor * snrK) {
                                // 能量门控：低能量直接判 silence，跳过 libfvad，并更新底噪（快降/慢升）
                                noiseFloor = updateNoiseFloor(noiseFloor, rms)
                                updateVadState(false)
                            } else {
                                // 冷启动宽限期内，或能量够高：直喂 libfvad 精判
                                val isSpeech = nativeVadProcess(vadHandle, frame, frameLen) == 1
                                if (!isSpeech) {
                                    // libfvad 判 silence 才更新底噪（含能量上限保护）
                                    noiseFloor = updateNoiseFloor(noiseFloor, rms)
                                }
                                // 宽限期内抑制 speech 触发：floor 照常收敛，但不触发 onSpeechStart
                                updateVadState(if (inGrace) false else isSpeech)
                            }
                            offset += frameLen
                        }

                        // 若 speech 在本迭代内刚触发，pre-roll flush 已包含当前 buffer，
                        // 此处跳过 live emit 以避免重复
                        if (speechActive && !justStartedSpeech) {
                            val floatBuffer = buffer.take(read).map { it / 32768.0f }
                            sendEvent("onAudioBuffer", mapOf("samples" to floatBuffer))
                        }
                    }
                }
            }
        }
    }

    private fun stopRecording() {
        isRecording = false
        audioRecord?.stop()
        audioRecord?.release()
        audioRecord = null

        // 等待读线程退出，确保其不再于 nativeVadProcess 中使用已释放的 vadHandle
        readThread?.join(1000)
        readThread = null

        if (vadHandle != 0L) {
            nativeVadFree(vadHandle)
            vadHandle = 0L
        }
        speechActive = false
        speechStreak = 0
        silenceStreak = 0
        noiseFloor = floorInit
    }

    private fun initVad() {
        vadHandle = nativeVadCreate(sampleRate, 2)
        preRollCapacity = sampleRate * 300 / 1000
        graceFramesRemaining = 25 // 500ms / 20ms：冷启动宽限期，直喂 libfvad 收敛底噪
    }

    // Short PCM 归一化为 Float 后算 RMS（幅度域，与 iOS/TS 参考一致）
    private fun computeRms(frame: ShortArray): Float {
        if (frame.isEmpty()) return 0f
        var sum = 0.0
        for (s in frame) {
            val x = s / 32768.0f
            sum += (x * x).toDouble()
        }
        return kotlin.math.sqrt(sum / frame.size).toFloat()
    }

    // floor 只降不升 + 窗口满重校准（用窗口最低值，允许 floor 上升跟上环境变吵）
    private fun updateNoiseFloor(floor: Float, rms: Float): Float {
        val newFloor = maxOf(minOf(floor, rms), floorMin)
        recalibMin = minOf(recalibMin, rms)
        recalibCounter++
        if (recalibCounter >= recalibWindowFrames) {
            val recalibrated = maxOf(newFloor, recalibMin)
            recalibMin = Float.MAX_VALUE
            recalibCounter = 0
            return recalibrated
        }
        return newFloor
    }

    private fun updateVadState(isSpeech: Boolean) {
        if (isSpeech) {
            speechStreak++
            silenceStreak = 0
            if (!speechActive && speechStreak >= speechTriggerFrames) {
                speechActive = true
                justStartedSpeech = true
                if (preRoll.isNotEmpty()) {
                    sendEvent("onAudioBuffer", mapOf("samples" to preRoll.map { it / 32768.0f }))
                }
                sendEvent("onSpeechStart", emptyMap<String, Any>())
            }
        } else {
            silenceStreak++
            speechStreak = 0
            if (speechActive && silenceStreak >= silenceEndFrames) {
                speechActive = false
                sendEvent("onSpeechEnd", emptyMap<String, Any>())
            }
        }
    }
}
