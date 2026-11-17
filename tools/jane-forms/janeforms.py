"""Fill in-house PDF forms from Jane patient data.

  janeforms.py fields FORM.pdf               list a form's fillable fields + write a starter map
  janeforms.py grid FORM.pdf                 write FORM.grid.pdf with a coordinate grid (for flat forms)
  janeforms.py fill MAP.yaml DATA [--out D]  fill the form for each patient in DATA (.csv or .json)

A map (YAML) says which patient value goes where:

  form: Intake.pdf
  output: "{Last Name}_{First Name}_Intake.pdf"
  flatten: true                     # lock the filled values into the page
  fields:                           # fillable forms: PDF field name -> value
    PatientName: "{First Name} {Last Name}"
    DOB: {value: "{Date of Birth}", date: "%m/%d/%Y"}
    Male: {checked_if: "{Sex}", equals: "Male"}
  overlay:                          # flat/scanned forms: draw text at x,y (points, from bottom-left)
    - {page: 1, x: 120, y: 690, size: 10, value: "{Phone}"}

Values use {Column Name} from the Jane export (or capture). Missing values print blank.
Patient data stays on this computer: nothing is uploaded anywhere.
"""

import argparse
import csv
import io
import json
import re
import sys
from datetime import datetime
from pathlib import Path

import yaml
from pypdf import PdfReader, PdfWriter
from pypdf.generic import NameObject

DATE_INPUTS = ["%Y-%m-%d", "%m/%d/%Y", "%m/%d/%y", "%b %d, %Y", "%B %d, %Y", "%d %b %Y", "%Y-%m-%dT%H:%M:%S"]


class Blank(dict):
    def __missing__(self, key):
        return ""


def render(template, row):
    return str(template).format_map(Blank(row)).strip()


def reformat_date(text, fmt):
    for f in DATE_INPUTS:
        try:
            return datetime.strptime(text.strip(), f).strftime(fmt)
        except ValueError:
            continue
    return text  # unrecognised: keep as written rather than guess


def field_value(spec, row):
    """Return (kind, value) for one map entry: kind is 'text' or 'check'."""
    if isinstance(spec, dict):
        if "checked_if" in spec:
            actual = render(spec["checked_if"], row).lower()
            wanted = spec.get("equals")
            on = actual in {str(w).lower() for w in (wanted if isinstance(wanted, list) else [wanted])} \
                if wanted is not None else actual in {"yes", "true", "1", "x", "y"}
            return "check", on
        text = render(spec.get("value", ""), row)
        if text and spec.get("date"):
            text = reformat_date(text, spec["date"])
        if spec.get("upper"):
            text = text.upper()
        return "text", text
    return "text", render(spec, row)


def load_rows(path):
    path = Path(path)
    if path.suffix.lower() == ".csv":
        with open(path, newline="", encoding="utf-8-sig") as f:
            return [{k.strip(): (v or "").strip() for k, v in r.items() if k} for r in csv.DictReader(f)]
    data = json.loads(path.read_text(encoding="utf-8-sig"))
    return data if isinstance(data, list) else [data]


def widget_on_states(reader):
    """{field name: on-state} read from each checkbox widget's appearance (e.g. /Yes_xsa)."""
    states = {}
    for page in reader.pages:
        for a in page.get("/Annots") or []:
            a = a.get_object()
            parent = a.get("/Parent")
            name = a.get("/T") or (parent.get_object().get("/T") if parent else None)
            normal = (a.get("/AP") or {}).get("/N")
            if name is not None and hasattr(normal, "keys"):
                on = [k for k in normal.keys() if k != "/Off"]
                if on:
                    states.setdefault(str(name), str(on[0]))
    return states


