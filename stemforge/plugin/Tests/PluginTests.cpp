// Headless tests for the StemForge plug-in core.
//
//   StemForgeTests                         unit tests (player, sync maths, routing, loader)
//   StemForgeTests --engine URL --track ID integration test against a running engine:
//                                          loads the track into a real processor driven by a
//                                          fake DAW playhead and checks tempo-synced rendering,
//                                          tempo following and session recall.

#include "PluginProcessor.h"
#include "StemLoader.h"
#include "StemPlayer.h"

#include <juce_audio_formats/juce_audio_formats.h>
#include <juce_events/juce_events.h>

using namespace stemforge;

namespace
{
constexpr double kRate = 48000.0;
constexpr int kBlock = 512;

/** Lane 0 (vocals) is a unique ramp so each output sample reveals which source index played.
    Lane 1 (drums) is a constant 0.25. */
std::unique_ptr<StemTrack> makeTrack (double seconds, double bpm, const juce::String& id = "t1")
{
    auto t = std::make_unique<StemTrack>();
    t->trackId = id;
    t->sampleRate = kRate;
    t->length = (juce::int64) (seconds * kRate);
    t->renderBpm = t->originalBpm = bpm;

    StemTrack::Lane ramp, flat;
    ramp.slot = slotForId ("vocals"); ramp.id = "vocals";
    flat.slot = slotForId ("drums");  flat.id = "drums";
    ramp.audio.setSize (2, (int) t->length);
    flat.audio.setSize (2, (int) t->length);
    for (int ch = 0; ch < 2; ++ch)
        for (int i = 0; i < (int) t->length; ++i)
        {
            ramp.audio.setSample (ch, i, (float) i / (float) t->length);
            flat.audio.setSample (ch, i, 0.25f);
        }
    t->lanes.push_back (std::move (ramp));
    t->lanes.push_back (std::move (flat));
    return t;
}

std::array<juce::AudioBuffer<float>*, kNumSlots> noBuses() { return {}; }

/** Which ramp index produced output sample i (assumes both lanes at unity). */
juce::int64 sourceIndex (const juce::AudioBuffer<float>& b, int i, juce::int64 length, float flat = 0.25f)
{
    return (juce::int64) std::llround ((b.getSample (0, i) - flat) * (double) length);
}

HostInfo hostAt (double ppq, double bpm = 120.0, bool playing = true)
{
    HostInfo h;
    h.valid = true; h.playing = playing; h.hasPpq = true; h.bpm = bpm; h.ppq = ppq;
    h.timeSec = ppq * 60.0 / bpm;
    return h;
}
} // namespace

class PlayerTests : public juce::UnitTest
{
public:
    PlayerTests() : juce::UnitTest ("StemPlayer", "StemForge") {}

