#include <jni.h>
#include <stdint.h>
#include <stdlib.h>
#include "fvad.h"

/*
 * libfvad 的 JNI 桥接（Task 4）。
 *
 * JNI 函数名必须与 Kotlin 类
 *   expo.modules.microphonestream.MicrophoneStreamModule
 * 中 private external fun 声明一一对应：
 *   nativeVadCreate  -> Java_expo_modules_microphonestream_MicrophoneStreamModule_nativeVadCreate
 *   nativeVadProcess -> Java_expo_modules_microphonestream_MicrophoneStreamModule_nativeVadProcess
 *   nativeVadFree    -> Java_expo_modules_microphonestream_MicrophoneStreamModule_nativeVadFree
 */

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
