#include "PluginEditor.h"
#include "LoadingPage.h"

namespace stemforge
{

static constexpr int kDockHeight = 58;

StemForgeEditor::StemForgeEditor (StemForgeProcessor& p)
    : AudioProcessorEditor (p), proc (p), web (webOptions()), dock (p)
{
    addAndMakeVisible (web);
    addAndMakeVisible (dock);
    setResizable (true, true);
    setResizeLimits (720, 480, 2400, 1600);
    setSize (1180, 780);

    web.goToURL (juce::WebBrowserComponent::getResourceProviderRoot());
    startTimerHz (30);
}

StemForgeEditor::~StemForgeEditor()
{
    stopTimer();
}

void StemForgeEditor::paint (juce::Graphics& g)
{
    g.fillAll (juce::Colour (0xff0b0d12));
}

void StemForgeEditor::resized()
{
    auto r = getLocalBounds();
    dock.setBounds (r.removeFromBottom (kDockHeight));
    web.setBounds (r);
}

void StemForgeEditor::timerCallback()
{
    auto& engine = proc.engineClient();

    // Swap the loading page for the engine-served UI once the engine answers.
    if (! onEnginePage && engine.isHealthy())
    {
        onEnginePage = true;
        web.goToURL (engine.baseUrl() + "/?host=juce");
    }

    web.emitEventIfBrowserIsVisible ("sf_state", proc.stateJson());

    if (++tick % 15 == 0 && ! onEnginePage)
    {
        auto* o = new juce::DynamicObject();
        o->setProperty ("healthy", engine.isHealthy());
        o->setProperty ("message", engine.statusMessage());
        o->setProperty ("url", engine.baseUrl());
        o->setProperty ("config", PluginConfig::file().getFullPathName());
        web.emitEventIfBrowserIsVisible ("sf_engine", juce::var (o));
    }
}

std::optional<juce::WebBrowserComponent::Resource> StemForgeEditor::serveResource (const juce::String& url)
{
    if (url == "/" || url.startsWith ("/index.html"))
    {
        const auto html = juce::String (kLoadingPageHtml);
        juce::WebBrowserComponent::Resource r;
        r.mimeType = "text/html";
        const auto utf8 = html.toRawUTF8();
        const auto* bytes = reinterpret_cast<const std::byte*> (utf8);
        r.data.assign (bytes, bytes + html.getNumBytesAsUTF8());
        return r;
    }
    return std::nullopt;
}

juce::WebBrowserComponent::Options StemForgeEditor::webOptions()
{
    using Options = juce::WebBrowserComponent::Options;

    return Options{}
        .withBackend (Options::Backend::webview2)
        .withWinWebView2Options (Options::WinWebView2{}
                                     .withUserDataFolder (juce::File::getSpecialLocation (juce::File::tempDirectory)
                                                              .getChildFile ("StemForgeWebView"))
                                     .withBackgroundColour (juce::Colour (0xff0b0d12)))
        .withNativeIntegrationEnabled()
        .withKeepPageLoadedWhenBrowserIsHidden()
        .withResourceProvider ([this] (const juce::String& url) { return serveResource (url); })

        .withNativeFunction ("sf_getSession", [this] (const Args&, Completion done) {
            done (proc.sessionJson());
        })
        .withNativeFunction ("sf_loadTrack", [this] (const Args& a, Completion done) {
            proc.loadTrack (arg (a, 0).toString());
            done (true);
        })
        .withNativeFunction ("sf_setLevels", [this] (const Args& a, Completion done) {
            proc.setLevels (arg (a, 0));
            done (true);
        })
        .withNativeFunction ("sf_setMaster", [this] (const Args& a, Completion done) {
            proc.setMaster ((float) (double) arg (a, 0));
            done (true);
        })
        .withNativeFunction ("sf_transport", [this] (const Args& a, Completion done) {
            proc.transport (arg (a, 0));
            done (true);
        })
        .withNativeFunction ("sf_setSync", [this] (const Args& a, Completion done) {
            proc.setSync (arg (a, 0));
            done (proc.sessionJson());
        })
        .withNativeFunction ("sf_saveUiState", [this] (const Args& a, Completion done) {
            proc.setUiState (arg (a, 0).toString());
            done (true);
        })
        .withNativeFunction ("sf_addDragFile", [this] (const Args& a, Completion done) {
            const auto v = arg (a, 0);
            DragFile f { v.getProperty ("id", "").toString(), v.getProperty ("label", "").toString(),
                         v.getProperty ("path", "").toString(), -1 };
            const bool ok = juce::File (f.path).existsAsFile();
            if (ok)
                proc.addDragFile (f);
            done (ok);
        })
        .withNativeFunction ("sf_startDrag", [this] (const Args& a, Completion done) {
            // Best effort: some hosts only accept OS drags that start from a native mouse
            // event, which is why the native dock exists as the always-works path.
            const auto f = proc.findDragFile (arg (a, 0).toString());
            if (f)
                juce::MessageManager::callAsync ([path = f->path, safe = juce::Component::SafePointer<juce::Component> (&web)] {
                    if (safe != nullptr)
                        DragDock::startExternalDrag (path, safe.getComponent());
                });
            done (f.has_value());
        })
        .withNativeFunction ("sf_reveal", [this] (const Args& a, Completion done) {
            auto key = arg (a, 0).toString();
            juce::File file (key);
            if (const auto f = proc.findDragFile (key))
                file = juce::File (f->path);
            const bool ok = file.exists();
            if (ok)
                file.revealToUser();
            done (ok);
        })
        .withNativeFunction ("sf_engineStatus", [this] (const Args&, Completion done) {
            auto* o = new juce::DynamicObject();
            o->setProperty ("healthy", proc.engineClient().isHealthy());
            o->setProperty ("message", proc.engineClient().statusMessage());
            o->setProperty ("url", proc.engineClient().baseUrl());
            o->setProperty ("config", PluginConfig::file().getFullPathName());
            done (juce::var (o));
        })
        .withNativeFunction ("sf_startEngine", [this] (const Args&, Completion done) {
            proc.engineClient().requestStart();
            done (true);
        });
}

} // namespace stemforge
