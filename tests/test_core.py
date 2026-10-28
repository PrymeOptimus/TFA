import json

import pytest

from intake_bridge import pdf_extract
from intake_bridge.audit import AuditLog
from intake_bridge.config import load_json_config
from intake_bridge.vault import BadPassphrase


def test_fillable_pdf_extraction(fillable_pdf):
    fields, warnings = pdf_extract.extract(fillable_pdf, load_json_config("field_map.json"))
    assert fields["first_name"] == "Jane"
    assert fields["last_name"] == "Doe"
    assert fields["dob"] == "1985-03-14"
    assert fields["email"] == "jane.doe@example.com"
    assert fields["phone_mobile"] == "(478) 555-0142"
    assert fields["state"] == "GA"
    assert fields["injury_date"] == "2026-10-01"
    assert fields["allergies"] == "Penicillin"
    assert warnings == []


def test_flattened_pdf_extraction(flat_pdf):
    fields, warnings = pdf_extract.extract(flat_pdf, load_json_config("field_map.json"))
    assert fields["first_name"] == "John"
    assert fields["last_name"] == "Smith"
    assert fields["dob"] == "1979-07-04"
    assert fields["email"] == "jsmith@example.com"
    assert fields["address_line1"] == "22 Oak Ave"  # not confused with "Email Address"
    assert fields["city"] == "Warner Robins"
    assert fields["zip"] == "31088"
    assert fields["emergency_contact_name"] == "Mary Smith"
    assert fields["emergency_contact_phone"] == "(478) 555-0100"
    assert fields["case_type"] == "Workers Comp"
    assert fields["claim_number"] == "WC-1234"
    assert warnings == []


def test_missing_required_warns():
    fields = {"first_name": "A", "last_name": "", "dob": "13/45/2000"}
    types = {"dob": "date"}
    w = pdf_extract.validate(pdf_extract.normalize(fields, types), ["first_name", "last_name", "dob"], types)
    assert any("last_name" in x for x in w) and any("dob" in x for x in w)


def test_vault_encrypts_at_rest(svc, fillable_pdf):
    rec = svc.ingest(fillable_pdf, "intake.pdf")
    blob = (svc.settings.vault_dir / f"{rec.id}.bin").read_bytes()
    for plain in (b"Penicillin", b"1985-03-14", b"jane.doe@example.com", b"ReportLab"):
        assert plain not in blob
    svc.lock()
    with pytest.raises(BadPassphrase):
        svc.unlock("wrong passphrase!!")
    svc.unlock("correct horse battery staple")
    assert svc.get(rec.id).fields["last_name"] == "Doe"


def test_audit_has_no_phi_and_detects_tampering(svc, fillable_pdf):
    rec = svc.ingest(fillable_pdf, "intake.pdf")
    svc.update_fields(rec.id, {**rec.fields, "allergies": "None"})
    log = svc.settings.audit_path.read_text()
    for phi in ("Doe", "Penicillin", "1985", "478", "None"):
        assert phi not in log
    ok, n, _ = svc.audit.verify()
    assert ok and n >= 2
    lines = log.splitlines()
    entry = json.loads(lines[0]); entry["detail"] = "edited"
    lines[0] = json.dumps(entry, sort_keys=True)
    svc.settings.audit_path.write_text("\n".join(lines) + "\n")
    assert AuditLog(svc.settings.audit_path).verify()[0] is False


def test_retention_purge(svc, fillable_pdf):
    rec = svc.ingest(fillable_pdf, "intake.pdf")
    rec = svc.vault.get(rec.id)
    rec.created -= 8 * 86400
    svc.vault.save(rec)
    assert svc.vault.purge(0, 7) == [rec.id]
    assert not (svc.settings.vault_dir / f"{rec.id}.bin").exists()


def test_loopback_only(tmp_path, monkeypatch):
    (tmp_path / "settings.json").write_text(json.dumps({"host": "0.0.0.0", "data_dir": str(tmp_path)}))
    from intake_bridge.config import load_settings
    with pytest.raises(ValueError):
        load_settings(tmp_path / "settings.json")


def test_web_requires_unlock_and_csrf(svc, fillable_pdf):
    from intake_bridge.web import create_app

    svc.lock()
    app = create_app(svc)
    c = app.test_client()
    assert c.get("/", base_url="http://localhost").status_code == 302
    assert c.get("/", base_url="http://evil.example").status_code == 403
    c.get("/unlock", base_url="http://localhost")
    with c.session_transaction() as s:
        token = s["csrf"]
    assert c.post("/unlock", data={"passphrase": "correct horse battery staple"},
                  base_url="http://localhost").status_code == 400  # no CSRF
    r = c.post("/unlock", data={"passphrase": "correct horse battery staple", "csrf": token},
               base_url="http://localhost")
    assert r.status_code == 302 and svc.vault.unlocked
    with c.session_transaction() as s:
        token = s["csrf"]
    from io import BytesIO
    r = c.post("/upload", data={"csrf": token, "pdf": (BytesIO(fillable_pdf), "a.pdf")},
               base_url="http://localhost", content_type="multipart/form-data")
    assert r.status_code == 302 and "/record/" in r.headers["Location"]
    page = c.get(r.headers["Location"], base_url="http://localhost")
    assert b"Doe" in page.data and page.headers["Cache-Control"] == "no-store"