def form_fields(reader):
    """{name: {"type": "text"|"checkbox"|"radio"|"choice", "on": on-state}}"""
    out = {}
    widget_states = None
    for name, f in (reader.get_fields() or {}).items():
        ft = f.get("/FT")
        kind = {"/Tx": "text", "/Ch": "choice", "/Sig": "signature"}.get(ft, "text")
        on = None
        if ft == "/Btn":
            kind = "radio" if int(f.get("/Ff", 0)) & (1 << 15) else "checkbox"
            states = [s for s in (f.get("/_States_") or []) if s != "/Off"]
            if not states:
                widget_states = widget_states if widget_states is not None else widget_on_states(reader)
                states = [widget_states[str(name)]] if str(name) in widget_states else []
            on = str(states[0]) if states else "/Yes"
        out[str(name)] = {"type": kind, "on": on}
    return out


def apply_aliases(row, aliases):
    """Fill each standard column from the first alternative header present in the export."""
    row = dict(row)
    for standard, alternatives in (aliases or {}).items():
        if not row.get(standard):
            for alt in alternatives or []:
                if row.get(alt):
                    row[standard] = row[alt]
                    break
    return row


def overlay_pdf(items, reader, row):
    """One overlay page per form page, with the overlay text drawn on it."""
    from reportlab.pdfgen import canvas

    buf = io.BytesIO()
    first = reader.pages[0].mediabox
    c = canvas.Canvas(buf, pagesize=(float(first.width), float(first.height)))
    for n, page in enumerate(reader.pages, start=1):
        c.setPageSize((float(page.mediabox.width), float(page.mediabox.height)))
        for it in (i for i in items if int(i.get("page", 1)) == n):
            kind, val = field_value(it, row)
            text = "X" if kind == "check" and val else (val if kind == "text" else "")
            if text:
                c.setFont(it.get("font", "Helvetica"), float(it.get("size", 10)))
                c.drawString(float(it["x"]), float(it["y"]), text)
        c.showPage()
    c.save()
    buf.seek(0)
    return PdfReader(buf)


def fill(mapping, row, base_dir):
    form = Path(mapping["form"])
    if not form.is_absolute():
        form = base_dir / form
    reader = PdfReader(str(form))
    writer = PdfWriter(clone_from=reader)
    fields = form_fields(reader)
    unknown = []
    text_values, checks = {}, {}
    for name, spec in (mapping.get("fields") or {}).items():
        if name not in fields:
            unknown.append(name)
            continue
        kind, val = field_value(spec, row)
        if fields[name]["type"] in ("checkbox", "radio"):
            on = val if kind == "check" else bool(val)
            checks[name] = fields[name]["on"] if on else "/Off"
        else:
            text_values[name] = val if kind == "text" else ("X" if val else "")
    if text_values or checks:
        values = {**text_values, **checks}
        writer.update_page_form_field_values(None, values, auto_regenerate=False,
                                             flatten=bool(mapping.get("flatten")))
        writer.set_need_appearances_writer(True)
    if mapping.get("overlay"):
        over = overlay_pdf(mapping["overlay"], reader, row)
        for page, extra in zip(writer.pages, over.pages):
            page.merge_page(extra)
    return writer, unknown


def safe_filename(name):
    return re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", name).strip(" .") or "form.pdf"


def cmd_fields(args):
    reader = PdfReader(args.form)
    fields = form_fields(reader)
    if not fields:
        print("No fillable fields: this is a flat form. Use 'grid' to find x/y positions for an overlay map.")
    for name, f in fields.items():
        print("%-40s %s" % (name, f["type"]))
    starter = {"form": Path(args.form).name, "output": "{Last Name}_{First Name}_%s.pdf" % Path(args.form).stem,
               "flatten": True,
               "fields": {n: ({"checked_if": "{Column}", "equals": "Yes"} if f["type"] in ("checkbox", "radio") else "")
                          for n, f in fields.items() if f["type"] != "signature"}}
    if not fields:
        starter.pop("fields")
        starter["overlay"] = [{"page": 1, "x": 100, "y": 700, "size": 10, "value": "{First Name} {Last Name}"}]
    out = Path(args.form).with_suffix(".map.yaml")
    if out.exists() and not args.force:
        print("\n%s already exists (use --force to overwrite)." % out)
    else:
        out.write_text(yaml.safe_dump(starter, sort_keys=False, allow_unicode=True), encoding="utf-8")
        print("\nStarter map written: %s. Fill in the {Column} names from your Jane export." % out)
    return 0


