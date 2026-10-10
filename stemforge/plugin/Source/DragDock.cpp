#include "DragDock.h"

namespace stemforge
{

juce::Colour colourForSlot (int slot)
{
    // Matches the --c-* stem colours in frontend/styles.css.
    static const juce::uint32 colours[] = {
        0xffff4d8d, 0xffff8a3d, 0xffffc93d, 0xff7c5cff, 0xff3dd6ff, 0xff2f9bff,
        0xff6fe3d0, 0xff4dff9a, 0xffc45cff, 0xffff6b5c, 0xffb8c2d6, 0xff6b7487
    };
    return juce::isPositiveAndBelow (slot, kNumSlots) ? juce::Colour (colours[slot]) : juce::Colour (0xffff8a3d);
}

DragDock::DragDock (StemForgeProcessor& p) : proc (p)
{
    proc.addChangeListener (this);
    rebuild();
}

DragDock::~DragDock()
{
    proc.removeChangeListener (this);
}

void DragDock::changeListenerCallback (juce::ChangeBroadcaster*)
{
    rebuild();
}

void DragDock::rebuild()
{
    tiles.clear();
    for (const auto& f : proc.dragFiles())
        if (juce::File (f.path).existsAsFile())
            addAndMakeVisible (tiles.add (new Tile (f)));

    const auto st = proc.stateJson();
    const double bpm = st.getProperty ("renderBpm", 0.0);
    caption = tiles.isEmpty() ? juce::String ("Separated stems appear here - drag them into your DAW")
                              : "Drag into your DAW  -  " + juce::String (bpm, juce::approximatelyEqual (bpm, std::floor (bpm)) ? 0 : 2) + " BPM"
                                    + ((bool) st.getProperty ("stretched", false) ? "  (synced)" : "");
    resized();
    repaint();
}

void DragDock::paint (juce::Graphics& g)
{
    g.fillAll (juce::Colour (0xff11141b));
    g.setColour (juce::Colour (0xff262c39));
    g.drawHorizontalLine (0, 0.0f, (float) getWidth());
    g.setColour (juce::Colour (0xff8b93a7));
    g.setFont (juce::FontOptions (12.0f));
    g.drawText (caption, getLocalBounds().removeFromLeft (230).reduced (12, 0), juce::Justification::centredLeft, true);
}

void DragDock::resized()
{
    auto area = getLocalBounds().reduced (8, 9);
    area.removeFromLeft (230);
    if (tiles.isEmpty())
        return;
    const int gap = 6;
    const int w = juce::jlimit (64, 150, (area.getWidth() - gap * (tiles.size() - 1)) / tiles.size());
    for (auto* t : tiles)
    {
        t->setBounds (area.removeFromLeft (w));
        area.removeFromLeft (gap);
    }
}

void DragDock::Tile::paint (juce::Graphics& g)
{
    const auto c = colourForSlot (file.slot);
    auto r = getLocalBounds().toFloat().reduced (0.5f);
    g.setColour (c.withAlpha (isMouseOver() ? 0.28f : 0.14f));
    g.fillRoundedRectangle (r, 7.0f);
    g.setColour (c.withAlpha (0.8f));
    g.drawRoundedRectangle (r, 7.0f, 1.0f);
    g.fillRoundedRectangle (r.removeFromLeft (4.0f).reduced (0, 6), 2.0f);
    g.setColour (juce::Colour (0xffe8ebf2));
    g.setFont (juce::FontOptions (12.5f, juce::Font::bold));
    g.drawFittedText (file.label, getLocalBounds().reduced (10, 2), juce::Justification::centred, 2);
}

void DragDock::Tile::mouseDrag (const juce::MouseEvent& e)
{
    if (! dragging && e.getDistanceFromDragStart() > 4)
    {
        dragging = true;
        startExternalDrag (file.path, this);
    }
}

void DragDock::startExternalDrag (const juce::String& path, juce::Component* source)
{
    if (! juce::File (path).existsAsFile())
        return;
    juce::DragAndDropContainer::performExternalDragDropOfFiles ({ path }, false, source);
}

} // namespace stemforge
