# Total Fuze Patient Ebook — "Adding Life to Your Years"

Branded, print-ready (US Letter) patient ebook built from `content.md`.

- `dist/total-fuze-patient-guide.pdf` — the ebook (26 pages)
- `dist/total-fuze-patient-guide.html` — same ebook, single self-contained file

## Add photos (8 slots)

Drop files into `images/` with these exact names (`.jpg`, `.png` or `.webp`), then rebuild.
Any slot without a file renders as a marked placeholder frame.

| File | Shot |
|---|---|
| `cover.jpg` | Hero: Dr. Jones with a patient, or the Cherry Street storefront |
| `dr-jones.jpg` | Portrait of Dr. Nissa Jones in the clinic |
| `adjustment.jpg` | Dr. Jones performing an adjustment |
| `decompression.jpg` | AccuSpina decompression table in use |
| `patients.jpg` | Smiling patient (signed photo release required) |
| `front-desk.jpg` | Front desk team greeting a patient |
| `office.jpg` | Exterior or lobby, 419 Cherry Street |
| `team.jpg` | Full team photo |

Landscape, at least 2400px wide. Cover and chapter openers crop to the top ~60% of the page.

## Rebuild

```
pip install markdown
python3 build.py && node render.js   # needs Playwright + Chromium
```

Edit copy in `content.md`, brand colors in the `:root` block of `ebook.css`.
