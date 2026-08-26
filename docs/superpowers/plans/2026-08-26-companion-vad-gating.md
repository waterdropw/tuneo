# 端侧 VAD 门控计费优化 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在原生层集成 libfvad 做人声检测，静音/噪音期间不发送音频流，并在安静 30 秒后重建会话，从而消除无效音频计费与上下文累积重复计费。

**Architecture:** 原生 `MicrophoneStreamModule` 集成 libfvad（C 库），VAD 状态机（silence→speech→silence）在原生层运行，只在检测到人声时 emit `onAudioBuffer`，并新增 `onSpeechStart`/`onSpeechEnd` 事件。JS 层 `OmniRealtimeService` 关闭服务端 VAD（`turn_detection: null`），改用 `commitAudioBuffer()` + `createResponse()` 控制轮次；`Companion` 在 30 秒无人声后断开重连。

**Tech Stack:** libfvad（BSD-3-Clause C 库）、Expo Module（Swift + Kotlin）、CMake + JNI（Android）、TypeScript。

## Global Constraints

- 不引入任何 npm 依赖；libfvad 以 C 源码 vendor 进 `modules/microphone-stream/`，保留其 `LICENSE` 文件。
- VAD 判定参数：触发人声开始 = 连续 3 帧（20ms/帧）判 speech；判定人声结束 = 连续非 speech 达 800ms；pre-roll 前置缓冲 300ms。
- 采样率：iOS 实际 48kHz（硬件格式），Android 16kHz。libfvad 均支持，两端帧长统一 20ms（iOS 960 samples/帧，Android 320 samples/帧）。
- 服务端 `turn_detection` 置为 `null`（关闭服务端 VAD）。
- 安静超时 30 秒后 `disconnect()` + 重连。
- VAD 不可用时回退为「始终 emit 音频」的旧行为，不崩溃。
- 本项目无测试运行器：JS 层用文档化断言（`.test.example.ts` 风格，`assert` 函数手写）；原生层只能靠构建 + 真机验证。
- 视频帧门控不在本次范围（保持现状）。

---

### Task 1: OmniRealtimeService 协议改动（turn_detection null + commit + createResponse）

**Files:**
- Modify: `src/services/OmniRealtimeService.ts`
- Modify: `src/services/OmniRealtimeService.test.example.ts`

**Interfaces:**
- Consumes: 现有 `send(message: any)` 私有方法（已存在）。
- Produces:
  - `commitAudioBuffer(): void` — 发送 `{ type: "input_audio_buffer.commit" }`
  - `createResponse(): void` — 发送 `{ type: "response.create" }`
  - `DEFAULT_OMNI_CONFIG.turnDetection` 改为 `null`

- [ ] **Step 1: 改 `DEFAULT_OMNI_CONFIG.turnDetection` 为 null**

把 `src/services/OmniRealtimeService.ts` 里 `DEFAULT_OMNI_CONFIG` 的
```ts
  turnDetection: {
    type: "server_vad",
    threshold: 0.5,
    silenceDurationMs: 800,
  },
```
改为
```ts
  turnDetection: null,
```

- [ ] **Step 2: 加 `commitAudioBuffer` 和 `createResponse` 方法**

在 `cancelResponse()` 方法（`OmniRealtimeService.ts` 约 199 行）之后新增：
```ts
  // 提交输入音频缓冲，通知服务端「这轮人声已结束，请处理」（端侧 VAD 接管轮次时使用）
  commitAudioBuffer(): void {
    this.send({ type: "input_audio_buffer.commit" })
  }

  // 请求服务端生成回复（配合 commit 使用；服务端 VAD 关闭后需显式触发）
  createResponse(): void {
    this.send({ type: "response.create" })
  }
```

- [ ] **Step 3: 更新文档化断言**

把 `src/services/OmniRealtimeService.test.example.ts` 里 config 的
```ts
  turnDetection: { type: "server_vad", threshold: 0.5, silenceDurationMs: 800 },
```
改为
```ts
  turnDetection: null,
```

并把第 48 行断言
```ts
assert(update.session.turn_detection.type === "server_vad", "vad type")
assert(update.session.turn_detection.silence_duration_ms === 800, "silence duration")
```
替换为
```ts
assert(update.session.turn_detection === null, "turn_detection disabled (端侧 VAD 接管)")
```

