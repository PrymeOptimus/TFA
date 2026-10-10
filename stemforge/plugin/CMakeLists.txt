cmake_minimum_required(VERSION 3.22)
project(StemForgePlugin VERSION 1.0.0 LANGUAGES C CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

option(STEMFORGE_BUILD_TESTS "Build the headless StemForgeTests runner" ON)

# JUCE: pass -DJUCE_DIR=/path/to/JUCE to use a local checkout, otherwise it is fetched.
if(DEFINED JUCE_DIR)
    add_subdirectory(${JUCE_DIR} juce)
else()
    include(FetchContent)
    FetchContent_Declare(juce
        GIT_REPOSITORY https://github.com/juce-framework/JUCE.git
        GIT_TAG 8.0.10
        GIT_SHALLOW TRUE)
    FetchContent_MakeAvailable(juce)
endif()

set(STEMFORGE_FORMATS VST3 Standalone)
if(APPLE)
    list(APPEND STEMFORGE_FORMATS AU)
endif()

juce_add_plugin(StemForge
    PRODUCT_NAME "StemForge"
    COMPANY_NAME "StemForge"
    BUNDLE_ID com.stemforge.plugin
    VERSION 1.0.0
    PLUGIN_MANUFACTURER_CODE Stfg
    PLUGIN_CODE Sfrg
    FORMATS ${STEMFORGE_FORMATS}
    # Instrument: loads on instrument tracks in every DAW (it generates audio, no input).
    IS_SYNTH TRUE
    NEEDS_MIDI_INPUT TRUE
    NEEDS_MIDI_OUTPUT FALSE
    IS_MIDI_EFFECT FALSE
    EDITOR_WANTS_KEYBOARD_FOCUS TRUE
    VST3_CATEGORIES Instrument Sampler
    AU_MAIN_TYPE kAudioUnitType_MusicDevice
    NEEDS_WEB_BROWSER TRUE
    NEEDS_WEBVIEW2 TRUE
    NEEDS_CURL TRUE
    COPY_PLUGIN_AFTER_BUILD FALSE)

set(STEMFORGE_CORE_SOURCES
    Source/StemPlayer.cpp
    Source/EngineClient.cpp
    Source/StemLoader.cpp
    Source/PluginProcessor.cpp)

target_sources(StemForge PRIVATE
    ${STEMFORGE_CORE_SOURCES}
    Source/PluginEditor.cpp
    Source/DragDock.cpp)

target_compile_definitions(StemForge PUBLIC
    JUCE_WEB_BROWSER=1
    JUCE_USE_CURL=1
    JUCE_VST3_CAN_REPLACE_VST2=0
    JUCE_STANDALONE_FILTER_WINDOW_USE_KIOSK_MODE=0)

if(WIN32)
    target_compile_definitions(StemForge PUBLIC JUCE_USE_WIN_WEBVIEW2_WITH_STATIC_LINKING=1)
endif()

target_link_libraries(StemForge
    PRIVATE
        juce::juce_audio_utils
        juce::juce_audio_formats
        juce::juce_gui_extra
    PUBLIC
        juce::juce_recommended_config_flags
        juce::juce_recommended_lto_flags
        juce::juce_recommended_warning_flags)

if(STEMFORGE_BUILD_TESTS)
    juce_add_console_app(StemForgeTests PRODUCT_NAME "StemForgeTests" NEEDS_CURL TRUE)
    target_sources(StemForgeTests PRIVATE Tests/PluginTests.cpp ${STEMFORGE_CORE_SOURCES})
    target_include_directories(StemForgeTests PRIVATE Source)
    target_compile_definitions(StemForgeTests PRIVATE
        STEMFORGE_HEADLESS=1
        JucePlugin_Name="StemForge"
        JucePlugin_VersionString="1.0.0"
        JUCE_USE_CURL=1
        JUCE_WEB_BROWSER=0
        JUCE_MODAL_LOOPS_PERMITTED=1)
    target_link_libraries(StemForgeTests PRIVATE
        juce::juce_audio_processors
        juce::juce_audio_formats
        juce::juce_recommended_config_flags
        juce::juce_recommended_warning_flags)
endif()
