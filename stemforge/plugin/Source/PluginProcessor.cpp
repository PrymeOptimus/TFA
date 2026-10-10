#include "PluginProcessor.h"
#if ! STEMFORGE_HEADLESS
 #include "PluginEditor.h"
#endif

namespace stemforge
{

juce::AudioProcessor::BusesProperties StemForgeProcessor::makeBuses()
{
    auto props = juce::AudioProcessor::BusesProperties()
                     .withOutput ("Main", juce::AudioChannelSet::stereo(), true);
    // One optional stereo output per stem for routing to separate DAW channels.
    for (auto* label : kStemLabels)
        props = props.withOutput (label, juce::AudioChannelSet::stereo(), false);
    return props;
}

StemForgeProcessor::StemForgeProcessor()
    : AudioProcessor (makeBuses()),
      loader (*engine, [ref = juce::WeakReference<StemForgeProcessor> (this)] (std::unique_ptr<StemTrack> t, int gen) {
          // Loader thread -> message thread. Ownership travels inside a shared_ptr.
          auto shared = std::shared_ptr<StemTrack> (t.release());
          juce::MessageManager::callAsync ([ref, shared, gen]() mutable {
              if (auto* p = ref.get())
                  p->installTrack (std::unique_ptr<StemTrack> (new StemTrack (std::move (*shared))), gen);
          });
      })
{
    levels.fill (1.0f);
    applySync();
    startTimerHz (4);
}

StemForgeProcessor::~StemForgeProcessor()
{
    stopTimer();
}

bool StemForgeProcessor::isBusesLayoutSupported (const BusesLayout& layout) const
{
    const auto& main = layout.getMainOutputChannelSet();
    if (main != juce::AudioChannelSet::stereo() && main != juce::AudioChannelSet::mono())
        return false;
    for (int i = 1; i < layout.outputBuses.size(); ++i)
    {
        const auto& set = layout.outputBuses.getReference (i);
        if (! set.isDisabled() && set != juce::AudioChannelSet::stereo())
            return false;
    }
    return layout.inputBuses.isEmpty();
}

void StemForgeProcessor::prepareToPlay (double sampleRate, int samplesPerBlock)
{
    const double previous = currentRate.exchange (sampleRate);
    player.prepare (sampleRate, juce::jmax (samplesPerBlock, 32) * 2);

    // Buffers are resampled at load time, so a new host rate needs a reload.
    if (std::abs (previous - sampleRate) > 0.5)
        juce::MessageManager::callAsync ([ref = juce::WeakReference<StemForgeProcessor> (this)] {
            if (auto* p = ref.get())
                if (p->trackId.isNotEmpty())
                    p->requestLoad (p->lastRequestedBpm);
        });
}

void StemForgeProcessor::processBlock (juce::AudioBuffer<float>& buffer, juce::MidiBuffer& midi)
{
    juce::ScopedNoDenormals noDenormals;
    midi.clear();

    HostInfo host;
    if (auto* ph = getPlayHead())
    {
        if (const auto pos = ph->getPosition())
        {
            host.valid = true;
            host.playing = pos->getIsPlaying();
            if (const auto bpm = pos->getBpm())          host.bpm = *bpm;
            if (const auto ppq = pos->getPpqPosition())  { host.ppq = *ppq; host.hasPpq = true; }
            if (const auto ts = pos->getTimeInSeconds()) host.timeSec = *ts;
        }
    }
    hostValid.store (host.valid);
    hostPlaying.store (host.playing);
    if (host.valid)
    {
        hostBpm.store (host.bpm);
        hostPpq.store (host.ppq);
    }

    auto main = getBusBuffer (buffer, false, 0);
    std::array<std::optional<juce::AudioBuffer<float>>, kNumSlots> busViews;
    std::array<juce::AudioBuffer<float>*, kNumSlots> stemOuts {};
    for (int slot = 0; slot < kNumSlots; ++slot)
    {
        const int busIndex = slot + 1;
        if (busIndex < getBusCount (false) && getBus (false, busIndex)->isEnabled()
            && getBus (false, busIndex)->getNumberOfChannels() > 0)
        {
            busViews[(size_t) slot].emplace (getBusBuffer (buffer, false, busIndex));
            stemOuts[(size_t) slot] = &*busViews[(size_t) slot];
        }
    }

    player.process (main, stemOuts, host);
}

// ---------------------------------------------------------------- loading
void StemForgeProcessor::loadTrack (const juce::String& id)
{
    if (id.isEmpty())
        return;
    if (id != trackId)
        extraFiles.clear();
    trackId = id;
    failedBpm = -1.0;
    const double bpm = (sync.hostSync && sync.stretch && hostValid.load()) ? hostBpm.load() : 0.0;
    requestLoad (bpm);
}

void StemForgeProcessor::requestLoad (double bpm)
{
    lastRequestedBpm = bpm;
    StemLoader::Request r;
    r.trackId = trackId;
    r.bpm = bpm;
    r.sampleRate = currentRate.load();
    r.generation = ++generation;
    loader.request (r);
}

void StemForgeProcessor::installTrack (std::unique_ptr<StemTrack> t, int gen)
{
    if (gen != generation || t == nullptr)
        return; // superseded

    loadedTrackId = t->trackId;
    renderBpm = t->renderBpm;
    originalBpm = t->originalBpm;
    durationSec = t->durationSec();
    stretched = t->stretched;
    files.clear();
    for (const auto& lane : t->lanes)
        files.push_back ({ lane.id, lane.label, lane.path, lane.slot });

    auto old = player.swapTrack (std::move (t));
    old.reset(); // freed here on the message thread, never on the audio thread
    sendChangeMessage();
}

void StemForgeProcessor::timerCallback()
{
    // Follow DAW tempo changes: once the host tempo has been stable for ~0.5 s and differs
    // from the loaded render, request a new render at that tempo.
    if (loader.state() == StemLoader::State::error)
        failedBpm = lastRequestedBpm;   // don't hammer the engine with a tempo it rejected

    if (trackId.isEmpty() || ! (sync.hostSync && sync.stretch) || ! hostValid.load())
        return;

    const double bpm = std::round (hostBpm.load() * 100.0) / 100.0;
    if (bpm <= 0 || std::abs (bpm - lastRequestedBpm) < 0.01 || std::abs (bpm - failedBpm) < 0.01)
    {
        stableTicks = 0;
        return;
    }
    if (std::abs (bpm - pendingBpm) > 0.005)
    {
        pendingBpm = bpm;
        stableTicks = 0;
        return;
    }
    if (++stableTicks >= 2)
    {
        stableTicks = 0;
        requestLoad (bpm);
    }
}

// ---------------------------------------------------------------- control surface
void StemForgeProcessor::setLevels (const juce::var& v)
{
    if (auto* o = v.getDynamicObject())
        for (const auto& prop : o->getProperties())
        {
            const int slot = slotForId (prop.name.toString());
            if (slot >= 0)
            {
                levels[(size_t) slot] = (float) (double) prop.value;
                player.setSlotGain (slot, levels[(size_t) slot]);
            }
        }
}

void StemForgeProcessor::setMaster (float g)
{
    master = juce::jlimit (0.0f, 2.0f, g);
    player.setMasterGain (master);
}

void StemForgeProcessor::transport (const juce::var& cmd)
{
    const auto action = cmd.getProperty ("action", "").toString();
    if (action == "play")        player.play();
    else if (action == "pause")  player.pause();
    else if (action == "stop")   player.stop();
    else if (action == "seek")   player.seekTo ((double) cmd.getProperty ("time", 0.0));
    else if (action == "loop")
        player.setLoop ((bool) cmd.getProperty ("on", false),
                        (double) cmd.getProperty ("start", player.getLoopStartSec()),
                        (double) cmd.getProperty ("end", player.getLoopEndSec()));
}

void StemForgeProcessor::setSync (const juce::var& s)
{
    const bool wasStretch = sync.hostSync && sync.stretch;
    sync.hostSync = (bool) s.getProperty ("hostSync", sync.hostSync);
    sync.stretch  = (bool) s.getProperty ("stretch", sync.stretch);
    sync.startBar = juce::jlimit (1.0, 9999.0, (double) s.getProperty ("startBar", sync.startBar));
    sync.nudgeMs  = juce::jlimit (-2000.0, 2000.0, (double) s.getProperty ("nudgeMs", sync.nudgeMs));
    applySync();

    const bool nowStretch = sync.hostSync && sync.stretch;
    if (trackId.isNotEmpty() && wasStretch != nowStretch)
    {
        failedBpm = -1.0;
        requestLoad (nowStretch && hostValid.load() ? std::round (hostBpm.load() * 100.0) / 100.0 : 0.0);
    }
}

void StemForgeProcessor::applySync()
{
    player.setHostSync (sync.hostSync);
    player.setSyncPlacement (sync.startBar, sync.nudgeMs / 1000.0);
}

void StemForgeProcessor::addDragFile (const DragFile& f)
{
    extraFiles.erase (std::remove_if (extraFiles.begin(), extraFiles.end(),
                                      [&] (const DragFile& e) { return e.id == f.id; }),
                      extraFiles.end());
    extraFiles.push_back (f);
    sendChangeMessage();
}

std::vector<DragFile> StemForgeProcessor::dragFiles() const
{
    auto all = files;
    all.insert (all.end(), extraFiles.begin(), extraFiles.end());
    return all;
}

std::optional<DragFile> StemForgeProcessor::findDragFile (const juce::String& key) const
{
    for (const auto& f : dragFiles())
        if (f.id == key || f.path == key)
            return f;
    return std::nullopt;
}

juce::var StemForgeProcessor::syncJson() const
{
    auto* o = new juce::DynamicObject();
    o->setProperty ("hostSync", sync.hostSync);
    o->setProperty ("stretch", sync.stretch);
    o->setProperty ("startBar", sync.startBar);
    o->setProperty ("nudgeMs", sync.nudgeMs);
    return juce::var (o);
}

juce::var StemForgeProcessor::sessionJson() const
{
    auto* o = new juce::DynamicObject();
    o->setProperty ("trackId", trackId);
    o->setProperty ("uiState", uiState);
    o->setProperty ("sync", syncJson());
    o->setProperty ("master", master);
    o->setProperty ("wrapper", juce::String (getWrapperTypeDescription (wrapperType)));
    o->setProperty ("host", juce::String (juce::PluginHostType().getHostDescription()));
    o->setProperty ("version", juce::String (JucePlugin_VersionString));
    return juce::var (o);
}

juce::var StemForgeProcessor::stateJson() const
{
    auto* host = new juce::DynamicObject();
    host->setProperty ("valid", hostValid.load());
    host->setProperty ("playing", hostPlaying.load());
    host->setProperty ("bpm", hostBpm.load());
    host->setProperty ("ppq", hostPpq.load());

    auto* loop = new juce::DynamicObject();
    loop->setProperty ("on", player.isLoopOn());
    loop->setProperty ("start", player.getLoopStartSec());
    loop->setProperty ("end", player.getLoopEndSec());

    auto* ld = new juce::DynamicObject();
    ld->setProperty ("state", loader.stateName());
    ld->setProperty ("message", loader.message());

    auto* o = new juce::DynamicObject();
    o->setProperty ("trackId", loadedTrackId);
    o->setProperty ("requestedTrackId", trackId);
    o->setProperty ("playing", player.isPlaying());
    o->setProperty ("position", player.getPositionSec());
    o->setProperty ("duration", durationSec);
    o->setProperty ("loop", juce::var (loop));
    o->setProperty ("host", juce::var (host));
    o->setProperty ("sync", syncJson());
    o->setProperty ("renderBpm", renderBpm);
    o->setProperty ("originalBpm", originalBpm);
    o->setProperty ("stretched", stretched);
    o->setProperty ("loader", juce::var (ld));
    return juce::var (o);
}

// ---------------------------------------------------------------- state
void StemForgeProcessor::getStateInformation (juce::MemoryBlock& dest)
{
    juce::ValueTree s ("StemForge");
    s.setProperty ("trackId", trackId, nullptr);
    s.setProperty ("uiState", uiState, nullptr);
    s.setProperty ("hostSync", sync.hostSync, nullptr);
    s.setProperty ("stretch", sync.stretch, nullptr);
    s.setProperty ("startBar", sync.startBar, nullptr);
    s.setProperty ("nudgeMs", sync.nudgeMs, nullptr);
    s.setProperty ("master", master, nullptr);
    juce::StringArray g;
    for (auto v : levels)
        g.add (juce::String (v, 4));
    s.setProperty ("levels", g.joinIntoString (","), nullptr);
    s.setProperty ("loopOn", player.isLoopOn(), nullptr);
    s.setProperty ("loopStart", player.getLoopStartSec(), nullptr);
    s.setProperty ("loopEnd", player.getLoopEndSec(), nullptr);
    if (auto xml = s.createXml())
        copyXmlToBinary (*xml, dest);
}

void StemForgeProcessor::setStateInformation (const void* data, int size)
{
    const auto xml = getXmlFromBinary (data, size);
    if (xml == nullptr)
        return;
    const auto s = juce::ValueTree::fromXml (*xml);
    if (! s.hasType ("StemForge"))
        return;

    uiState = s.getProperty ("uiState", "").toString();
    sync.hostSync = s.getProperty ("hostSync", true);
    sync.stretch = s.getProperty ("stretch", true);
    sync.startBar = s.getProperty ("startBar", 1.0);
    sync.nudgeMs = s.getProperty ("nudgeMs", 0.0);
    applySync();
    setMaster ((float) (double) s.getProperty ("master", 1.0));

    juce::StringArray g;
    g.addTokens (s.getProperty ("levels", "").toString(), ",", "");
    for (int i = 0; i < juce::jmin (g.size(), kNumSlots); ++i)
    {
        levels[(size_t) i] = g[i].getFloatValue();
        player.setSlotGain (i, levels[(size_t) i]);
    }

    const auto id = s.getProperty ("trackId", "").toString();
    if (id.isNotEmpty())
    {
        loadTrack (id);
        player.setLoop (s.getProperty ("loopOn", false), s.getProperty ("loopStart", 0.0), s.getProperty ("loopEnd", 0.0));
    }
}

juce::AudioProcessorEditor* StemForgeProcessor::createEditor()
{
   #if STEMFORGE_HEADLESS
    return nullptr;
   #else
    return new StemForgeEditor (*this);
   #endif
}

} // namespace stemforge

juce::AudioProcessor* JUCE_CALLTYPE createPluginFilter()
{
    return new stemforge::StemForgeProcessor();
}