在文件末尾 `console.log(...)` 之前新增：
```ts
// commitAudioBuffer / createResponse 消息构造
;(service as any).send = (m: any) => sock.sent.push(JSON.stringify(m))
service.commitAudioBuffer()
assert(JSON.parse(sock.sent[sock.sent.length - 1]).type === "input_audio_buffer.commit", "commit type")

service.createResponse()
assert(JSON.parse(sock.sent[sock.sent.length - 1]).type === "response.create", "createResponse type")
```

- [ ] **Step 4: 验证**

Run: `npx eslint src/services/OmniRealtimeService.ts src/services/OmniRealtimeService.test.example.ts`
Expected: 无 error。

Run: `npx tsx src/services/OmniRealtimeService.test.example.ts`（若项目无 tsx，改用 `npx tsc --noEmit` 仅做类型检查）
Expected: 类型检查通过；断言文件在 Node 下运行输出 `OmniRealtimeService example assertions passed`（如无法运行，以 eslint + tsc 通过为准）。

- [ ] **Step 5: Commit**

```bash
git add src/services/OmniRealtimeService.ts src/services/OmniRealtimeService.test.example.ts
git commit -m "feat: Omni 关闭服务端 VAD，新增 commit 与 response.create"
```

---

### Task 2: vendor libfvad C 源码 + 双端构建配置

**Files:**
- Create: `modules/microphone-stream/cpp/libfvad/`（整个目录，vendor 自 libfvad）
- Create: `modules/microphone-stream/cpp/CMakeLists.txt`
- Modify: `modules/microphone-stream/ios/MicrophoneStream.podspec`
- Modify: `modules/microphone-stream/android/build.gradle`

**Interfaces:**
- Consumes: 无（纯构建配置）
- Produces: libfvad 的 C 符号 `fvad_new` / `fvad_set_sample_rate` / `fvad_set_mode` / `fvad_process` / `fvad_reset` / `fvad_free` 对 iOS（经 bridging header）与 Android（经 JNI）可见。

- [ ] **Step 1: vendor libfvad 源码**

Run（在仓库根目录）:
```bash
rm -rf /tmp/libfvad && git clone --depth 1 https://github.com/dpirch/libfvad.git /tmp/libfvad
mkdir -p modules/microphone-stream/cpp/libfvad
cp -r /tmp/libfvad/include modules/microphone-stream/cpp/libfvad/include
cp -r /tmp/libfvad/src modules/microphone-stream/cpp/libfvad/src
cp /tmp/libfvad/LICENSE modules/microphone-stream/cpp/libfvad/LICENSE
```
Expected: `modules/microphone-stream/cpp/libfvad/` 下出现 `include/fvad.h`、`src/*.c`、`src/vad/*.c`、`src/signal_processing/*.c` 与 `LICENSE`。

- [ ] **Step 2: iOS podspec 加入 libfvad 源文件与头文件搜索路径**

把 `modules/microphone-stream/ios/MicrophoneStream.podspec` 的
```ruby
  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
```
改为
```ruby
  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp,c}"
  s.header_mappings_dir = "../cpp/libfvad/include"
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'HEADER_SEARCH_PATHS' => '"$(PODS_TARGET_SRCROOT)/../cpp/libfvad/include"',
  }
```

- [ ] **Step 3: iOS bridging header 暴露 fvad.h**

把 `ios/tuneo/tuneo-Bridging-Header.h` 内容替换为：
```objc
#import "fvad.h"
```
> 说明：该 bridging header 属于主 app target，而 libfvad 编进 `MicrophoneStream` pod。若 Swift 无法从 pod 内直接 `import` 到 `fvad.h`，改在 `MicrophoneStreamModule.swift` 顶部用 `@_silgen_name` 声明所需 C 函数（见 Task 3 Step 1 备选）。本步骤先按 bridging header 方案落地，构建失败时切换。

- [ ] **Step 4: Android CMakeLists 编译 libfvad**

