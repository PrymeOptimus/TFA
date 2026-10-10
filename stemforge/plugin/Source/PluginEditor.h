#pragma once

#include "DragDock.h"
#include "PluginProcessor.h"

#include <juce_gui_extra/juce_gui_extra.h>

namespace stemforge
{

/** Hosts the StemForge web UI (served by the local engine) in a WebBrowserComponent,
    bridged to the native player, plus the native drag dock underneath. */
class StemForgeEditor : public juce::AudioProcessorEditor,
                        private juce::Timer
{
public:
    explicit StemForgeEditor (StemForgeProcessor&);
    ~StemForgeEditor() override;

    void paint (juce::Graphics&) override;
    void resized() override;

private:
    using Completion = juce::WebBrowserComponent::NativeFunctionCompletion;
    using Args = juce::Array<juce::var>;

    void timerCallback() override;
    juce::WebBrowserComponent::Options webOptions();
    std::optional<juce::WebBrowserComponent::Resource> serveResource (const juce::String& url);
    static juce::var arg (const Args& a, int i) { return i < a.size() ? a[i] : juce::var(); }

    StemForgeProcessor& proc;
    juce::WebBrowserComponent web;
    DragDock dock;
    bool onEnginePage = false;
    int tick = 0;

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR (StemForgeEditor)
};

} // namespace stemforge
