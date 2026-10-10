#pragma once

#include <juce_audio_basics/juce_audio_basics.h>

#include <array>
#include <atomic>
#include <memory>
#include <vector>

namespace stemforge
{

// Fixed stem slots (same ids and order as backend/stemforge/stems.py). Each slot has
// its own gain and its own optional stereo output bus.
inline constexpr std::array<const char*, 12> kStemIds {
    "vocals", "drums", "percussion", "bass", "guitar", "guitar_electric",
    "guitar_acoustic", "piano", "synth", "organ", "aux", "residual"
};
inline constexpr std::array<const char*, 12> kStemLabels {
    "Vocals", "Drums", "Percussion", "Bass", "Guitar", "Guitar Electric",
    "Guitar Acoustic", "Piano-Keys", "Synth", "Organ", "Auxiliary", "Residual"
};
inline constexpr int kNumSlots = (int) kStemIds.size();

int slotForId (const juce::String& id);

/** Stems loaded into memory at the host sample rate. Immutable once handed to the player. */
struct StemTrack
{
    struct Lane
    {
        int slot = -1;
        juce::String id, label, path, fileName;
        juce::AudioBuffer<float> audio; // stereo
    };

    juce::String trackId, title;
    std::vector<Lane> lanes;
    double sampleRate = 44100.0;
    juce::int64 length = 0;          // samples
    double renderBpm = 0.0;          // tempo the buffers play at (stretched or original)
    double originalBpm = 0.0;
    double gridOffsetSec = 0.0;      // first beat of the song's grid, at renderBpm
    bool stretched = false;

    double durationSec() const { return sampleRate > 0 ? (double) length / sampleRate : 0.0; }
};

/** What the host's playhead said for the current block. */
struct HostInfo
{
    bool valid = false;
    bool playing = false;
    bool hasPpq = false;
    double bpm = 120.0;
    double ppq = 0.0;
    double timeSec = 0.0;
};

/**
    Real-time multitrack player.

    Message thread: swapTrack(), transport/gain/sync setters.
    Audio thread:   process().
    The audio thread never allocates, locks (only try-locks) or frees a track.
*/
class StemPlayer
{
public:
    StemPlayer();

    void prepare (double sampleRate, int maxBlockSize);

    /** Installs a new track and returns the previous one, which the caller must
        destroy on a non-audio thread. Musical position and loop points are kept
        when the tempo of the buffers changes. */
    std::unique_ptr<StemTrack> swapTrack (std::unique_ptr<StemTrack> next);

    // ---- transport (internal mode) ----
    void play()                         { playRequested.store (true); }
    void pause()                        { playRequested.store (false); }
    void stop()                         { playRequested.store (false); seekTo (0.0); }
    void seekTo (double seconds)        { seekRequestSec.store (juce::jmax (0.0, seconds)); }
    void setLoop (bool on, double startSec, double endSec);

    // ---- mix ----
    void setSlotGain (int slot, float gain);
    void setMasterGain (float g)        { masterGain.store (g); }

    // ---- host sync ----
    void setHostSync (bool on)          { hostSync.store (on); }
    /** startBar is 1-based (bar 1 = ppq 0). nudgeSec shifts the song against the grid. */
    void setSyncPlacement (double startBar, double nudgeSec, int beatsPerBar = 4);

    // ---- audio thread ----
    /** main: main output bus. stemOuts[slot]: that slot's own output bus or nullptr.
        A slot routed to its own bus is removed from the main mix. */
    void process (juce::AudioBuffer<float>& main,
                  const std::array<juce::AudioBuffer<float>*, kNumSlots>& stemOuts,
                  const HostInfo& host);

    // ---- state for the UI (any thread) ----
    double getPositionSec() const       { return positionSec.load(); }
    bool isPlaying() const              { return playingNow.load(); }
    bool isHostSync() const             { return hostSync.load(); }
    double getLoopStartSec() const      { return loopStartSec.load(); }
    double getLoopEndSec() const        { return loopEndSec.load(); }
    bool isLoopOn() const               { return loopOn.load(); }
    float getSlotGain (int slot) const  { return gains[(size_t) slot].load(); }

private:
    juce::int64 wrapLoop (juce::int64 pos, juce::int64 loopS, juce::int64 loopE, bool on) const;

    juce::SpinLock trackLock;
    std::unique_ptr<StemTrack> track;

    double sampleRate = 44100.0;
    std::vector<juce::int64> indexScratch;

    std::array<std::atomic<float>, kNumSlots> gains;
    std::array<juce::LinearSmoothedValue<float>, kNumSlots> smoothers;
    juce::LinearSmoothedValue<float> masterSmoother;
    std::atomic<float> masterGain { 1.0f };

    std::atomic<bool> playRequested { false }, playingNow { false }, hostSync { false };
    std::atomic<double> seekRequestSec { -1.0 }, positionSec { 0.0 };
    std::atomic<bool> loopOn { false };
    std::atomic<double> loopStartSec { 0.0 }, loopEndSec { 0.0 };
    std::atomic<double> startPpq { 0.0 }, nudgeSec { 0.0 };

    juce::int64 pos = 0;              // audio-thread playhead, samples
    bool wasHostPlaying = false;
};

} // namespace stemforge
