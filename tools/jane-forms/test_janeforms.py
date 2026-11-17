import csv
import json
import subprocess
import sys
from pathlib import Path

import pytest
import yaml
from pypdf import PdfReader
from reportlab.pdfgen import canvas

import janeforms as jf


@pytest.fixture
def fillable(tmp_path):
    path = tmp_path / "Intake.pdf"
    c = canvas.Canvas(str(path), pagesize=(612, 792))
    c.drawString(50, 750, "Patient intake (test form)")
    form = c.acroForm
    form.textfield(name="PatientName", x=50, y=700, width=300, height=18)
    form.textfield(name="DOB", x=50, y=660, width=120, height=18)
    form.checkbox(name="Male", x=50, y=620, size=14)
    form.checkbox(name="Female", x=100, y=620, size=14)
    c.save()
    return path


@pytest.fixture
def flat(tmp_path):
    path = tmp_path / "Flat.pdf"
    c = canvas.Canvas(str(path), pagesize=(612, 792))
    c.drawString(50, 750, "Name: ____________")
    c.showPage()
    c.drawString(50, 750, "Page two")
    c.save()
    return path


PATIENTS = [
    {"First Name": "Test", "Last Name": "Patient", "Date of Birth": "1980-02-29", "Sex": "Male", "Phone": "555-0100"},
    {"First Name": "Demo", "Last Name": "Person", "Date of Birth": "03/04/1990", "Sex": "female", "Phone": ""},
]


def write_map(tmp_path, form, **extra):
    m = {"form": form.name, "output": "{Last Name}_{First Name}.pdf", **extra}
    path = tmp_path / "map.yaml"
    path.write_text(yaml.safe_dump(m))
    return path


def values(pdf):
    return {k: v.get("/V") for k, v in PdfReader(str(pdf)).get_fields().items()}


def test_field_listing_and_starter_map(fillable, capsys):
    assert jf.main(["fields", str(fillable)]) == 0
    out = capsys.readouterr().out
    assert "PatientName" in out and "checkbox" in out
    starter = yaml.safe_load(fillable.with_suffix(".map.yaml").read_text())
    assert set(starter["fields"]) == {"PatientName", "DOB", "Male", "Female"}


def test_fill_text_dates_and_checkboxes_from_csv(tmp_path, fillable):
    data = tmp_path / "export.csv"
    with open(data, "w", newline="", encoding="utf-8-sig") as f:  # Excel-style BOM
        w = csv.DictWriter(f, fieldnames=list(PATIENTS[0]))
        w.writeheader()
        w.writerows(PATIENTS)
    m = write_map(tmp_path, fillable, fields={
        "PatientName": "{First Name} {Last Name}",
        "DOB": {"value": "{Date of Birth}", "date": "%m/%d/%Y"},
        "Male": {"checked_if": "{Sex}", "equals": "Male"},
        "Female": {"checked_if": "{Sex}", "equals": "Female"},
    })
    out = tmp_path / "out"
    assert jf.main(["fill", str(m), str(data), "--out", str(out)]) == 0
    a = values(out / "Patient_Test.pdf")
    assert a["PatientName"] == "Test Patient" and a["DOB"] == "02/29/1980"
    assert a["Male"] != "/Off" and a["Female"] == "/Off"
    b = values(out / "Person_Demo.pdf")
    assert b["DOB"] == "03/04/1990" and b["Female"] != "/Off" and b["Male"] == "/Off"  # case-insensitive match


def test_missing_values_print_blank_and_unknown_fields_warn(tmp_path, fillable, capsys):
    data = tmp_path / "one.json"
    data.write_text(json.dumps({"First Name": "Solo"}))
    m = write_map(tmp_path, fillable, output="out.pdf", fields={"PatientName": "{First Name} {Middle} {Last Name}", "Nope": "x"})
    jf.main(["fill", str(m), str(data), "--out", str(tmp_path / "o")])
    assert "Nope" in capsys.readouterr().out
    assert values(tmp_path / "o" / "out.pdf")["PatientName"] == "Solo"


def test_flatten_removes_editable_fields(tmp_path, fillable):
    data = tmp_path / "p.json"
    data.write_text(json.dumps(PATIENTS[0]))
    m = write_map(tmp_path, fillable, flatten=True, fields={"PatientName": "{First Name}"})
    jf.main(["fill", str(m), str(data), "--out", str(tmp_path / "o")])
    reader = PdfReader(str(tmp_path / "o" / "Patient_Test.pdf"))
    assert "Test" in reader.pages[0].extract_text()


def test_overlay_writes_text_on_the_right_page_of_a_flat_form(tmp_path, flat):
    data = tmp_path / "p.json"
    data.write_text(json.dumps(PATIENTS[0]))
    m = write_map(tmp_path, flat, overlay=[
        {"page": 1, "x": 90, "y": 750, "value": "{First Name} {Last Name}"},
        {"page": 2, "x": 50, "y": 700, "value": "{Phone}"},
    ])
    jf.main(["fill", str(m), str(data), "--out", str(tmp_path / "o")])
    pages = PdfReader(str(tmp_path / "o" / "Patient_Test.pdf")).pages
    assert "Test Patient" in pages[0].extract_text() and "555-0100" not in pages[0].extract_text()
    assert "555-0100" in pages[1].extract_text()


def test_same_name_does_not_overwrite(tmp_path, fillable):
    data = tmp_path / "p.json"
    data.write_text(json.dumps([PATIENTS[0], PATIENTS[0]]))
    m = write_map(tmp_path, fillable, fields={"PatientName": "{First Name}"})
    jf.main(["fill", str(m), str(data), "--out", str(tmp_path / "o")])
    assert sorted(p.name for p in (tmp_path / "o").iterdir()) == ["Patient_Test (2).pdf", "Patient_Test.pdf"]


def test_unparseable_date_is_kept_not_guessed():
    assert jf.reformat_date("sometime in May", "%m/%d/%Y") == "sometime in May"


def test_grid_for_flat_forms(flat):
    assert jf.main(["grid", str(flat)]) == 0
    assert len(PdfReader(str(flat.with_suffix(".grid.pdf"))).pages) == 2
