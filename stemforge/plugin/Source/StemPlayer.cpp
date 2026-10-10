#include "StemPlayer.h"

namespace stemforge
{

int slotForId (const juce::String& id)
{
    for (int i = 0; i < kNumSlots; ++i)
        if (id == kStemIds[(size_t) i])
            return i;
    return -1;
}

StemPlayer::StemPlayer()
{
    for (auto& g : gains)
        g.store (1.0f);
}

void StemPlayer::prepare (double sr, int maxBlockSize)
{
    sampleRate = sr;
    indexScratch.assign ((size_t) juce::jmax (1, maxBlockSize), 0);
    for (size_t i = 0; i < smoothers.size(); ++i)
    {
        smoothers[i].reset (sr, 0.02);
        smoothers[i].setCurrentAndTargetValue (gains[i].load());
    }
    masterSmoother.reset (sr, 0.02);
    masterSmoother.setCurrentAndTargetValue (masterGain.load());
}

std::unique_ptr<StemTrack> StemPlayer::swapTrack (std::unique_ptr<StemTrack> next)
{
    const juce::SpinLock::ScopedLockType sl (trackLock);

    if (track != nullptr && next != nullptr && track->trackId == next->trackId
        && track->renderBpm > 0 && next->renderBpm > 0)
    {
        // Same song re-rendered at another tempo (or sample rate): keep the musical position.
        const double timeScale = track->renderBpm / next->renderBpm;
        const double posSec = (double) pos / track->sampleRate;
        pos = (juce::int64) std::llround (posSec * timeScale * next->sampleRate);
        loopStartSec.store (loopStartSec.load() * timeScale);
        loopEndSec.store (loopEndSec.load() * timeScale);
    }
    else if (track != nullptr)
    {
        // A different song: start from the top. (The first track keeps any loop
        // restored from the DAW session.)
        pos = 0;
        loopOn.store (false);
        loopStartSec.store (0.0);
        loopEndSec.store (0.0);
    }

    std::swap (track, next);
    return next;
}

void StemPlayer::setLoop (bool on, double startSec, double endSec)
{
    loopStartSec.store (juce::jmax (0.0, juce::jmin (startSec, endSec)));
    loopEndSec.store (juce::jmax (startSec, endSec));
    loopOn.store (on);
}

void StemPlayer::setSlotGain (int slot, float gain)
{
    if (juce::isPositiveAndBelow (slot, kNumSlots))
        gains[(size_t) slot].store (juce::jlimit (0.0f, 4.0f, gain));
}

void StemPlayer::setSyncPlacement (double startBar, double nudge, int beatsPerBar)
{
    startPpq.store (juce::jmax (0.0, startBar - 1.0) * beatsPerBar);
    nudgeSec.store (nudge);
}

juce::int64 StemPlayer::wrapLoop (juce::int64 p, juce::int64 loopS, juce::int64 loopE, bool on) const
{
    if (on && loopE > loopS && p >= loopE)
        return loopS + (p - loopS) % (loopE - loopS);
    return p;
}

void StemPlayer::process (juce::AudioBuffer<float>& main,
                          const std::array<juce::AudioBuffer<float>*, kNumSlots>& stemOuts,
                          const HostInfo& host)
{
    const int n = main.getNumSamples();
    main.clear();
    for (auto* b : stemOuts)
        if (b != nullptr)
            b->clear();

    for (size_t i = 0; i < smoothers.size(); ++i)
        smoothers[i].setTargetValue (gains[i].load());
    masterSmoother.setTargetValue (masterGain.load());

    const juce::SpinLock::ScopedTryLockType tl (trackLock);
    if (! tl.isLocked() || track == nullptr || track->length == 0 || n > (int) indexScratch.size())
    {
        playingNow.store (false);
        return;
    }

    const auto& t = *track;
    const double sr = t.sampleRate;
    const bool loopActive = loopOn.load();
    const auto loopS = (juce::int64) std::llround (loopStartSec.load() * sr);
    const auto loopE = (juce::int64) std::llround (loopEndSec.load() * sr);

    // Pending seek from the UI (internal transport only).
    const double seek = seekRequestSec.exchange (-1.0);
    if (seek >= 0.0)
        pos = juce::jlimit<juce::int64> (0, t.length, (juce::int64) std::llround (seek * sr));

    bool active = false;

    if (hostSync.load() && host.valid)
    {
        active = host.playing;
        if (host.playing && host.bpm > 0)
        {
            // Beats since the chosen start bar -> seconds at the host tempo. Buffers are
            // rendered at the host tempo, so seconds map 1:1 onto the song (grid-locked).
            const double hostBeats = host.hasPpq ? host.ppq : host.timeSec * host.bpm / 60.0;
            const double elapsed = (hostBeats - startPpq.load()) * 60.0 / host.bpm;
            const double songSec = elapsed + t.gridOffsetSec + nudgeSec.load();
            auto target = (juce::int64) std::llround (songSec * sr);
            target = wrapLoop (target, loopS, loopE, loopActive);

            // Follow contiguously; only jump on a real discontinuity (locate, host loop,
            // start of playback). Avoids per-block clicks from timing jitter.
            const auto tolerance = (juce::int64) (0.010 * sr);
            if (! wasHostPlaying || std::abs (target - pos) > tolerance)
                pos = target;
        }
        wasHostPlaying = host.playing;
    }
    else
    {
        wasHostPlaying = false;
        active = playRequested.load();
        if (active && ! loopActive && pos >= t.length)
        {
            // Reached the end: stop and rewind, like the browser transport.
            playRequested.store (false);
            pos = 0;
            active = false;
        }
    }

    playingNow.store (active);

    if (! active)
    {
        positionSec.store ((double) juce::jlimit<juce::int64> (0, t.length, pos) / sr);
        return;
    }

    // Sample index per output sample (handles loop wrap and silence outside the song).
    for (int i = 0; i < n; ++i)
        indexScratch[(size_t) i] = wrapLoop (pos + i, loopS, loopE, loopActive);

    const int mainCh = main.getNumChannels();

    for (const auto& lane : t.lanes)
    {
        if (lane.slot < 0)
            continue;

        auto& sm = smoothers[(size_t) lane.slot];
        auto* dest = stemOuts[(size_t) lane.slot] != nullptr ? stemOuts[(size_t) lane.slot] : &main;
        const int destCh = dest->getNumChannels();
        const int srcCh = lane.audio.getNumChannels();
        if (destCh == 0 || srcCh == 0)
        {
            sm.skip (n);
            continue;
        }

        const float* srcL = lane.audio.getReadPointer (0);
        const float* srcR = lane.audio.getReadPointer (juce::jmin (1, srcCh - 1));
        float* outL = dest->getWritePointer (0);
        float* outR = destCh > 1 ? dest->getWritePointer (1) : nullptr;

        for (int i = 0; i < n; ++i)
        {
            const float g = sm.getNextValue();
            const auto idx = indexScratch[(size_t) i];
            if (idx < 0 || idx >= t.length || g <= 0.0f)
                continue;
            const float l = srcL[idx] * g, r = srcR[idx] * g;
            if (outR != nullptr) { outL[i] += l; outR[i] += r; }
            else                 { outL[i] += 0.5f * (l + r); }
        }
    }

    // Master gain on every output.
    {
        juce::LinearSmoothedValue<float> m = masterSmoother;
        for (int ch = 0; ch < mainCh; ++ch)
        {
            m = masterSmoother;
            auto* d = main.getWritePointer (ch);
            for (int i = 0; i < n; ++i)
                d[i] *= m.getNextValue();
        }
        for (auto* b : stemOuts)
            if (b != nullptr)
                for (int ch = 0; ch < b->getNumChannels(); ++ch)
                {
                    m = masterSmoother;
                    auto* d = b->getWritePointer (ch);
                    for (int i = 0; i < n; ++i)
                        d[i] *= m.getNextValue();
                }
        masterSmoother.skip (n);
    }

    pos = wrapLoop (pos + n, loopS, loopE, loopActive);
    positionSec.store ((double) juce::jlimit<juce::int64> (0, t.length, pos) / sr);
}

} // namespace stemforge
