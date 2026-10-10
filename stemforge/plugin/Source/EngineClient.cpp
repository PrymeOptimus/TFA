#include "EngineClient.h"

namespace stemforge
{

// ---------------------------------------------------------------- config
juce::File PluginConfig::file()
{
    return juce::File::getSpecialLocation (juce::File::userHomeDirectory)
        .getChildFile (".stemforge").getChildFile ("plugin.json");
}

PluginConfig PluginConfig::load()
{
    PluginConfig c;
    const auto f = file();
    if (! f.existsAsFile())
    {
        c.save();
        return c;
    }
    const auto v = juce::JSON::parse (f);
    if (auto* o = v.getDynamicObject())
    {
        if (o->hasProperty ("engineUrl"))  c.engineUrl  = o->getProperty ("engineUrl").toString();
        if (o->hasProperty ("autoStart"))  c.autoStart  = (bool) o->getProperty ("autoStart");
        if (o->hasProperty ("python"))     c.python     = o->getProperty ("python").toString();
        if (o->hasProperty ("backendDir")) c.backendDir = o->getProperty ("backendDir").toString();
    }
    return c;
}

void PluginConfig::save() const
{
    auto* o = new juce::DynamicObject();
    o->setProperty ("engineUrl", engineUrl);
    o->setProperty ("autoStart", autoStart);
    o->setProperty ("python", python);
    o->setProperty ("backendDir", backendDir);
    file().getParentDirectory().createDirectory();
    file().replaceWithText (juce::JSON::toString (juce::var (o)));
}

// ---------------------------------------------------------------- client
EngineClient::EngineClient()
    : juce::Thread ("StemForge engine monitor"), cfg (PluginConfig::load())
{
    startRequested.store (cfg.autoStart);
    startThread();
}

EngineClient::~EngineClient()
{
    stopThread (4000);
    // Only stop an engine this process started; a user-run engine keeps running.
    if (launched && child.isRunning())
        child.kill();
}

juce::String EngineClient::statusMessage() const
{
    const juce::ScopedLock sl (statusLock);
    return status;
}

void EngineClient::setStatus (const juce::String& s)
{
    const juce::ScopedLock sl (statusLock);
    status = s;
}

void EngineClient::requestStart()
{
    startRequested.store (true);
    notify();
}

bool EngineClient::probe() const
{
    juce::String err;
    const auto v = getJson ("/api/health", err, 1500);
    return v.getProperty ("ok", false);
}

void EngineClient::run()
{
    while (! threadShouldExit())
    {
        const bool ok = probe();
        healthy.store (ok);

        if (ok)
        {
            setStatus ("Connected to " + baseUrl());
        }
        else if (launched && child.isRunning())
        {
            const auto secs = (juce::Time::currentTimeMillis() - launchTime) / 1000;
            setStatus ("Starting the StemForge engine... (" + juce::String (secs) + "s)");
        }
        else if (launched)
        {
            const auto out = child.readAllProcessOutput().trim();
            setStatus ("The engine exited during start-up. "
                       + (out.isNotEmpty() ? out.getLastCharacters (400) : juce::String ("No output.")));
            launched = false;
            startRequested.store (false);
        }
        else if (startRequested.load())
        {
            launch();
        }
        else
        {
            setStatus ("StemForge engine not reachable at " + baseUrl() + ".");
        }

        wait (ok ? 3000 : 1000);
    }
}

juce::String EngineClient::findPython() const
{
    if (cfg.python.isNotEmpty())
        return cfg.python;

    // DAWs launch plug-ins with a minimal PATH, so check the usual absolute locations first.
   #if JUCE_WINDOWS
    for (auto p : { "C:\\Windows\\py.exe" })
        if (juce::File (p).existsAsFile())
            return p;
    return "python";
   #else
    for (auto p : { "/opt/homebrew/bin/python3", "/usr/local/bin/python3", "/usr/bin/python3" })
        if (juce::File (p).existsAsFile())
            return p;
    return "python3";
   #endif
}

bool EngineClient::launch()
{
    const auto url = juce::URL (baseUrl());
    auto port = url.getPort();
    if (port <= 0)
        port = 8000;

    const auto dataDir = juce::File::getSpecialLocation (juce::File::userHomeDirectory)
                             .getChildFile (".stemforge").getChildFile ("data");

    // ChildProcess can't set a working directory or environment, so do it in Python.
    juce::String script;
    script << "import os, sys\n";
    if (cfg.backendDir.isNotEmpty())
        script << "sys.path.insert(0, " << juce::JSON::toString (cfg.backendDir) << ")\n";
    script << "os.environ.setdefault('STEMFORGE_DATA_DIR', " << juce::JSON::toString (dataDir.getFullPathName()) << ")\n"
           << "sys.argv = ['stemforge', '--port', '" << port << "']\n"
           << "from stemforge.__main__ import main\n"
           << "main()\n";

    const auto python = findPython();
    juce::StringArray args;
   #if JUCE_WINDOWS
    if (python.endsWithIgnoreCase ("py.exe"))
        args.add (python), args.add ("-3");
    else
        args.add (python);
   #else
    args.add (python);
   #endif
    args.add ("-c");
    args.add (script);

    setStatus ("Starting the StemForge engine with " + python + "...");
    launched = child.start (args, juce::ChildProcess::wantStdOut | juce::ChildProcess::wantStdErr);
    launchTime = juce::Time::currentTimeMillis();
    if (! launched)
    {
        setStatus ("Could not run Python (" + python + "). Set \"python\" in " + PluginConfig::file().getFullPathName());
        startRequested.store (false);
    }
    return launched;
}

static juce::var readJson (juce::InputStream* stream, int status, juce::String& error)
{
    if (stream == nullptr)
    {
        error = "Engine unreachable";
        return {};
    }
    const auto text = stream->readEntireStreamAsString();
    auto v = juce::JSON::parse (text);
    if (status >= 400)
    {
        const auto detail = v.getProperty ("detail", juce::var()).toString();
        error = "HTTP " + juce::String (status) + ": " + (detail.isNotEmpty() ? detail : text.substring (0, 200));
        return {};
    }
    return v;
}

juce::var EngineClient::getJson (const juce::String& path, juce::String& error, int timeoutMs) const
{
    int httpStatus = 0;
    auto stream = juce::URL (baseUrl() + path).createInputStream (
        juce::URL::InputStreamOptions (juce::URL::ParameterHandling::inAddress)
            .withConnectionTimeoutMs (timeoutMs)
            .withStatusCode (&httpStatus));
    return readJson (stream.get(), httpStatus, error);
}

juce::var EngineClient::postJson (const juce::String& path, const juce::var& body, juce::String& error,
                                  int timeoutMs) const
{
    int httpStatus = 0;
    auto stream = juce::URL (baseUrl() + path)
                      .withPOSTData (juce::JSON::toString (body, true))
                      .createInputStream (
                          juce::URL::InputStreamOptions (juce::URL::ParameterHandling::inPostData)
                              .withExtraHeaders ("Content-Type: application/json")
                              .withConnectionTimeoutMs (timeoutMs)
                              .withStatusCode (&httpStatus));
    return readJson (stream.get(), httpStatus, error);
}

} // namespace stemforge
