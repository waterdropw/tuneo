cmake_minimum_required(VERSION 3.18)
project(microphonestream_vad C)

set(FVAD_DIR ${CMAKE_CURRENT_SOURCE_DIR}/libfvad)

add_library(fvad STATIC
  ${FVAD_DIR}/src/fvad.c
  ${FVAD_DIR}/src/vad/vad_core.c
  ${FVAD_DIR}/src/vad/vad_filterbank.c
  ${FVAD_DIR}/src/vad/vad_gmm.c
  ${FVAD_DIR}/src/vad/vad_sp.c
  ${FVAD_DIR}/src/signal_processing/division_operations.c
  ${FVAD_DIR}/src/signal_processing/energy.c
  ${FVAD_DIR}/src/signal_processing/get_scaling_square.c
  ${FVAD_DIR}/src/signal_processing/resample_48khz.c
  ${FVAD_DIR}/src/signal_processing/resample_by_2_internal.c
  ${FVAD_DIR}/src/signal_processing/resample_fractional.c
  ${FVAD_DIR}/src/signal_processing/spl_inl.c
)

target_include_directories(fvad PUBLIC
  ${FVAD_DIR}/include
  ${FVAD_DIR}/src
)
