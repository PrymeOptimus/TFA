import io
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

# All test data is fictitious.
PATIENT = {
    "First Name": "JANE", "Last Name": "DOE", "Date of Birth": "03/14/1985", "Sex": "Female",
    "Email": "Jane.Doe@Example.com", "Cell Phone": "478.555.0142", "Address": "100 Main St",
    "City": "Macon", "State": "ga", "Zip": "31201", "Chief Complaint": "Low back pain after MVA",
    "Date of Accident": "10/01/2026", "Allergies": "Penicillin",
}


@pytest.fixture
def fillable_pdf() -> bytes:
    from reportlab.lib.pagesizes import letter
    from reportlab.pdfgen import canvas

    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=letter)
    y = 740
    for name, value in PATIENT.items():
        c.drawString(40, y + 4, name)
        c.acroForm.textfield(name=name, value=value, x=200, y=y, width=300, height=18)
        y -= 26
    c.save()
    return buf.getvalue()


@pytest.fixture
def flat_pdf() -> bytes:
    from reportlab.lib.pagesizes import letter
    from reportlab.pdfgen import canvas

    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=letter)
    lines = [
        "ALOHA Patient Intake",
        "First Name: John     Last Name: Smith",
        "Date of Birth: 7/4/1979   Sex: Male",
        "Email Address: jsmith@example.com",
        "Street Address: 22 Oak Ave   City: Warner Robins   State: GA   Zip Code: 31088",
        "Cell Phone: 478-555-0199",
        "Emergency Contact Name: Mary Smith   Emergency Contact Phone: 4785550100",
        "Chief Complaint: Neck pain",
        "Case Type: Workers Comp   Date of Injury: 09/15/2026   Claim Number: WC-1234",
    ]
    y = 740
    for line in lines:
        c.drawString(40, y, line)
        y -= 20
    c.save()
    return buf.getvalue()


@pytest.fixture
def svc(tmp_path, monkeypatch):
    import json

    cfg = tmp_path / "config"
    cfg.mkdir()
    repo_cfg = Path(__file__).resolve().parent.parent / "config"
    for f in ("field_map.json", "jane_flow.json"):
        (cfg / f).write_text((repo_cfg / f).read_text())
    (cfg / "settings.json").write_text(json.dumps({"data_dir": str(tmp_path / "data")}))
    monkeypatch.setattr("intake_bridge.config.CONFIG_DIR", cfg)
    from intake_bridge.service import IntakeService

    s = IntakeService()
    s.vault.initialize("correct horse battery staple")
    return s