    void runTest() override
    {
        juce::AudioBuffer<float> out (2, kBlock);

        beginTest ("internal transport plays all lanes sample-accurately");
        {
            StemPlayer p;
            p.prepare (kRate, kBlock);
            const auto len = (juce::int64) (10 * kRate);
            p.swapTrack (makeTrack (10, 120));
            p.process (out, noBuses(), {});
            expect (! p.isPlaying(), "idle until play");
            expectEquals (out.getMagnitude (0, kBlock), 0.0f);

            p.play();
            p.process (out, noBuses(), {});
            expect (p.isPlaying());
            for (int i : { 0, 1, 100, kBlock - 1 })
                expectEquals ((int) sourceIndex (out, i, len), i);
            expectWithinAbsoluteError (p.getPositionSec(), kBlock / kRate, 1e-9);
        }

        beginTest ("gain changes are smoothed, then exact");
        {
            StemPlayer p;
            p.prepare (kRate, kBlock);
            p.swapTrack (makeTrack (10, 120));
            p.play();
            p.setSlotGain (slotForId ("drums"), 0.0f);
            p.process (out, noBuses(), {});
            expect (out.getSample (0, 0) > 0.2f, "ramp starts near previous gain (no click)");
            for (int k = 0; k < 4; ++k)
                p.process (out, noBuses(), {});
            const auto len = (juce::int64) (10 * kRate);
            const auto start = 4 * kBlock; // the 5th block starts after 4 full blocks
            expectWithinAbsoluteError ((double) out.getSample (0, 10), (double) (start + 10) / (double) len, 1e-6);
        }

        beginTest ("loop region wraps and seek lands inside it");
        {
            StemPlayer p;
            p.prepare (kRate, kBlock);
            const auto len = (juce::int64) (10 * kRate);
            p.swapTrack (makeTrack (10, 120));
            p.setLoop (true, 1.0, 1.005); // 240-sample loop
            p.seekTo (1.0);
            p.play();
            p.process (out, noBuses(), {});
            const auto loopS = (juce::int64) kRate;
            for (int i = 0; i < kBlock; ++i)
                expectEquals ((int) sourceIndex (out, i, len), (int) (loopS + i % 240));
        }

        beginTest ("end of song stops and rewinds (internal mode)");
        {
            StemPlayer p;
            p.prepare (kRate, kBlock);
            p.swapTrack (makeTrack (0.02, 120)); // 960 samples
            p.play();
            for (int k = 0; k < 4; ++k)
                p.process (out, noBuses(), {});
            expect (! p.isPlaying());
            expectEquals (p.getPositionSec(), 0.0);
        }

        beginTest ("host sync: DAW beat position maps onto the song");
        {
            StemPlayer p;
            p.prepare (kRate, kBlock);
            const auto len = (juce::int64) (20 * kRate);
            p.swapTrack (makeTrack (20, 120));
            p.setHostSync (true);

            p.process (out, noBuses(), hostAt (8.0)); // beat 8 @120 = 4 s
            expect (p.isPlaying());
            expectEquals ((int) sourceIndex (out, 0, len), (int) (4 * kRate));

            // Next block, host advanced exactly one block: contiguous.
            const double beatsPerBlock = kBlock / kRate * 2.0;
            p.process (out, noBuses(), hostAt (8.0 + beatsPerBlock));
            expectEquals ((int) sourceIndex (out, 0, len), (int) (4 * kRate) + kBlock);

            // Small host jitter (3 ms) is absorbed - no jump, no click.
            p.process (out, noBuses(), hostAt (8.0 + 2 * beatsPerBlock + 0.006));
            expectEquals ((int) sourceIndex (out, 0, len), (int) (4 * kRate) + 2 * kBlock);

            // A real locate jumps.
            p.process (out, noBuses(), hostAt (16.0));
            expectEquals ((int) sourceIndex (out, 0, len), (int) (8 * kRate));

            // DAW stopped: silence.
            p.process (out, noBuses(), hostAt (16.0, 120.0, false));
            expect (! p.isPlaying());
            expectEquals (out.getMagnitude (0, kBlock), 0.0f);
        }

        beginTest ("host sync: start bar, grid offset and nudge");
        {
            StemPlayer p;
            p.prepare (kRate, kBlock);
            const auto len = (juce::int64) (20 * kRate);
            auto t = makeTrack (20, 120);
            t->gridOffsetSec = 0.5;
            p.swapTrack (std::move (t));
            p.setHostSync (true);
            p.setSyncPlacement (3.0, 0.0); // song starts at bar 3 = ppq 8

            p.process (out, noBuses(), hostAt (6.0)); // one bar before start -> before the song
            expectEquals (out.getMagnitude (0, kBlock), 0.0f);

            p.process (out, noBuses(), hostAt (8.0)); // bar 3 -> first beat of the song's grid
            expectEquals ((int) sourceIndex (out, 0, len), (int) (0.5 * kRate));

            p.setSyncPlacement (3.0, 0.010);          // +10 ms nudge
            p.process (out, noBuses(), hostAt (12.0)); // jump + nudge
            expectEquals ((int) sourceIndex (out, 0, len), (int) std::llround ((2.0 + 0.5 + 0.010) * kRate));
        }

        beginTest ("stems routed to their own output bus leave the main mix");
        {
            StemPlayer p;
            p.prepare (kRate, kBlock);
            const auto len = (juce::int64) (10 * kRate);
            p.swapTrack (makeTrack (10, 120));
            p.play();
            juce::AudioBuffer<float> vocalsOut (2, kBlock);
            auto buses = noBuses();
            buses[(size_t) slotForId ("vocals")] = &vocalsOut;
            p.process (out, buses, {});
            expectWithinAbsoluteError (out.getSample (0, 100), 0.25f, 1e-6f);
            expectWithinAbsoluteError ((double) vocalsOut.getSample (1, 100), 100.0 / (double) len, 1e-7);
        }

        beginTest ("re-render at a new tempo keeps the musical position and loop");
        {
            StemPlayer p;
            p.prepare (kRate, kBlock);
            p.swapTrack (makeTrack (20, 120));
            p.setLoop (true, 2.0, 4.0);
            p.seekTo (3.0);
            p.play();
            p.process (out, noBuses(), {});
            const double before = p.getPositionSec();
            auto faster = makeTrack (20 * 120.0 / 132.0, 132);
            auto old = p.swapTrack (std::move (faster));
            expect (old != nullptr, "previous track handed back for off-thread deletion");
            p.process (out, noBuses(), {});
            expectWithinAbsoluteError (p.getPositionSec(), before * 120.0 / 132.0 + kBlock / kRate, 1e-4);
            expectWithinAbsoluteError (p.getLoopStartSec(), 2.0 * 120.0 / 132.0, 1e-9);
            expectWithinAbsoluteError (p.getLoopEndSec(), 4.0 * 120.0 / 132.0, 1e-9);
        }

        beginTest ("a different song starts from the top");
        {
            StemPlayer p;
            p.prepare (kRate, kBlock);
            p.swapTrack (makeTrack (20, 120, "a"));
            p.seekTo (5.0);
            p.play();
            p.process (out, noBuses(), {});
            p.swapTrack (makeTrack (20, 100, "b"));
            p.process (out, noBuses(), {});
            expectWithinAbsoluteError (p.getPositionSec(), kBlock / kRate, 1e-9);
        }
    }
};

