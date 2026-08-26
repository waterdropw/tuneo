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
    private var isRecording = false
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

    private var vadHandle = 0L
    private val vadFrameMs = 20
    private val speechTriggerFrames = 3
    private val silenceEndFrames = 40
    private var speechActive = false
    private var justStartedSpeech = false
    private var speechStreak = 0
    private var silenceStreak = 0
    private val preRoll = ArrayDeque<Short>()
    private var preRollCapacity = 0

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

        thread {
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
                            updateVadState(nativeVadProcess(vadHandle, frame, frameLen) == 1)
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

        if (vadHandle != 0L) {
            nativeVadFree(vadHandle)
            vadHandle = 0L
        }
        speechActive = false
        speechStreak = 0
        silenceStreak = 0
    }

    private fun initVad() {
        vadHandle = nativeVadCreate(sampleRate, 2)
        preRollCapacity = sampleRate * 300 / 1000
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
