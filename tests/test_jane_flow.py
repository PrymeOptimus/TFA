"""Runs the real config/jane_flow.json against a mock Jane page in headless Chromium."""
import functools
import http.server
import json
import os
import threading
from pathlib import Path

import pytest

from intake_bridge.jane_bot import FlowRunner, ReviewRejected

HERE = Path(__file__).resolve().parent
FLOW = json.loads((HERE.parent / "config" / "jane_flow.json").read_text())
FIELDS = {"first_name": "Jane", "last_name": "Doe", "dob": "1985-03-14", "email": "jane@example.com",
          "phone_mobile": "(478) 555-0142", "sex": "Female", "state": "GA", "zip": "31201",
          "chief_complaint": "Low back pain", "allergies": "Penicillin"}


class _Handler(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        self.path = "/mock_jane.html" + (self.path[len("/admin"):] if self.path.startswith("/admin") else "")
        return super().do_GET()

    def log_message(self, *a):
        pass


@pytest.fixture(scope="module")
def server():
    httpd = http.server.ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(_Handler, directory=str(HERE)))
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{httpd.server_port}"
    httpd.shutdown()


@pytest.fixture
def page():
    pw_mod = pytest.importorskip("playwright.sync_api")
    with pw_mod.sync_playwright() as pw:
        kw = {}
        exe = os.environ.get("CHROMIUM_EXECUTABLE")
        if exe:
            kw["executable_path"] = exe
        try:
            browser = pw.chromium.launch(**kw)
        except Exception as e:
            pytest.skip(f"chromium unavailable: {e}")
        yield browser.new_page()
        browser.close()


def run(page, base, *, dry_run, approve=True, existing=False):
    reviews = []
    steps = json.loads(json.dumps(FLOW["steps"]))
    if existing:
        steps[0]["url"] = "{base_url}/admin?existing=03/14/1985"
    r = FlowRunner(page, FIELDS, b"%PDF-1.4 test", "intake.pdf", base_url=base, dry_run=dry_run,
                   require_review=True, on_review=lambda m: reviews.append(m) or approve,
                   default_timeout_ms=4000)
    res = r.run(steps)
    return res, reviews, page.evaluate("window.__saved")


def test_dry_run_saves_nothing(page, server):
    res, reviews, saved = run(page, server, dry_run=True)
    assert saved == []
    assert res.commits_skipped > 0 and reviews == []
    assert page.get_by_label("First Name").input_value() == "Jane"  # fields were filled for staff to see


def test_live_run_creates_patient_uploads_and_submits_intake(page, server):
    res, reviews, saved = run(page, server, dry_run=False)
    assert len(reviews) == 2  # before first commit + explicit intake review
    patient = next(s for s in saved if s["type"] == "patient")
    assert patient == {"type": "patient", "fn": "Jane", "ln": "Doe", "em": "jane@example.com",
                       "mp": "(478) 555-0142", "dob": "03/14/1985", "sex": "Female", "st": "GA", "zip": "31201"}
    assert {"type": "file", "name": "intake.pdf"} in saved
    assert {"type": "intake", "q1": "Low back pain", "q2": "Penicillin"} in saved


def test_existing_patient_is_not_duplicated(page, server):
    _, _, saved = run(page, server, dry_run=False, existing=True)
    assert not any(s["type"] == "patient" for s in saved)
    assert any(s["type"] == "intake" for s in saved)


def test_rejected_review_saves_nothing(page, server):
    with pytest.raises(ReviewRejected):
        run(page, server, dry_run=False, approve=False)
    assert page.evaluate("window.__saved") == []