class LoaderTests : public juce::UnitTest
{
public:
    LoaderTests() : juce::UnitTest ("StemLoader", "StemForge") {}

    void runTest() override
    {
        beginTest ("reads engine renders and resamples 44.1k -> 48k");
        auto dir = juce::File::createTempFile ("sfload");
        dir.createDirectory();
        const auto wav = dir.getChildFile ("Song_Vocals_120BPM_Cmaj.wav");
        {
            const int n = 44100;
            juce::AudioBuffer<float> b (2, n);
            for (int i = 0; i < n; ++i)
                for (int ch = 0; ch < 2; ++ch)
                    b.setSample (ch, i, 0.5f * std::sin (2.0 * juce::MathConstants<double>::pi * 440.0 * i / 44100.0));
            juce::WavAudioFormat fmt;
            std::unique_ptr<juce::OutputStream> os (wav.createOutputStream().release());
            auto w = fmt.createWriterFor (os, juce::AudioFormatWriterOptions{}
                                                  .withSampleRate (44100).withNumChannels (2).withBitsPerSample (24));
            expect (w != nullptr);
            w->writeFromAudioSampleBuffer (b, 0, n);
        }

        juce::DynamicObject::Ptr stem = new juce::DynamicObject();   // ref-counted: keep owners alive
        stem->setProperty ("id", "vocals");
        stem->setProperty ("label", "Vocals");
        stem->setProperty ("path", wav.getFullPathName());
        stem->setProperty ("file_name", wav.getFileName());
        juce::Array<juce::var> stems { juce::var (stem.get()) };
        juce::DynamicObject::Ptr render = new juce::DynamicObject();
        render->setProperty ("bpm", 132.0);
        render->setProperty ("original_bpm", 120.0);
        render->setProperty ("grid_offset_sec", 0.1);
        render->setProperty ("stretched", true);
        render->setProperty ("stems", stems);

        juce::String error;
        const juce::var renderVar (render.get());
        auto t = StemLoader::loadFiles (renderVar, "abc", 48000.0, error);
        expect (t != nullptr, error);
        if (t == nullptr)
            return;
        expectEquals ((int) t->lanes.size(), 1);
        expectEquals (t->lanes[0].slot, slotForId ("vocals"));
        expect (std::abs (t->length - 48000) <= 2, "length scaled to host rate: " + juce::String (t->length));
        expectWithinAbsoluteError (t->renderBpm, 132.0, 1e-9);
        expect (t->stretched);
        const float peak = t->lanes[0].audio.getMagnitude (0, 1000, 40000);
        expectWithinAbsoluteError (peak, 0.5f, 0.01f);

        error.clear();
        stem->setProperty ("path", dir.getChildFile ("missing.wav").getFullPathName());
        expect (StemLoader::loadFiles (renderVar, "abc", 48000.0, error) == nullptr);
        expect (error.contains ("Cannot read"));
        dir.deleteRecursively();
    }
};

static PlayerTests playerTests;
static LoaderTests loaderTests;

