#pragma once

#include <juce_core/juce_core.h>

#include <atomic>

namespace stemforge
{

/** Plugin settings, read from ~/.stemforge/plugin.json (created with defaults on first run). */
struct PluginConfig
{
    juce::String engineUrl { "http://127.0.0.1:8000" };
    bool autoStart = true;
    juce::String python;        // empty = auto-detect
    juce::String backendDir;    // optional: folder containing the `stemforge` package

    static juce::File file();
    static PluginConfig load();
    void save() const;
};

/** Talks to the local StemForge engine over HTTP and can launch it if it isn't running.
    Shared by every plugin instance in the process. */
class EngineClient : private juce::Thread
{
public:
    EngineClient();
    ~EngineClient() override;

    const PluginConfig& config() const   { return cfg; }
    juce::String baseUrl() const         { return cfg.engineUrl.trimCharactersAtEnd ("/"); }

    bool isHealthy() const               { return healthy.load(); }
    juce::String statusMessage() const;
    void requestStart();                  // launch now (ignores autoStart)

    /** Blocking calls: use from background threads only. Return a void var on failure. */
    juce::var getJson (const juce::String& path, juce::String& error, int timeoutMs = 5000) const;
    juce::var postJson (const juce::String& path, const juce::var& body, juce::String& error,
                        int timeoutMs = 600000) const;

private:
    void run() override;
    bool probe() const;
    bool launch();
    juce::String findPython() const;
    void setStatus (const juce::String&);

    PluginConfig cfg;
    std::atomic<bool> healthy { false }, startRequested { false };
    juce::ChildProcess child;
    bool launched = false;
    juce::int64 launchTime = 0;
    mutable juce::CriticalSection statusLock;
    juce::String status { "Connecting to the StemForge engine..." };
};

} // namespace stemforge
