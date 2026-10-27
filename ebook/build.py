#!/usr/bin/env python3
"""Build the Total Fuze patient ebook: content.md -> dist/total-fuze-patient-guide.html.

Photos: drop files into ebook/images/ using the slot names in PHOTOS below
(e.g. images/dr-jones.jpg). Any slot without a file renders as a marked
placeholder frame. Run render.js afterwards to produce the PDF.
"""
import base64
import html
import mimetypes
import re
from pathlib import Path

import markdown

ROOT = Path(__file__).resolve().parent
IMAGES = ROOT / "images"
FONTS = ROOT / "fonts"
DIST = ROOT / "dist"

# slot -> (what to shoot, alt text)
PHOTOS = {
    "cover": ("Hero shot: Dr. Jones with a patient, or the front of the Cherry Street office",
              "Total Fuze Spine and Pain Center"),
    "dr-jones": ("Portrait of Dr. Nissa Jones in the clinic", "Dr. Nissa Jones"),
    "adjustment": ("Dr. Jones performing an adjustment", "Chiropractic adjustment at Total Fuze"),
    "decompression": ("AccuSpina spinal decompression table in use", "AccuSpina spinal decompression"),
    "patients": ("Smiling patient (with signed photo release)", "A Total Fuze patient"),
    "front-desk": ("Front desk team greeting a patient", "The Total Fuze front desk"),
    "office": ("Exterior or lobby of 419 Cherry Street", "Total Fuze office in downtown Macon"),
    "team": ("Full Total Fuze team photo", "The Total Fuze team"),
}

# Chapter key (first H2 text, or None for the untitled opening section) -> display data
CHAPTERS = [
    (None, "Meet Dr. Jones", "dr-jones",
     "The doctor behind the care, and the promise she makes to every patient."),
    ("What Makes Total Fuze Special", "What Makes Total Fuze Special", "adjustment",
     "Fifteen reasons patients have trusted us since 2002."),
    ("Patient Success Stories", "Patient Success Stories", "patients",
     "Real #totalfuzers, in their own words."),
    ("Your Journey to Wellness Starts Here", "Your Journey to Wellness", "front-desk",
     "What to expect, your role in healing, and how to get started."),
    ("Additional Resources", "Additional Resources", "office",
     "Checklists and questions for your first visit and the weeks after."),
    ("Closing Message", "Welcome to the Family", "team", None),
]

# Inline photos placed right after a given H3 heading
INLINE_PHOTOS = {
    "3. Advanced Technology and Techniques": "decompression",
}


def data_uri(path: Path) -> str:
    mime = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
    return f"data:{mime};base64,{base64.b64encode(path.read_bytes()).decode()}"


def find_photo(slot: str):
    for ext in ("jpg", "jpeg", "png", "webp"):
        p = IMAGES / f"{slot}.{ext}"
        if p.exists():
            return p
    return None


def photo(slot: str, cls: str = "") -> str:
    brief, alt = PHOTOS[slot]
    p = find_photo(slot)
    if p:
        return (f'<figure class="photo {cls}"><img src="{data_uri(p)}" '
                f'alt="{html.escape(alt)}"></figure>')
    return (f'<figure class="photo placeholder {cls}"><div class="ph">'
            f'<span class="ph-tag">Photo</span><span class="ph-brief">{html.escape(brief)}</span>'
            f'<code>images/{slot}.jpg</code></div></figure>')


def font_faces() -> str:
    faces = []
    for f in sorted(FONTS.glob("*.woff2")):
        m = re.match(r"(.+)-latin-(\d+)-(normal|italic)\.woff2", f.name)
        family = {"barlow-condensed": "Barlow Condensed", "barlow": "Barlow",
                  "source-serif-4": "Source Serif 4"}[m.group(1)]
        faces.append(f"@font-face{{font-family:'{family}';font-weight:{m.group(2)};"
                     f"font-style:{m.group(3)};src:url({data_uri(f)}) format('woff2')}}")
    return "\n".join(faces)


def split_chapters(md: str):
    parts = re.split(r"^## (.+)$", md, flags=re.M)
    chunks = {None: parts[0]}
    for i in range(1, len(parts), 2):
        chunks[parts[i].strip()] = parts[i + 1]
    return chunks


def clean(md: str) -> str:
    md = re.sub(r"^---\s*$", "", md, flags=re.M)
    # Python-Markdown needs a blank line before a list that follows a paragraph
    md = re.sub(r"^((?![-\d]).+\S.*)\n(- |\d+\. )", r"\1\n\n\2", md, flags=re.M)
    return md.strip()


QUOTE_RE = re.compile(r'<p><em>["“](.+?)["”]</em>(?:\s*-\s*(.+?))?</p>', re.S)


