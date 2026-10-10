#pragma once

#include "EngineClient.h"
#include "StemLoader.h"
#include "StemPlayer.h"

#include <juce_audio_processors/juce_audio_processors.h>

namespace stemforge
{

/** A file the user can drag out of the plug-in into the DAW. */
struct DragFile
{
    juce::String id, label, path;
    int slot = -1;
};

class StemForgeProcessor : public juce::AudioProcessor,
                           public juce::ChangeBroadcaster,
                           private juce::Timer
{
public:
    StemForgeProcessor();
    ~StemForgeProcessor() override;

    // ---- AudioProcessor ----
    void prepareToPlay (double sampleRate, int samplesPerBlock) override;
    void releaseResources() override {}
    bool isBusesLayoutSupported (const BusesLayout&) const override;
    void processBlock (juce::AudioBuffer<float>&, juce::MidiBuffer&) override;

    juce::AudioProcessorEditor* createEditor() override;
    bool hasEditor() const override                    { return true; }
    const juce::String getName() const override        { return JucePlugin_Name; }
    bool acceptsMidi() const override                  { return true; }
    bool producesMidi() const override                 { return false; }
    double getTailLengthSeconds() const override       { return 0.0; }
    int getNumPrograms() override                      { return 1; }
    int getCurrentProgram() override                   { return 0; }
    void setCurrentProgram (int) override              {}
    const juce::String getProgramName (int) override   { return {}; }
    void changeProgramName (int, const juce::String&) override {}
    void getStateInformation (juce::MemoryBlock&) override;
    void setStateInformation (const void*, int) override;

    // ---- control surface (message thread) ----
    struct SyncSettings
    {
        bool hostSync = true;      // follow the DAW transport
        bool stretch = true;       // render stems at the DAW tempo
        double startBar = 1.0;     // song starts at this DAW bar
        double nudgeMs = 0.0;      // fine alignment against the grid
    };

    void loadTrack (const juce::String& trackId);
    void setLevels (const juce::var& levels);          // { stemId: gain }
    void setMaster (float g);
    void transport (const juce::var& cmd);             // { action: play|pause|stop|seek|loop, ... }
    void setSync (const juce::var& settings);
    void setUiState (const juce::String& json)         { uiState = json; }
    void addDragFile (const DragFile& f);

    juce::var sessionJson() const;
    juce::var stateJson() const;
    std::vector<DragFile> dragFiles() const;
    std::optional<DragFile> findDragFile (const juce::String& idOrPath) const;

    EngineClient& engineClient()                       { return *engine; }
    StemPlayer& getPlayer()                            { return player; }

private:
    static BusesProperties makeBuses();
    void timerCallback() override;                      // tempo follow
    void requestLoad (double bpm);
    void installTrack (std::unique_ptr<StemTrack>, int generation);
    void applySync();
    juce::var syncJson() const;

    // Must be declared before `loader`: the loader's callback takes a WeakReference to this
    // during member initialisation, which needs the weak-reference master to exist already.
    JUCE_DECLARE_WEAK_REFERENCEABLE (StemForgeProcessor)

    juce::SharedResourcePointer<EngineClient> engine;
    StemPlayer player;
    StemLoader loader;

    juce::String trackId, uiState;
    SyncSettings sync;
    std::array<float, kNumSlots> levels {};
    float master = 1.0f;
    int generation = 0;
    double pendingBpm = -1.0, failedBpm = -1.0;
    int stableTicks = 0;
    double lastRequestedBpm = 0.0;

    // Snapshot of the installed track for the UI (message thread only).
    juce::String loadedTrackId;
    double renderBpm = 0.0, originalBpm = 0.0, durationSec = 0.0;
    bool stretched = false;
    std::vector<DragFile> files, extraFiles;

    // Written by the audio thread, read by the UI.
    std::atomic<bool> hostValid { false }, hostPlaying { false };
    std::atomic<double> hostBpm { 0.0 }, hostPpq { 0.0 };
    std::atomic<double> currentRate { 44100.0 };

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR (StemForgeProcessor)
};

} // namespace stemforge