创建 `modules/microphone-stream/cpp/CMakeLists.txt`：
```cmake
cmake_minimum_required(VERSION 3.18)
project(microphonestream_vad C)

set(FVAD_DIR ${CMAKE_CURRENT_SOURCE_DIR}/libfvad)

add_library(fvad STATIC
  ${FVAD_DIR}/src/fvad.c
  ${FVAD_DIR}/src/vad/vad_core.c
  ${FVAD_DIR}/src/vad/vad_filterbank.c
  ${FVAD_DIR}/src/vad/vad_gmm.c
  ${FVAD_DIR}/src/vad/vad_sp.c
  ${FVAD_DIR}/src/vad/webrtc_vad.c
  ${FVAD_DIR}/src/signal_processing/division_operations.c
  ${FVAD_DIR}/src/signal_processing/energy.c
  ${FVAD_DIR}/src/signal_processing/get_scaling_square.c
  ${FVAD_DIR}/src/signal_processing/resample_48khz.c
  ${FVAD_DIR}/src/signal_processing/resample_by_2_internal.c
  ${FVAD_DIR}/src/signal_processing/spl_init.c
  ${FVAD_DIR}/src/signal_processing/spl_sqrt.c
)

target_include_directories(fvad PUBLIC
  ${FVAD_DIR}/include
  ${FVAD_DIR}/src
)
```

> 注意：libfvad 实际源文件清单以 clone 下来的 `src/` 为准。若上述列出的某文件不存在，按实际 `src/**/*.c` 补全或删减（`fvad.c`、`vad/*.c`、`signal_processing/*.c` 全部需要）。构建报缺文件时照此修正。

- [ ] **Step 5: Android build.gradle 接入 CMake 与 JNI**

在 `modules/microphone-stream/android/build.gradle` 的 `android { }` 块内（`lintOptions` 之后）新增：
```gradle
    externalNativeBuild {
        cmake {
            path file('src/main/jni/CMakeLists.txt')
        }
    }
    sourceSets {
        main {
            jniLibs.srcDirs = []
        }
    }
```
创建 `modules/microphone-stream/android/src/main/jni/CMakeLists.txt`：
```cmake
cmake_minimum_required(VERSION 3.18)
project(microphonestream)

add_subdirectory(${CMAKE_CURRENT_LIST_DIR}/../../../cpp cpp_build)

add_library(microphonestream-jni SHARED microphonestream_jni.c)
target_include_directories(microphonestream-jni PRIVATE
  ${CMAKE_CURRENT_LIST_DIR}/../../../cpp/libfvad/include
)
target_link_libraries(microphonestream-jni fvad)
```
> 路径 `${CMAKE_CURRENT_LIST_DIR}/../../../cpp` 从 `android/src/main/jni/` 上溯到 `modules/microphone-stream/cpp`。创建 `microphonestream_jni.c` 的占位（真正实现放 Task 4）：
```c
#include <jni.h>
// JNI 实现在 Task 4 补充
JNIEXPORT jint JNICALL JNI_OnLoad(JavaVM *vm, void *reserved) { return JNI_VERSION_1_6; }
```

- [ ] **Step 6: 验证 iOS 构建（可选，慢）**

Run: `cd ios && pod install`
Expected: pod 安装成功，无 fvad 相关报错。

- [ ] **Step 7: Commit**

```bash
git add modules/microphone-stream/cpp modules/microphone-stream/ios/MicrophoneStream.podspec modules/microphone-stream/android/build.gradle modules/microphone-stream/android/src/main/jni ios/tuneo/tuneo-Bridging-Header.h
git commit -m "build: vendor libfvad 并接入 iOS/Android 构建"
```

---

### Task 3: iOS 原生 VAD 门控 + 事件

**Files:**
- Modify: `modules/microphone-stream/ios/MicrophoneStreamModule.swift`

**Interfaces:**
- Consumes: libfvad C 函数（Task 2）；现有 `sendEvent` 机制。
- Produces: 事件 `onSpeechStart`、`onSpeechEnd`；`onAudioBuffer` 仅在 speech 期间 emit。

- [ ] **Step 1: 声明 libfvad 函数并加状态字段**