def cmd_grid(args):
    from reportlab.pdfgen import canvas

    reader = PdfReader(args.form)
    buf = io.BytesIO()
    c = canvas.Canvas(buf)
    for page in reader.pages:
        w, h = float(page.mediabox.width), float(page.mediabox.height)
        c.setPageSize((w, h))
        c.setFont("Helvetica", 6)
        for x in range(0, int(w), 25):
            c.setStrokeColorRGB(1, 0, 0) if x % 100 == 0 else c.setStrokeColorRGB(1, 0.75, 0.75)
            c.line(x, 0, x, h)
            if x % 50 == 0:
                c.drawString(x + 1, 2, str(x))
        for y in range(0, int(h), 25):
            c.setStrokeColorRGB(0, 0, 1) if y % 100 == 0 else c.setStrokeColorRGB(0.75, 0.75, 1)
            c.line(0, y, w, y)
            if y % 50 == 0:
                c.drawString(2, y + 1, str(y))
        c.showPage()
    c.save()
    buf.seek(0)
    writer = PdfWriter(clone_from=reader)
    for page, grid in zip(writer.pages, PdfReader(buf).pages):
        page.merge_page(grid)
    out = Path(args.form).with_suffix(".grid.pdf")
    with open(out, "wb") as f:
        writer.write(f)
    print("Grid written: %s (x across the bottom, y up the left side, in points)." % out)
    return 0


def cmd_fill(args):
    map_path = Path(args.map)
    mapping = yaml.safe_load(map_path.read_text(encoding="utf-8"))
    columns = map_path.parent / "columns.yaml"
    aliases = yaml.safe_load(columns.read_text(encoding="utf-8")) if columns.exists() else {}
    today = datetime.now().strftime("%m/%d/%Y")
    rows = [apply_aliases({"Today": today, **r}, aliases) for r in load_rows(args.data)]
    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    warned = False
    for i, row in enumerate(rows, start=1):
        writer, unknown = fill(mapping, row, map_path.parent)
        if unknown and not warned:
            print("WARNING: map names fields the PDF doesn't have: %s" % ", ".join(unknown))
            warned = True
        name = safe_filename(render(mapping.get("output", "form_{n}.pdf"), {**row, "n": i}))
        if not name.lower().endswith(".pdf"):
            name += ".pdf"
        target = out_dir / name
        n = 2
        while target.exists() and not args.overwrite:
            target = out_dir / ("%s (%d).pdf" % (name[:-4], n))
            n += 1
        with open(target, "wb") as f:
            writer.write(f)
        print("Wrote %s" % target)
    print("%d form(s) filled." % len(rows))
    return 0


def main(argv=None):
    p = argparse.ArgumentParser(prog="janeforms", description="Fill in-house PDF forms from Jane patient data.")
    sub = p.add_subparsers(dest="cmd", required=True)
    f = sub.add_parser("fields", help="list a form's fields and write a starter map")
    f.add_argument("form")
    f.add_argument("--force", action="store_true")
    g = sub.add_parser("grid", help="draw a coordinate grid on a flat form")
    g.add_argument("form")
    fl = sub.add_parser("fill", help="fill a form for each patient in a CSV/JSON file")
    fl.add_argument("map")
    fl.add_argument("data")
    fl.add_argument("--out", default="filled")
    fl.add_argument("--overwrite", action="store_true")
    args = p.parse_args(argv)
    try:
        return {"fields": cmd_fields, "grid": cmd_grid, "fill": cmd_fill}[args.cmd](args)
    except FileNotFoundError as e:
        print("Not found: %s" % e.filename, file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
