#pragma once

#include "PluginProcessor.h"

#include <juce_gui_basics/juce_gui_basics.h>

namespace stemforge
{

juce::Colour colourForSlot (int slot);

/** Native strip of stem tiles. Dragging a tile performs an OS-level file drag, so it
    drops straight onto a DAW track as audio — at the tempo currently loaded (the DAW
    tempo when Sync + Stretch are on). Works in every host, unlike drags started from
    inside a web view. */
class DragDock : public juce::Component,
                 private juce::ChangeListener
{
public:
    explicit DragDock (StemForgeProcessor&);
    ~DragDock() override;

    void paint (juce::Graphics&) override;
    void resized() override;

    static void startExternalDrag (const juce::String& path, juce::Component* source);

private:
    class Tile : public juce::Component
    {
    public:
        explicit Tile (DragFile f) : file (std::move (f)) { setMouseCursor (juce::MouseCursor::DraggingHandCursor); }
        void paint (juce::Graphics&) override;
        void mouseDrag (const juce::MouseEvent&) override;
        void mouseUp (const juce::MouseEvent&) override  { dragging = false; }
        void mouseEnter (const juce::MouseEvent&) override { repaint(); }
        void mouseExit (const juce::MouseEvent&) override  { repaint(); }
        DragFile file;
        bool dragging = false;
    };

    void changeListenerCallback (juce::ChangeBroadcaster*) override;
    void rebuild();

    StemForgeProcessor& proc;
    juce::OwnedArray<Tile> tiles;
    juce::String caption;
};

} // namespace stemforge
