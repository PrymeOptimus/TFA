"""Generate StemForge.amxd (Max for Live audio effect) from code.

Run: python build_device.py   -> writes StemForge.amxd next to this file.
"""

import json
import struct
from pathlib import Path

HERE = Path(__file__).resolve().parent
boxes, lines = [], []


def box(maxclass, rect, text=None, inlets=1, outlets=0, outlettype=None, present=None, **attrs):
    """Add a box; present=[x, y, w, h] also shows it on the device face."""
    bid = "obj-%d" % (len(boxes) + 1)
    b = {"id": bid, "maxclass": maxclass, "numinlets": inlets, "numoutlets": outlets,
         "patching_rect": [float(v) for v in rect]}
    if outlettype is not None:
        b["outlettype"] = outlettype
    if text is not None:
        b["text"] = text
    if present is not None:
        b["presentation"] = 1
        b["presentation_rect"] = [float(v) for v in present]
    b.update(attrs)
    boxes.append({"box": b})
    return bid


def obj(text, rect, inlets=1, outlets=1, outlettype=None):
    return box("newobj", rect, text, inlets, outlets, outlettype or [""] * outlets)


def wire(src, dst, outlet=0, inlet=0):
    lines.append({"patchline": {"source": [src, outlet], "destination": [dst, inlet]}})


def label(text, rect, present):
    return box("comment", rect, text, 1, 0, present=present)


# audio passes straight through: the device is a tool, not an effect
pin = obj("plugin~", [20, 20, 60, 22], 1, 2, ["signal", "signal"])
pout = obj("plugout~", [20, 300, 60, 22], 2, 0)
wire(pin, pout, 0, 0)
wire(pin, pout, 1, 1)

runner = obj("node.script stemforge-runner.js @autostart 1 @watch 0", [200, 300, 330, 22], 1, 2)
live = obj("js stemforge-live.js", [200, 400, 130, 22], 1, 1)
route = obj("route status", [200, 340, 80, 22], 1, 2)
setter = obj("prepend set", [200, 370, 75, 22])
defer = obj("deferlow", [300, 370, 60, 22])
wire(runner, route)
wire(route, setter, 0)
wire(route, defer, 1)
wire(defer, live)

status = box("message", [200, 440, 330, 22], "", 2, 1, [""], present=[4, 96, 316, 50],
             bgcolor=[0.13, 0.13, 0.13, 1.0], textcolor=[0.85, 0.85, 0.85, 1.0], fontsize=10.0)
wire(setter, status)
wire(live, status)

drop = box("live.drop", [200, 20, 120, 60], None, 1, 2, ["", ""], present=[4, 4, 120, 86],
           parameter_enable=0)
wire(drop, obj("prepend file", [200, 90, 75, 22]))
wire(boxes[-1]["box"]["id"], runner)


def menu(name, items, rect, present):
    ui = box("umenu", rect, None, 1, 3, ["int", "", ""], present=present,
             items=sum(([i, ","] for i in items), [])[:-1], parameter_enable=0)
    pre = obj("prepend %s" % name, [rect[0], rect[1] + 30, 90, 22])
    wire(ui, pre)
    wire(pre, runner)
    return ui


label("Stems", [340, 20, 40, 18], [130, 4, 40, 18])
menu("mode", ["4 Stems", "6 Stems", "Vocals + Inst"], [340, 40, 100, 22], [172, 4, 88, 20])
label("Quality", [340, 100, 50, 18], [130, 28, 44, 18])
menu("quality", ["Auto", "Fast (CPU)", "Best (GPU)"], [340, 120, 100, 22], [172, 28, 88, 20])


def toggle(name, text, rect, present):
    ui = box("toggle", rect, None, 1, 1, ["int"], present=present, parameter_enable=0)
    pre = obj("prepend %s" % name, [rect[0], rect[1] + 30, 90, 22])
    wire(ui, pre)
    wire(pre, runner)
    label(text, [rect[0] + 22, rect[1], 70, 18], [present[0] + 18, present[1] - 1, 60, 18])
    return ui


lyr = toggle("lyrics", "Lyrics", [460, 40, 18, 18], [132, 54, 16, 16])
tmp = toggle("tempo", "Set tempo", [460, 100, 18, 18], [196, 54, 16, 16])

# both toggles start on (the runner defaults match)
loaded = obj("live.thisdevice", [600, 20, 85, 22], 1, 3, ["bang", "int", "int"])
one = box("message", [600, 50, 30, 22], "1", 2, 1, [""])
wire(loaded, one)
box_set = obj("prepend set", [600, 80, 75, 22])
wire(one, box_set)
wire(box_set, lyr)
wire(box_set, tmp)

for i, (cmd, caption) in enumerate((("split", "Split"), ("cancel", "Cancel"), ("reveal", "Open folder"))):
    btn = box("textbutton", [700, 40 + 40 * i, 80, 22], caption, 1, 3, ["", "", "int"],
              present=[264, 4 + 26 * i, 56, 22], parameter_enable=0)
    msg = box("message", [790, 40 + 40 * i, 50, 22], cmd, 2, 1, [""])
    wire(btn, msg)
    wire(msg, runner)

patcher = {
    "patcher": {
        "fileversion": 1,
        "appversion": {"major": 8, "minor": 6, "revision": 0, "architecture": "x64", "modernui": 1},
        "classnamespace": "box",
        "rect": [100.0, 100.0, 900.0, 520.0],
        "openrect": [0.0, 0.0, 324.0, 169.0],
        "openinpresentation": 1,
        "default_fontsize": 10.0,
        "default_fontname": "Arial",
        "gridsize": [8.0, 8.0],
        "devicewidth": 324.0,
        "description": "StemForge: split a song into stems (RoFormer + Demucs), detect tempo and key, "
                       "transcribe lyrics, and load the stems as new tracks.",
        "boxes": boxes,
        "lines": lines,
        "dependency_cache": [
            {"name": n, "bootpath": ".", "type": "TEXT", "implicit": 1}
            for n in ("stemforge-runner.js", "stemforge-live.js")
        ],
        "autosave": 0,
    }
}


def write(path=HERE / "StemForge.amxd"):
    body = (json.dumps(patcher, indent=1) + "\n").encode("utf-8") + b"\x00"
    header = b"ampf" + struct.pack("<I", 4) + b"aaaa" + b"meta" + struct.pack("<I", 4) + b"\x00" * 4
    header += b"ptch" + struct.pack("<I", len(body))
    path.write_bytes(header + body)
    return path


if __name__ == "__main__":
    print("Wrote %s (%d boxes, %d cords)" % (write(), len(boxes), len(lines)))
