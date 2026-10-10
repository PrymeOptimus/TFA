#pragma once

#include "EngineClient.h"
#include "StemPlayer.h"

#include <juce_audio_formats/juce_audio_formats.h>

#include <functional>

namespace stemforge
{

/** Loads a track's stems on a background thread: asks the engine for (optionally
    tempo-stretched) renders, reads the WAVs and resamples them to the host rate. */
class StemLoader : private juce::Thread
{
public:
    struct Request
    {
        juce::String trackId;
        double bpm = 0.0;          // 0 = original tempo
        double sampleRate = 44100.0;
        int generation = 0;
    };

    enum class State { idle, rendering, loading, ready, error };

    using Callback = std::function<void (std::unique_ptr<StemTrack>, int generation)>;

    StemLoader (EngineClient& engine, Callback onLoaded);
    ~StemLoader() override;

    void request (Request r);      // newest request wins

    State state() const            { return st.load(); }
    juce::String message() const;
    juce::String stateName() const;

    /** Pure file loader, also used by the tests. */
    static std::unique_ptr<StemTrack> loadFiles (const juce::var& renderJson, const juce::String& trackId,
                                                 double hostRate, juce::String& error,
                                                 const std::function<bool()>& shouldAbort = {});

private:
    void run() override;
    void setState (State s, const juce::String& msg);

    EngineClient& engine;
    Callback onLoaded;
    juce::CriticalSection lock;
    std::optional<Request> pending;
    std::atomic<State> st { State::idle };
    juce::String msg;
};

} // namespace stemforge
