#include "StemLoader.h"

namespace stemforge
{

StemLoader::StemLoader (EngineClient& e, Callback cb)
    : juce::Thread ("StemForge loader"), engine (e), onLoaded (std::move (cb))
{
    startThread();
}

StemLoader::~StemLoader()
{
    stopThread (10000);
}

void StemLoader::request (Request r)
{
    {
        const juce::ScopedLock sl (lock);
        pending = r;
    }
    notify();
}

juce::String StemLoader::message() const
{
    const juce::ScopedLock sl (lock);
    return msg;
}

juce::String StemLoader::stateName() const
{
    switch (st.load())
    {
        case State::rendering: return "rendering";
        case State::loading:   return "loading";
        case State::ready:     return "ready";
        case State::error:     return "error";
        case State::idle:      break;
    }
    return "idle";
}

void StemLoader::setState (State s, const juce::String& m)
{
    const juce::ScopedLock sl (lock);
    st.store (s);
    msg = m;
}

void StemLoader::run()
{
    while (! threadShouldExit())
    {
        std::optional<Request> job;
        {
            const juce::ScopedLock sl (lock);
            std::swap (job, pending);
        }
        if (! job)
        {
            wait (-1);
            continue;
        }

        auto superseded = [this] {
            const juce::ScopedLock sl (lock);
            return threadShouldExit() || pending.has_value();
        };

        setState (State::rendering, job->bpm > 0 ? "Stretching stems to " + juce::String (job->bpm, 2) + " BPM..."
                                                 : juce::String ("Preparing stems..."));
        auto* body = new juce::DynamicObject();
        body->setProperty ("bpm", job->bpm > 0 ? juce::var (job->bpm) : juce::var());
        juce::String error;
        const auto render = engine.postJson ("/api/tracks/" + job->trackId + "/render", juce::var (body), error);
        if (superseded())
            continue;
        if (render.isVoid())
        {
            setState (State::error, error);
            continue;
        }

        setState (State::loading, "Loading stems into the plug-in...");
        auto track = loadFiles (render, job->trackId, job->sampleRate, error, superseded);
        if (superseded())
            continue;
        if (track == nullptr)
        {
            setState (State::error, error);
            continue;
        }

        setState (State::ready, track->stretched ? "Synced to " + juce::String (track->renderBpm, 2) + " BPM"
                                                 : "Original tempo (" + juce::String (track->renderBpm, 1) + " BPM)");
        onLoaded (std::move (track), job->generation);
    }
}

std::unique_ptr<StemTrack> StemLoader::loadFiles (const juce::var& render, const juce::String& trackId,
                                                  double hostRate, juce::String& error,
                                                  const std::function<bool()>& shouldAbort)
{
    juce::AudioFormatManager formats;
    formats.registerBasicFormats();

    auto track = std::make_unique<StemTrack>();
    track->trackId = trackId;
    track->sampleRate = hostRate;
    track->renderBpm = (double) render.getProperty ("bpm", 0.0);
    track->originalBpm = (double) render.getProperty ("original_bpm", 0.0);
    track->gridOffsetSec = (double) render.getProperty ("grid_offset_sec", 0.0);
    track->stretched = (bool) render.getProperty ("stretched", false);

    const auto* stems = render.getProperty ("stems", juce::var()).getArray();
    if (stems == nullptr)
    {
        error = "Engine returned no stems";
        return nullptr;
    }

    for (const auto& s : *stems)
    {
        if (shouldAbort && shouldAbort())
            return nullptr;

        StemTrack::Lane lane;
        lane.id = s.getProperty ("id", "").toString();
        lane.slot = slotForId (lane.id);
        lane.label = s.getProperty ("label", lane.id).toString();
        lane.path = s.getProperty ("path", "").toString();
        lane.fileName = s.getProperty ("file_name", "").toString();

        std::unique_ptr<juce::AudioFormatReader> reader (formats.createReaderFor (juce::File (lane.path)));
        if (reader == nullptr)
        {
            error = "Cannot read " + lane.path;
            return nullptr;
        }

        const auto srcLen = (int) reader->lengthInSamples;
        juce::AudioBuffer<float> src (2, srcLen);
        reader->read (&src, 0, srcLen, 0, true, reader->numChannels > 1);
        if (reader->numChannels == 1)
            src.copyFrom (1, 0, src, 0, 0, srcLen);

        if (std::abs (reader->sampleRate - hostRate) < 0.5)
        {
            lane.audio = std::move (src);
        }
        else
        {
            // Offline windowed-sinc resample to the host rate.
            const double ratio = reader->sampleRate / hostRate;
            const int outLen = (int) std::floor (srcLen / ratio);
            lane.audio.setSize (2, outLen);
            juce::AudioBuffer<float> padded (2, srcLen + 64);
            padded.clear();
            for (int ch = 0; ch < 2; ++ch)
            {
                padded.copyFrom (ch, 0, src, ch, 0, srcLen);
                juce::WindowedSincInterpolator interp;
                interp.process (ratio, padded.getReadPointer (ch), lane.audio.getWritePointer (ch), outLen);
            }
        }

        track->length = juce::jmax (track->length, (juce::int64) lane.audio.getNumSamples());
        track->lanes.push_back (std::move (lane));
    }

    // Pad every lane to the same length so indexing is always in range.
    for (auto& lane : track->lanes)
        if (lane.audio.getNumSamples() < track->length)
            lane.audio.setSize (2, (int) track->length, true, true);

    return track;
}

} // namespace stemforge