在 `MicrophoneStreamModule.swift` 顶部（`import` 之后）新增 C 函数声明与常量：
```swift
// libfvad C 接口（bridging header 导入 fvad.h；若走 @_silgen_name 则逐条声明）
private let VAD_FRAME_MS = 20
private let SPEECH_TRIGGER_FRAMES = 3
private let SILENCE_END_FRAMES = 40   // 800ms / 20ms
private let PRE_ROLL_SAMPLES: Int = 0 // 在下方按采样率初始化
```

在类内新增状态字段（`audioBufferHandler` 之后）：
```swift
  private var vad: OpaquePointer? = nil
  private var sampleRateForVad = 48000
  private var speechActive = false
  private var speechStreak = 0
  private var silenceStreak = 0
  private var preRoll: [Float] = []
  private var preRollCapacity = 0
```

- [ ] **Step 2: VAD 初始化与帧处理函数**

在 `MicrophoneStreamModule` 类内新增两个私有方法：
```swift
  private func initVad() {
    vad = fvad_new()
    guard let v = vad else { return }
    fvad_set_sample_rate(v, Int32(sampleRateForVad))
    fvad_set_mode(v, 2) // 2 = 中等激进度
    preRollCapacity = sampleRateForVad * 300 / 1000 // 300ms
    preRoll = Array(repeating: 0, count: preRollCapacity)
  }

  // 将一段 Float 样本切帧喂 VAD；返回 true 表示该帧判为 speech
  private func processVadFrames(_ samples: [Float]) {
    guard let v = vad else { return }
    let frameLen = sampleRateForVad * VAD_FRAME_MS / 1000
    var offset = 0
    while offset + frameLen <= samples.count {
      let frame = Array(samples[offset..<(offset + frameLen)])
      let isSpeech = fvad_process(v, frame, frameLen) == 1
      updateVadState(isSpeech: isSpeech)
      offset += frameLen
    }
  }

  private func updateVadState(isSpeech: Bool) {
    if isSpeech {
      speechStreak += 1
      silenceStreak = 0
      if !speechActive && speechStreak >= SPEECH_TRIGGER_FRAMES {
        speechActive = true
        // flush pre-roll 缓冲
        if !preRoll.isEmpty {
          sendEvent("onAudioBuffer", ["samples": preRoll])
        }
        sendEvent("onSpeechStart", [:])
      }
    } else {
      silenceStreak += 1
      speechStreak = 0
      if speechActive && silenceStreak >= SILENCE_END_FRAMES {
        speechActive = false
        sendEvent("onSpeechEnd", [:])
      }
    }
  }
```

- [ ] **Step 3: 接入 tap 回调**

把 `startRecording` 里 `installTap` 的闭包体
```swift
                      guard let channelData = buffer.floatChannelData else { return }
                      let frameLength = Int(buffer.frameLength)
                      let samples = Array(UnsafeBufferPointer(start: channelData[0], count: frameLength))
                      self.sendEvent("onAudioBuffer", [
                        "samples": samples
                      ])
```
改为
```swift
                      guard let channelData = buffer.floatChannelData else { return }
                      let frameLength = Int(buffer.frameLength)
                      let samples = Array(UnsafeBufferPointer(start: channelData[0], count: frameLength))

                      if self.vad == nil {
                        // VAD 不可用：回退为始终 emit（旧行为）
                        self.sendEvent("onAudioBuffer", ["samples": samples])
                        return
                      }

                      // 维护 pre-roll 环形缓冲（保留最近 300ms）
                      if self.preRollCapacity > 0 {
                        if samples.count >= self.preRollCapacity {
                          self.preRoll = samples
                        } else {
                          self.preRoll.removeFirst(samples.count)
                          self.preRoll.append(contentsOf: samples)
                        }
                      }

                      self.processVadFrames(samples)

                      if self.speechActive {
                        self.sendEvent("onAudioBuffer", ["samples": samples])
                      }
```
并在 `startRecording` 里、`audioEngine.start()` 之前调用 `self.initVad()`。

- [ ] **Step 4: stopRecording 释放 VAD**

在 `stopRecording()` 里，`audioEngine.stop()` 之后新增：
```swift
    if let v = vad {
      fvad_free(v)
      vad = nil
    }
    speechActive = false
    speechStreak = 0
    silenceStreak = 0
```

