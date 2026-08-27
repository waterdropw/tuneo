Pod::Spec.new do |s|
  s.name           = 'MicrophoneStream'
  s.version        = '1.0.0'
  s.summary        = 'A sample project summary'
  s.description    = 'A sample project description'
  s.author         = ''
  s.homepage       = 'https://docs.expo.dev/modules/'
  s.platforms      = {
    :ios => '15.1',
    :tvos => '15.1'
  }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  # Swift/Objective-C compatibility
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'HEADER_SEARCH_PATHS' => '"$(PODS_TARGET_SRCROOT)/libfvad/src" "$(PODS_TARGET_SRCROOT)/libfvad/include"',
  }

  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp,c}"

  # libfvad 内部头文件用「相对源目录」的 include（如 ../common.h），
  # 若作为 public header 会被 CocoaPods 拍平拷贝，导致相对 include 失效。
  # 只有 fvad.h（无相对 include）对外暴露，其余内部头保持 private。
  s.public_header_files = "libfvad/include/fvad.h"
  s.private_header_files = "libfvad/src/**/*.h"
end