// ---------------------------------------------------------------- integration
namespace
{
struct FakePlayHead : juce::AudioPlayHead
{
    double bpm = 132.0, ppq = 0.0;
    bool playing = true;
    juce::Optional<PositionInfo> getPosition() const override
    {
        PositionInfo p;
        p.setBpm (bpm);
        p.setPpqPosition (ppq);
        p.setTimeInSeconds (ppq * 60.0 / bpm);
        p.setIsPlaying (playing);
        return p;
    }
};

bool pumpUntil (const std::function<bool()>& done, int timeoutMs)
{
    const auto end = juce::Time::getMillisecondCounter() + (juce::uint32) timeoutMs;
    while (juce::Time::getMillisecondCounter() < end)
    {
        if (done())
            return true;
        juce::MessageManager::getInstance()->runDispatchLoopUntil (50);
    }
    return done();
}

int fail (const juce::String& msg)
{
    std::cout << "INTEGRATION FAIL: " << msg << std::endl;
    return 1;
}

int runIntegration (const juce::String& url, const juce::String& trackId)
{
    // Point the shared engine client at the test engine.
    auto cfg = PluginConfig::load();
    const auto previous = cfg;
    cfg.engineUrl = url;
    cfg.autoStart = false;
    cfg.save();
    struct Restore { PluginConfig c; ~Restore() { c.save(); } } restore { previous };

    auto proc = std::make_unique<StemForgeProcessor>();
    FakePlayHead head;
    proc->setPlayHead (&head);
    proc->setPlayConfigDetails (0, 2, 48000.0, kBlock);
    proc->prepareToPlay (48000.0, kBlock);

    juce::AudioBuffer<float> buf (2, kBlock);
    juce::MidiBuffer midi;
    auto block = [&] { proc->processBlock (buf, midi); head.ppq += kBlock / 48000.0 * head.bpm / 60.0; };

    if (! pumpUntil ([&] { return proc->engineClient().isHealthy(); }, 15000))
        return fail ("engine not healthy at " + url);

    block(); // let the processor see the DAW tempo
    proc->loadTrack (trackId);
    if (! pumpUntil ([&] { return std::abs ((double) proc->stateJson()["renderBpm"] - 132.0) < 0.01; }, 180000))
        return fail ("no 132 BPM render: " + juce::JSON::toString (proc->stateJson()));

    const auto st = proc->stateJson();
    const double orig = st["originalBpm"], dur = st["duration"];
    std::cout << "  loaded at host tempo: " << (double) st["renderBpm"] << " BPM (original " << orig
              << "), duration " << dur << " s, stretched=" << (bool) st["stretched"] << std::endl;
    if (! (bool) st["stretched"])
        return fail ("expected a stretched render");

    // Play from bar 1 and make sure audio comes out, synced to the fake DAW.
    head.ppq = 0.0;
    float peak = 0.0f;
    for (int i = 0; i < 400; ++i)
    {
        block();
        peak = juce::jmax (peak, buf.getMagnitude (0, kBlock));
    }
    const double expectSec = head.ppq * 60.0 / head.bpm + (double) proc->stateJson()["position"] * 0.0;
    const double pos = proc->stateJson()["position"];
    std::cout << "  after 400 blocks: song position " << pos << " s (host " << expectSec << " s), peak " << peak << std::endl;
    if (peak < 0.01f)
        return fail ("no audio output while the DAW is playing");

    // Tempo change in the DAW -> automatic re-render.
    head.bpm = 100.0;
    block();
    if (! pumpUntil ([&] { block(); return std::abs ((double) proc->stateJson()["renderBpm"] - 100.0) < 0.01; }, 180000))
        return fail ("did not follow the DAW tempo change to 100 BPM");
    std::cout << "  followed DAW tempo change -> " << (double) proc->stateJson()["renderBpm"] << " BPM" << std::endl;

    // Session recall: save, restore into a fresh instance.
    juce::MemoryBlock state;
    proc->getStateInformation (state);
    auto again = std::make_unique<StemForgeProcessor>();
    again->setStateInformation (state.getData(), (int) state.getSize());
    if (again->sessionJson()["trackId"].toString() != trackId)
        return fail ("session recall lost the track id");
    std::cout << "  session recall restored track " << trackId << std::endl;

    // Drag-out file list follows the render.
    const auto files = proc->dragFiles();
    if (files.empty() || ! files.front().path.contains ("100"))
        return fail ("drag files not at DAW tempo");
    std::cout << "  drag-out file: " << juce::File (files.front().path).getFileName() << std::endl;
    std::cout << "INTEGRATION PASS" << std::endl;
    return 0;
}
} // namespace

int main (int argc, char** argv)
{
    juce::ScopedJuceInitialiser_GUI init;
    juce::StringArray args (argv + 1, argc - 1);

    if (args.contains ("--engine"))
        return runIntegration (args[args.indexOf ("--engine") + 1], args[args.indexOf ("--track") + 1]);

    juce::UnitTestRunner runner;
    runner.setAssertOnFailure (false);
    runner.runTestsInCategory ("StemForge");
    int failures = 0;
    for (int i = 0; i < runner.getNumResults(); ++i)
        failures += runner.getResult (i)->failures;
    std::cout << (failures == 0 ? "ALL TESTS PASSED" : "TESTS FAILED") << std::endl;
    return failures == 0 ? 0 : 1;
}