- [ ] **Step 5: 定义新事件**

把 `definition()` 里的
```swift
    Events("onAudioBuffer")
```
改为
```swift
    Events("onAudioBuffer", "onSpeechStart", "onSpeechEnd")
```

- [ ] **Step 6: 验证编译**

Run: `cd ios && xcodebuild -workspace tuneo.xcworkspace -scheme tuneo -configuration Debug -sdk iphonesimulator -quiet 2>&1 | tail -40`
Expected: 编译通过（或有明确的 fvad 符号/类型错误需修正）。真机 VAD 行为验证留到 Task 5 完成后统一做。

- [ ] **Step 7: Commit**

```bash
git add modules/microphone-stream/ios/MicrophoneStreamModule.swift
git commit -m "feat: iOS 端侧 VAD 门控与 speech 事件"
```

---

### Task 4: Android 原生 VAD 门控 + 事件

**Files:**
- Modify: `modules/microphone-stream/android/src/main/jni/microphonestream_jni.c`
- Modify: `modules/microphone-stream/android/src/main/java/expo/modules/microphonestream/MicrophoneStreamModule.kt`

**Interfaces:**
- Consumes: libfvad（Task 2）；现有 `sendEvent` 机制。
- Produces: 事件 `onSpeechStart`、`onSpeechEnd`；`onAudioBuffer` 仅在 speech 期间 emit。JNI 函数 `Java_expo_modules_microphonestream_MicrophoneStreamModule_nativeVadProcess` 等（见下）。

- [ ] **Step 1: 写 JNI 桥接**

把 `microphonestream_jni.c` 内容替换为：
```c
#include <jni.h>
#include <stdint.h>
#include <stdlib.h>
#include "fvad.h"

JNIEXPORT jlong JNICALL
Java_expo_modules_microphonestream_MicrophoneStreamModule_nativeVadCreate(
    JNIEnv *env, jobject thiz, jint sampleRate, jint mode) {
  Fvad *v = fvad_new();
  if (!v) return 0;
  fvad_set_sample_rate(v, sampleRate);
  fvad_set_mode(v, mode);
  return (jlong)(intptr_t)v;
}

JNIEXPORT jint JNICALL
Java_expo_modules_microphonestream_MicrophoneStreamModule_nativeVadProcess(
    JNIEnv *env, jobject thiz, jlong handle, jshortArray frame, jint length) {
  Fvad *v = (Fvad *)(intptr_t)handle;
  if (!v) return -1;
  jshort *buf = (*env)->GetShortArrayElements(env, frame, NULL);
  int r = fvad_process(v, buf, length);
  (*env)->ReleaseShortArrayElements(env, frame, buf, JNI_ABORT);
  return r;
}

JNIEXPORT void JNICALL
Java_expo_modules_microphonestream_MicrophoneStreamModule_nativeVadFree(
    JNIEnv *env, jobject thiz, jlong handle) {
  if (handle) fvad_free((Fvad *)(intptr_t)handle);
}
```

- [ ] **Step 2: Kotlin 声明 native 方法并加状态字段**

在 `MicrophoneStreamModule.kt` 类内（`audioRecord` 等字段之后）新增：
```kotlin
    private external fun nativeVadCreate(sampleRate: Int, mode: Int): Long
    private external fun nativeVadProcess(handle: Long, frame: ShortArray, length: Int): Int
    private external fun nativeVadFree(handle: Long)

    private var vadHandle = 0L
    private val vadFrameMs = 20
    private val speechTriggerFrames = 3
    private val silenceEndFrames = 40
    private var speechActive = false
    private var speechStreak = 0
    private var silenceStreak = 0
    private val preRoll = ArrayDeque<Short>()
    private var preRollCapacity = 0
```

- [ ] **Step 3: VAD 状态机与门控**

在 `MicrophoneStreamModule.kt` 内新增方法：
```kotlin
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
```

- [ ] **Step 4: 接入读循环**

