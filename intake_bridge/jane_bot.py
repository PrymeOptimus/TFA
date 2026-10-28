"""Drive Jane App's staff web UI with Playwright (Jane has no write API for intake).

The flow is declarative (config/jane_flow.json) so when Jane changes its UI,
you fix selectors in JSON, not code. The browser runs headed on this machine,
logged in as the staff member (their own credentials + MFA). The session is
kept in a local browser profile so staff log in once per Jane session timeout.

Safety rails:
  * Steps marked "commit": true (Save/Submit) are skipped in dry-run mode.
  * With require_review_before_commit, a human must approve before the first commit step.
  * No screenshots, traces or HAR files are written (they would contain PHI)."""
from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field
from datetime import datetime
from typing import Callable

log = logging.getLogger("intake_bridge.jane")


class FlowError(Exception):
    pass


class ReviewRejected(Exception):
    pass


class _Blank(dict):
    def __missing__(self, key):
        return ""


def template_context(fields: dict) -> dict:
    ctx = _Blank({k: (v or "") for k, v in fields.items()})
    ctx["full_name"] = " ".join(p for p in (fields.get("first_name"), fields.get("last_name")) if p)
    for k in ("dob", "injury_date", "policy_holder_dob", "symptom_onset"):
        v = fields.get(k) or ""
        try:
            d = datetime.strptime(v, "%Y-%m-%d")
            ctx[f"{k}_mdy"] = d.strftime("%m/%d/%Y")
            ctx[f"{k}_long"] = f"{d:%B} {d.day}, {d.year}"
        except ValueError:
            ctx[f"{k}_mdy"] = v
            ctx[f"{k}_long"] = v
    ctx["phone_mobile_digits"] = "".join(c for c in fields.get("phone_mobile", "") if c.isdigit())
    return ctx


def render(value, ctx) -> str:
    return str(value).format_map(ctx) if value is not None else ""


def resolve(page, sel, ctx):
    """Selector forms: "css or playwright selector" | {"role": "...", "name": "..."} |
    {"label": "..."} | {"placeholder": "..."} | {"text": "..."} | {"css": "..."}.
    Optional "nth": n and "exact": bool."""
    if isinstance(sel, str):
        loc = page.locator(render(sel, ctx))
    elif "role" in sel:
        kw = {"name": render(sel["name"], ctx)} if "name" in sel else {}
        if "exact" in sel:
            kw["exact"] = sel["exact"]
        loc = page.get_by_role(sel["role"], **kw)
    elif "label" in sel:
        loc = page.get_by_label(render(sel["label"], ctx), exact=sel.get("exact", False))
    elif "placeholder" in sel:
        loc = page.get_by_placeholder(render(sel["placeholder"], ctx), exact=sel.get("exact", False))
    elif "text" in sel:
        loc = page.get_by_text(render(sel["text"], ctx), exact=sel.get("exact", False))
    elif "css" in sel:
        loc = page.locator(render(sel["css"], ctx))
    else:
        raise FlowError(f"unrecognized selector {sel!r}")
    return loc.nth(sel["nth"]) if isinstance(sel, dict) and "nth" in sel else loc.first


@dataclass
class RunResult:
    steps_run: int = 0
    steps_skipped: int = 0
    commits_skipped: int = 0
    notes: list = field(default_factory=list)


