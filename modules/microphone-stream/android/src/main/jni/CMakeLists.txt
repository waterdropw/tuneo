cmake_minimum_required(VERSION 3.18)
project(microphonestream)

add_subdirectory(${CMAKE_CURRENT_LIST_DIR}/../../../../cpp cpp_build)

add_library(microphonestream-jni SHARED microphonestream_jni.c)
target_include_directories(microphonestream-jni PRIVATE
  ${CMAKE_CURRENT_LIST_DIR}/../../../../cpp/libfvad/include
)
target_link_libraries(microphonestream-jni fvad)