把 `startRecording()` 里读循环的
```kotlin
                if (read > 0) {
                    val floatBuffer = buffer.map { it / 32768.0f }
                    sendEvent("onAudioBuffer", mapOf("samples" to floatBuffer))
                }
```
改为
```kotlin
                if (read > 0) {
                    if (vadHandle == 0L) {
                        val floatBuffer = buffer.map { it / 32768.0f }
                        sendEvent("onAudioBuffer", mapOf("samples" to floatBuffer))
                    } else {
                        // pre-roll 环形缓冲
                        if (preRollCapacity > 0) {
                            if (read >= preRollCapacity) {
                                preRoll.clear()
                                preRoll.addAll(buffer.take(read))
                            } else {
                                repeat(read) { if (preRoll.size >= preRollCapacity) preRoll.removeFirst() }
                                preRoll.addAll(buffer.take(read))
                            }
                        }
                        val frameLen = sampleRate * vadFrameMs / 1000
                        var offset = 0
                        while (offset + frameLen <= read) {
                            val frame = buffer.copyOfRange(offset, offset + frameLen)
                            updateVadState(nativeVadProcess(vadHandle, frame, frameLen) == 1)
                            offset += frameLen
                        }
                        if (speechActive) {
                            val floatBuffer = buffer.take(read).map { it / 32768.0f }
                            sendEvent("onAudioBuffer", mapOf("samples" to floatBuffer))
                        }
                    }
                }
```
并在 `startRecording()` 里 `audioRecord?.startRecording()` 之后调用 `initVad()`。

- [ ] **Step 5: stopRecording 释放 VAD**

在 `stopRecording()` 里 `audioRecord = null` 之后新增：
```kotlin
        if (vadHandle != 0L) {
            nativeVadFree(vadHandle)
            vadHandle = 0L
        }
        speechActive = false
        speechStreak = 0
        silenceStreak = 0
```

- [ ] **Step 6: 定义新事件**

把 `definition()` 里的
```kotlin
        Events("onAudioBuffer")
```
改为
```kotlin
        Events("onAudioBuffer", "onSpeechStart", "onSpeechEnd")
```

- [ ] **Step 7: 验证编译**

Run: `cd android && ./gradlew :modules:microphone-stream:assembleDebug 2>&1 | tail -40`（若 module 任务名不同，用 `./gradlew :microphone-stream:assembleDebug` 或 `./gradlew assembleDebug`）
Expected: 编译通过（或有明确的 fvad/JNI 错误需修正）。

- [ ] **Step 8: Commit**

```bash
git add modules/microphone-stream/android
git commit -m "feat: Android 端侧 VAD 门控与 speech 事件"
```

---

### Task 5: TS 事件类型 + AudioSource 转发 + Companion 接线

**Files:**
- Modify: `modules/microphone-stream/src/MicrophoneStreamModule.ts`
- Modify: `src/services/AudioSource.ts`
- Modify: `src/navigation/screens/Companion.tsx`

**Interfaces:**
- Consumes: 原生事件 `onSpeechStart` / `onSpeechEnd`（Task 3/4）；`OmniRealtimeService.commitAudioBuffer()` / `createResponse()`（Task 1）。
- Produces: `AudioSource.startProcessing(callback)` 保持旧签名不变；新增 `AudioSource.startProcessingWithSpeech(cb, onSpeechStart, onSpeechEnd)` 或等价回调注册（见下）。

- [ ] **Step 1: 声明原生事件类型**

把 `modules/microphone-stream/src/MicrophoneStreamModule.ts` 的
```ts
export type MicrophoneStreamModuleEvents = {
  onAudioBuffer: (params: AudioBuffer) => void
}
```
改为
```ts
export type MicrophoneStreamModuleEvents = {
  onAudioBuffer: (params: AudioBuffer) => void
  onSpeechStart: () => void
  onSpeechEnd: () => void
}
```

- [ ] **Step 2: AudioSource 转发 speech 事件**

