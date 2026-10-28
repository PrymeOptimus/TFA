"""Turn an ALOHA intake PDF into canonical intake fields.

Two strategies, merged:
  1. Fillable AcroForm fields (exact field names -> canonical keys via field_map.json)
  2. Flattened text: "Label: value" patterns (labels -> canonical keys via field_map.json)
AcroForm values win when both are present."""
from __future__ import annotations

import io
import re
from datetime import datetime

from pypdf import PdfReader

DATE_FORMATS = ("%m/%d/%Y", "%m/%d/%y", "%m-%d-%Y", "%Y-%m-%d", "%B %d, %Y", "%b %d, %Y")


def read_pdf(data: bytes) -> tuple[dict[str, str], str]:
    """Return (acroform_fields, full_text). Nothing is written to disk."""
    reader = PdfReader(io.BytesIO(data))
    if reader.is_encrypted:
        reader.decrypt("")
    form: dict[str, str] = {}
    for name, f in (reader.get_fields() or {}).items():
        v = f.get("/V")
        if v is None:
            continue
        v = str(v)
        if v in ("/Off", "Off", ""):
            continue
        if v.startswith("/"):  # checkbox / radio export value e.g. /Yes
            v = v[1:]
        form[name.strip()] = v.strip()
    text = "\n".join((p.extract_text() or "") for p in reader.pages)
    return form, text


def extract_text_fields(text: str, label_map: dict[str, list[str]]) -> dict[str, str]:
    """Tokenize the text on every known "Label:" occurrence. A value runs from its
    label to the next known label or end of line. Scanning left-to-right with
    longest labels first means "Email Address:" is never misread as "Address:"."""
    label_to_key: dict[str, str] = {}
    priority: dict[str, int] = {}
    for key, labels in label_map.items():
        for i, lab in enumerate(labels):
            label_to_key.setdefault(lab.lower(), key)
            priority.setdefault(lab.lower(), i)
    if not label_to_key:
        return {}
    alts = sorted(label_to_key, key=len, reverse=True)
    pat = re.compile(
        r"(?<![A-Za-z])(" + "|".join(re.escape(a).replace(r"\ ", r"[ \t]+") for a in alts) + r")[ \t]*[:#]",
        re.IGNORECASE,
    )
    found: dict[str, tuple[int, str]] = {}
    for line in text.splitlines():
        matches = list(pat.finditer(line))
        for i, m in enumerate(matches):
            end = matches[i + 1].start() if i + 1 < len(matches) else len(line)
            value = line[m.end():end].strip(" _\t")
            lab = re.sub(r"\s+", " ", m.group(1)).lower()
            key = label_to_key[lab]
            if value and (key not in found or priority[lab] < found[key][0]):
                found[key] = (priority[lab], value)
    return {k: v for k, (_, v) in found.items()}


def map_form_fields(form: dict[str, str], form_map: dict[str, list[str]]) -> dict[str, str]:
    lower = {k.lower(): v for k, v in form.items()}
    out = {}
    for key, names in form_map.items():
        for n in names:
            if n.lower() in lower:
                out[key] = lower[n.lower()]
                break
    return out


# ---- normalization -------------------------------------------------------
def norm_date(v: str) -> str:
    v = v.strip()
    for fmt in DATE_FORMATS:
        try:
            return datetime.strptime(v, fmt).strftime("%Y-%m-%d")
        except ValueError:
            pass
    return v


def norm_phone(v: str) -> str:
    d = re.sub(r"\D", "", v)
    if len(d) == 11 and d.startswith("1"):
        d = d[1:]
    return f"({d[:3]}) {d[3:6]}-{d[6:]}" if len(d) == 10 else v.strip()


NORMALIZERS = {
    "date": norm_date,
    "phone": norm_phone,
    "email": lambda v: v.strip().lower(),
    "upper": lambda v: v.strip().upper(),
    "title": lambda v: v.strip().title() if v.isupper() or v.islower() else v.strip(),
    "zip": lambda v: (re.search(r"\d{5}(-\d{4})?", v) or [v.strip()])[0],
}


def normalize(fields: dict[str, str], types: dict[str, str]) -> dict[str, str]:
    out = {}
    for k, v in fields.items():
        fn = NORMALIZERS.get(types.get(k, ""))
        out[k] = fn(v) if fn else v.strip()
    return out


def validate(fields: dict[str, str], required: list[str], types: dict[str, str]) -> list[str]:
    warnings = [f"Missing required field: {k}" for k in required if not fields.get(k)]
    for k, t in types.items():
        v = fields.get(k)
        if not v:
            continue
        if t == "date" and not re.fullmatch(r"\d{4}-\d{2}-\d{2}", v):
            warnings.append(f"{k}: could not parse date '{v}'")
        if t == "email" and not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", v):
            warnings.append(f"{k}: email looks invalid")
        if t == "phone" and not re.fullmatch(r"\(\d{3}\) \d{3}-\d{4}", v):
            warnings.append(f"{k}: phone looks invalid")
    return warnings


def extract(data: bytes, field_map: dict) -> tuple[dict[str, str], list[str]]:
    form, text = read_pdf(data)
    fields = extract_text_fields(text, field_map.get("text_labels", {}))
    fields.update(map_form_fields(form, field_map.get("form_fields", {})))
    types = field_map.get("types", {})
    fields = normalize(fields, types)
    for k in field_map.get("canonical_fields", []):
        fields.setdefault(k, "")
    warnings = validate(fields, field_map.get("required", []), types)
    if not form and not text.strip():
        warnings.append("PDF has no form fields and no extractable text (scanned image?). Enter fields manually.")
    return fields, warnings


def inspect(data: bytes) -> dict:
    """Debug view used to build field_map.json from a sample ALOHA export.
    Prints PHI to the local terminal only; use with a test/dummy patient."""
    form, text = read_pdf(data)
    return {"form_fields": form, "text": text}