def enhance(body: str) -> str:
    # Testimonials -> pull quotes
    def quote(m):
        cite = f"<cite>{m.group(2)}</cite>" if m.group(2) else ""
        return f'<blockquote class="quote"><p>{m.group(1)}</p>{cite}</blockquote>'
    body = QUOTE_RE.sub(quote, body)

    # Numbered reasons
    body = re.sub(r"<h3>(\d+)\. (.+?)</h3>",
                  r'<h3 class="reason"><span class="num">\1</span><span>\2</span></h3>', body)

    # Story headings "Name - Outcome"
    body = re.sub(r"<h3>([^<]+?) - ([^<]+?)</h3>",
                  r'<h3 class="story"><span class="who">\1</span>\2</h3>', body)

    # Contact card
    body = body.replace("<p><strong>Total Fuze Spine and Pain Center</strong>",
                        '<p class="contact"><strong>Total Fuze Spine and Pain Center</strong>')

    # Wrap each H3 run in a section; mark sections of bold-led paragraphs as grids
    pieces = re.split(r"(?=<h3)", body)
    out = []
    for piece in pieces:
        if not piece.strip():
            continue
        if not piece.startswith("<h3"):
            out.append(f'<div class="lede">{piece}</div>')
            continue
        heading = re.match(r"<h3[^>]*>(.*?)</h3>", piece, re.S).group(1)
        plain = re.sub(r"<[^>]+>", "", heading)
        cls = "sub"
        if piece.count("<p><strong>") >= 3:
            cls += " grid"
        if 'class="story"' in piece:
            cls += " story-card"
        for key, slot in INLINE_PHOTOS.items():
            if plain.replace(" ", " ") == key.split(". ", 1)[1] or plain == key:
                piece = re.sub(r"(</h3>)", r"\1" + photo(slot, "inline"), piece, count=1)
        out.append(f'<section class="{cls}">{piece}</section>')
    return "\n".join(out)


def to_html(md: str) -> str:
    md = md.replace("’", "'")
    return enhance(markdown.markdown(clean(md), extensions=["sane_lists"]))


def build():
    chunks = split_chapters((ROOT / "content.md").read_text())

    # Split the back-matter (disclaimer, address, copyright) off the closing chapter
    closing_parts = re.split(r"^---\s*$", chunks["Closing Message"], flags=re.M)
    chunks["Closing Message"] = closing_parts[0]
    disclaimer = markdown.markdown(closing_parts[1].strip().split("\n\n")[0])
    copyright_line = re.sub(r"\*", "", closing_parts[-1]).strip()

    toc, chapters = [], []
    for n, (key, title, slot, dek) in enumerate(CHAPTERS, 1):
        cid = f"ch{n}"
        toc.append(f'<li><a href="#{cid}"><span class="toc-n">{n}</span>'
                   f'<span class="toc-t">{title}</span></a>'
                   + (f'<span class="toc-d">{dek}</span>' if dek else "") + "</li>")
        chapters.append(f"""
<section class="chapter" id="{cid}">
  <header class="opener">
    {photo(slot, "opener-photo")}
    <div class="opener-text">
      <span class="eyebrow">Chapter {n}</span>
      <h1>{title}</h1>
      {f'<p class="dek">{dek}</p>' if dek else ''}
    </div>
  </header>
  <div class="body">{to_html(chunks[key])}</div>
</section>""")

    css = (ROOT / "ebook.css").read_text()
    page = f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>Adding Life to Your Years</title>
<style>{font_faces()}
{css}</style></head>
<body>
<section class="cover">
  {photo("cover", "cover-photo")}
  <div class="cover-band">
    <div class="wordmark"><span>Total Fuze</span><small>Spine &amp; Pain Center</small></div>
    <h1>Adding Life to<br>Your Years</h1>
    <p class="cover-sub">A patient's guide to care at Total Fuze, with Dr. Nissa Jones</p>
    <p class="cover-meta">Macon, Georgia · Serving our community since 2002</p>
  </div>
</section>

<section class="toc">
  <span class="eyebrow">Inside this guide</span>
  <h1>Contents</h1>
  <ol>{''.join(toc)}</ol>
  <div class="toc-call">
    <span>Ready now?</span>
    <strong>(478) 746-7246</strong>
    <span>746-PAIN · totalfuze.com</span>
  </div>
</section>

{''.join(chapters)}

<section class="back">
  <div class="back-inner">
    <div class="wordmark light"><span>Total Fuze</span><small>Spine &amp; Pain Center</small></div>
    <p class="back-tag">Adding Life to Your Years</p>
    <dl class="back-contact">
      <div><dt>Visit</dt><dd>419 Cherry Street<br>Macon, GA 31201</dd></div>
      <div><dt>Call</dt><dd>(478) 746-7246<br>746-PAIN</dd></div>
      <div><dt>Book</dt><dd>www.totalfuze.com</dd></div>
    </dl>
    <p class="hashtag">#totalfuzers</p>
    <div class="fine">{disclaimer}<p>{copyright_line}</p></div>
  </div>
</section>
</body></html>"""
    DIST.mkdir(exist_ok=True)
    out = DIST / "total-fuze-patient-guide.html"
    out.write_text(page)
    missing = [s for s in PHOTOS if not find_photo(s)]
    print(f"wrote {out}")
    if missing:
        print("placeholder photo slots:", ", ".join(missing))


if __name__ == "__main__":
    build()