在 `src/services/AudioSource.ts` 中新增回调字段（`audioBufferHandler` 之后）：
```ts
  private speechStartHandler: (() => void) | null = null;
  private speechEndHandler: (() => void) | null = null;
```
新增方法：
```ts
  public setSpeechCallbacks(onStart: () => void, onEnd: () => void): void {
    this.speechStartHandler = onStart;
    this.speechEndHandler = onEnd;
  }
```
在 `startProcessing` 的 `MicrophoneStreamModule.addListener("onAudioBuffer", ...)` 之后新增两个监听：
```ts
    MicrophoneStreamModule.addListener("onSpeechStart", () => {
      this.speechStartHandler?.();
    });
    MicrophoneStreamModule.addListener("onSpeechEnd", () => {
      this.speechEndHandler?.();
    });
```
在 `stopProcessing` 里清空：
```ts
    this.speechStartHandler = null;
    this.speechEndHandler = null;
```

- [ ] **Step 3: Companion 接入 speech 事件**

在 `src/navigation/screens/Companion.tsx` 的 `handleStart` 里，`audioSource.startProcessing(...)` 之前新增：
```tsx
      audioSource.setSpeechCallbacks(
        () => {
          // 孩子开口：打断进行中的回复
          service.cancelResponse()
          playerRef.current?.stop()
          playerRef.current?.reset()
          setStatus("listening")
          statusRef.current = "listening"
        },
        () => {
          // 人声结束：提交并触发回复
          try {
            service.commitAudioBuffer()
            service.createResponse()
          } catch (e) {
            console.warn("[companion] commit/createResponse failed", e)
          }
        }
      )
```

- [ ] **Step 4: Companion 30 秒静音重建会话**

在 `Companion.tsx` 组件内新增 ref 与 effect（在现有 `handleEvent` 附近）：
```tsx
  const lastSpeechEndRef = useRef<number>(0)
  const rebuildTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
```
在 `handleStart` 里、`audioSource.startProcessing(...)` 之后新增定时器启动：
```tsx
      const armRebuild = () => {
        if (rebuildTimerRef.current) clearTimeout(rebuildTimerRef.current)
        rebuildTimerRef.current = setTimeout(async () => {
          const now = Date.now()
          if (statusRef.current !== "idle" && now - lastSpeechEndRef.current >= 30000) {
            console.log("[companion] 30s silence, rebuilding session")
            await service.disconnect()
            await service.connect()
          }
        }, 30000)
      }
      lastSpeechEndRef.current = Date.now()
      armRebuild()
```
并在 speech 回调里更新 `lastSpeechEndRef`：把 Step 3 的 `onSpeechStart` 回调第一行加 `lastSpeechEndRef.current = 0`（表示有新语音），`onSpeechEnd` 回调里加 `lastSpeechEndRef.current = Date.now()` 与 `armRebuild()`。

> 注：`armRebuild` 需在 `handleStart` 作用域内定义并供两个回调与定时器闭包引用。若回调闭包捕获问题导致 `armRebuild` 不可见，将其提升为组件内 `useRef` 函数或组件级函数（把 `service`/`player` 通过 ref 访问）。实现时保证编译通过即可，逻辑以「30s 无 onSpeechEnd 之后重连」为准。

- [ ] **Step 5: 清理定时器**

在 `teardown()` 里新增：
```tsx
    if (rebuildTimerRef.current) {
      clearTimeout(rebuildTimerRef.current)
      rebuildTimerRef.current = null
    }
```

- [ ] **Step 6: lint**

Run: `npx eslint src/navigation/screens/Companion.tsx src/services/AudioSource.ts modules/microphone-stream/src/MicrophoneStreamModule.ts`
Expected: 无 error。

- [ ] **Step 7: 真机验证清单（记录到 report）**

真机（iOS 或 Android）：
1. 连接成功后静音对着麦克风 → 观察日志应**没有** `SEND input_audio_buffer.append`（静音不发）
2. 说话 → 出现 `onSpeechStart` 日志 + `SEND input_audio_buffer.append`
3. 停口 800ms → `onSpeechEnd` + `SEND input_audio_buffer.commit` + `SEND response.create`，AI 回复
4. 静置 30s → 日志出现「30s silence, rebuilding session」，随后重连成功
5. AI 回复过程中说话 → 回复被打断（barge-in）

- [ ] **Step 8: Commit**

```bash
git add modules/microphone-stream/src/MicrophoneStreamModule.ts src/services/AudioSource.ts src/navigation/screens/Companion.tsx
git commit -m "feat: 端侧 VAD 门控接线与 30s 会话重建"
```
