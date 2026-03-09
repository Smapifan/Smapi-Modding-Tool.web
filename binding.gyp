{
  "targets": [
    {
      "target_name": "tbin_addon",
      "sources": [
        "src/native-addon.cc",
        "src/tbin_map_wrapper.cc"
      ],
      "include_dirs": [
        "<!@(node -p \"require('node-addon-api').include\")",
        "src/plugins/tbin",
        "src/plugins/tbin/tbin",
        "src/qt_stubs",
        "src"
      ],
      "defines": [
        "NAPI_DISABLE_CPP_EXCEPTIONS",
        "TBIN_STANDALONE"
      ],
      "cflags_cc": ["-std=c++17", "-fexceptions"],
      "cflags_cc!": ["-fno-exceptions"],
      "conditions": [
        ["OS=='win'", {
          "msvs_settings": {
            "VCCLCompilerTool": {
              "ExceptionHandling": 1,
              "AdditionalOptions": ["/std:c++17"]
            }
          }
        }],
        ["OS=='mac'", {
          "xcode_settings": {
            "GCC_ENABLE_CPP_EXCEPTIONS": "YES",
            "CLANG_CXX_LANGUAGE_STANDARD": "c++17",
            "MACOSX_DEPLOYMENT_TARGET": "11.0"
          }
        }],
        ["OS=='linux'", {
          "cflags_cc": ["-std=c++17", "-fexceptions"],
          "cflags_cc!": ["-fno-exceptions"]
        }]
      ]
    }
  ]
}