class FlowRunner:
    def __init__(self, page, fields: dict, pdf: bytes, pdf_name: str, *, base_url: str,
                 dry_run: bool, require_review: bool,
                 on_review: Callable[[str], bool],
                 on_status: Callable[[str], None] = lambda s: None,
                 default_timeout_ms: int = 15000):
        self.page = page
        self.ctx = template_context(fields)
        self.ctx["base_url"] = base_url.rstrip("/")
        self.pdf = pdf
        self.pdf_name = pdf_name
        self.dry_run = dry_run
        self.require_review = require_review
        self.on_review = on_review
        self.on_status = on_status
        self.approved = False
        self.result = RunResult()
        page.set_default_timeout(default_timeout_ms)

    def run(self, steps: list[dict]) -> RunResult:
        for step in steps:
            self._step(step)
        return self.result

    def _review(self, message: str) -> None:
        self.on_status("awaiting_review")
        if not self.on_review(message):
            raise ReviewRejected("staff rejected the entry at review")
        self.approved = True
        self.on_status("running")

    def _step(self, s: dict) -> None:
        action = s["action"]
        desc = s.get("name", action)
        if s.get("skip_if_empty") and not render(s["skip_if_empty"], self.ctx).strip():
            self.result.steps_skipped += 1
            return
        if s.get("commit"):
            if self.dry_run:
                self.result.commits_skipped += 1
                self.result.notes.append(f"dry-run: skipped commit step '{desc}'")
                return
            if self.require_review and not self.approved:
                self._review("Verify every field in the Jane window, then approve to save.")
        try:
            self._do(action, s)
            self.result.steps_run += 1
        except (ReviewRejected, FlowError):
            raise
        except Exception as e:  # Playwright errors
            if s.get("optional"):
                self.result.steps_skipped += 1
                self.result.notes.append(f"optional step '{desc}' skipped: {type(e).__name__}")
                return
            # Exception text from Playwright can echo filled values; keep only the type + step name.
            raise FlowError(f"step '{desc}' failed ({type(e).__name__})") from None

    def _do(self, action: str, s: dict) -> None:
        p, ctx = self.page, self.ctx
        if action == "goto":
            p.goto(render(s["url"], ctx))
        elif action == "click":
            resolve(p, s["selector"], ctx).click()
        elif action == "fill":
            loc = resolve(p, s["selector"], ctx)
            loc.fill("")
            loc.fill(render(s["value"], ctx))
        elif action == "type":  # for masked/date widgets that ignore fill()
            loc = resolve(p, s["selector"], ctx)
            loc.click()
            loc.press_sequentially(render(s["value"], ctx), delay=s.get("delay_ms", 30))
        elif action == "press":
            resolve(p, s["selector"], ctx).press(s["key"])
        elif action == "select":
            v = render(s["value"], ctx)
            loc = resolve(p, s["selector"], ctx)
            try:
                loc.select_option(label=v)
            except Exception:
                loc.select_option(value=v)
        elif action == "check":
            v = render(s.get("when", "true"), ctx).strip().lower()
            if v in ("true", "yes", "y", "1", "x", "on", "checked"):
                resolve(p, s["selector"], ctx).check()
        elif action == "upload":
            resolve(p, s["selector"], ctx).set_input_files(
                {"name": self.pdf_name, "mimeType": "application/pdf", "buffer": self.pdf})
        elif action == "wait_for":
            resolve(p, s["selector"], ctx).wait_for(state=s.get("state", "visible"),
                                                     timeout=s.get("timeout_ms"))
        elif action == "wait_ms":
            p.wait_for_timeout(s["ms"])
        elif action == "if_visible":
            loc = resolve(p, s["selector"], ctx)
            try:
                loc.wait_for(state="visible", timeout=s.get("timeout_ms", 3000))
                branch = s.get("then", [])
            except Exception:
                branch = s.get("else", [])
            for sub in branch:
                self._step(sub)
        elif action == "ensure_logged_in":
            self._ensure_logged_in(s)
        elif action == "review":
            if not self.dry_run:
                self._review(render(s.get("message", "Review the entry in Jane, then approve."), ctx))
        elif action == "fail":
            raise FlowError(render(s.get("message", "flow stopped"), ctx))
        else:
            raise FlowError(f"unknown action {action!r}")

    def _ensure_logged_in(self, s: dict) -> None:
        p, ctx = self.page, self.ctx
        p.goto(render(s["url"], ctx))
        ok = resolve(p, s["logged_in_selector"], ctx)
        try:
            ok.wait_for(state="visible", timeout=5000)
            return
        except Exception:
            pass
        self.on_status("awaiting_login")
        deadline = time.time() + s.get("timeout_s", 300)
        while time.time() < deadline:
            try:
                ok.wait_for(state="visible", timeout=2000)
                self.on_status("running")
                return
            except Exception:
                continue
        raise FlowError("timed out waiting for staff to log in to Jane")


def run_push(settings, flow: dict, fields: dict, pdf: bytes, pdf_name: str, *, dry_run: bool,
             on_review: Callable[[str], bool], on_status: Callable[[str], None] = lambda s: None) -> RunResult:
    from playwright.sync_api import sync_playwright

    steps = list(flow["steps"])
    if not settings.upload_source_pdf:
        steps = [s for s in steps if s.get("group") != "upload_pdf"]
    with sync_playwright() as pw:
        kw = {"headless": settings.headless, "accept_downloads": False}
        if settings.chromium_executable:
            kw["executable_path"] = settings.chromium_executable
        ctx = pw.chromium.launch_persistent_context(str(settings.browser_profile_dir), **kw)
        try:
            page = ctx.pages[0] if ctx.pages else ctx.new_page()
            runner = FlowRunner(page, fields, pdf, pdf_name, base_url=settings.jane_base_url,
                                dry_run=dry_run, require_review=settings.require_review_before_commit,
                                on_review=on_review, on_status=on_status,
                                default_timeout_ms=flow.get("default_timeout_ms", 15000))
            result = runner.run(steps)
            if dry_run:
                # Leave the window open so staff can see what was filled, without saving.
                on_review("Dry run complete. Nothing was saved. Approve to close the browser.")
            return result
        finally:
            ctx.close()
