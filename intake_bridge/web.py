"""Local-only staff UI: upload ALOHA PDF -> review/edit fields -> push to Jane."""
from __future__ import annotations

import hmac
import secrets
import threading
import time
from dataclasses import dataclass, field

from flask import Flask, Response, abort, jsonify, redirect, render_template, request, session, url_for

from .service import IntakeService
from .vault import BadPassphrase, VaultLocked

ALLOWED_HOSTS = {"127.0.0.1", "localhost", "[::1]"}


@dataclass
class Job:
    rid: str
    dry_run: bool
    status: str = "starting"  # starting|running|awaiting_login|awaiting_review|done|error|rejected
    message: str = ""
    review_message: str = ""
    notes: list = field(default_factory=list)
    _event: threading.Event = field(default_factory=threading.Event)
    _approved: bool = False

    def wait_review(self, msg: str) -> bool:
        self.review_message = msg
        self.status = "awaiting_review"
        self._event.clear()
        self._event.wait()
        return self._approved

    def answer(self, approved: bool) -> None:
        self._approved = approved
        self._event.set()


def create_app(svc: IntakeService | None = None) -> Flask:
    svc = svc or IntakeService()
    app = Flask(__name__)
    app.secret_key = secrets.token_bytes(32)  # per-process: restarting the app logs everyone out
    app.config.update(SESSION_COOKIE_HTTPONLY=True, SESSION_COOKIE_SAMESITE="Strict",
                      MAX_CONTENT_LENGTH=26 * 1024 * 1024)
    state = {"last_activity": time.time()}
    jobs: dict[str, Job] = {}

    @app.before_request
    def guard():
        host = (request.host or "").rsplit(":", 1)[0]
        if host not in ALLOWED_HOSTS:  # blocks DNS-rebinding / LAN access
            abort(403)
        if svc.vault.unlocked and time.time() - state["last_activity"] > svc.settings.idle_lock_seconds:
            if not any(j.status in ("running", "awaiting_review", "awaiting_login") for j in jobs.values()):
                svc.lock("idle timeout")
                session.clear()
        if request.method == "POST":
            token = request.form.get("csrf") or request.headers.get("X-CSRF", "")
            if not hmac.compare_digest(token, session.get("csrf", "")):
                abort(400, "CSRF token missing or invalid")
        if request.endpoint in ("unlock", "setup", "static"):
            return None
        if not svc.vault.initialized:
            return redirect(url_for("setup"))
        if not svc.vault.unlocked or not session.get("auth"):
            return redirect(url_for("unlock"))
        if request.endpoint != "job_status":  # polling doesn't count as activity
            state["last_activity"] = time.time()
        return None

    @app.after_request
    def headers(resp: Response):
        resp.headers["Cache-Control"] = "no-store"
        resp.headers["Pragma"] = "no-cache"
        resp.headers["X-Frame-Options"] = "DENY"
        resp.headers["X-Content-Type-Options"] = "nosniff"
        resp.headers["Referrer-Policy"] = "no-referrer"
        resp.headers["Content-Security-Policy"] = (
            "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; "
            "object-src 'self'; frame-src 'self'; frame-ancestors 'none'")
        return resp

    @app.context_processor
    def inject():
        if "csrf" not in session:
            session["csrf"] = secrets.token_urlsafe(32)
        return {"csrf": session["csrf"], "unlocked": svc.vault.unlocked and session.get("auth")}

    # ---- auth -----------------------------------------------------------
    @app.route("/setup", methods=["GET", "POST"])
    def setup():
        if svc.vault.initialized:
            return redirect(url_for("unlock"))
        error = ""
        if request.method == "POST":
            p1, p2 = request.form.get("passphrase", ""), request.form.get("confirm", "")
            if p1 != p2:
                error = "Passphrases do not match."
            else:
                try:
                    svc.vault.initialize(p1)
                    svc.audit.write("vault.init")
                    svc.lock("post-init")
                    return redirect(url_for("unlock"))
                except ValueError as e:
                    error = str(e)
        return render_template("unlock.html", setup=True, error=error)

    @app.route("/unlock", methods=["GET", "POST"])
    def unlock():
        error = ""
        if request.method == "POST":
            try:
                svc.unlock(request.form.get("passphrase", ""))
                session.clear()
                session["auth"] = True
                session["csrf"] = secrets.token_urlsafe(32)
                state["last_activity"] = time.time()
                return redirect(url_for("index"))
            except BadPassphrase:
                time.sleep(1.5)  # slow down guessing
                error = "Incorrect passphrase."
        return render_template("unlock.html", setup=False, error=error)

    @app.post("/lock")
    def lock():
        svc.lock("manual")
        session.clear()
        return redirect(url_for("unlock"))

    # ---- records --------------------------------------------------------
    @app.get("/")
    def index():
        records = svc.vault.list()
        return render_template("index.html", records=records, jobs=jobs, error=request.args.get("error", ""))

    @app.post("/upload")
    def upload():
        files = request.files.getlist("pdf")
        last = None
        for f in files:
            if not f or not f.filename:
                continue
            try:
                last = svc.ingest(f.read(), f.filename)
            except ValueError as e:
                return redirect(url_for("index", error=f"{f.filename}: {e}"))
        if last and len(files) == 1:
            return redirect(url_for("record", rid=last.id))
        return redirect(url_for("index"))

    @app.route("/record/<rid>", methods=["GET", "POST"])
    def record(rid):
        try:
            rec = svc.update_fields(rid, request.form.to_dict()) if request.method == "POST" else svc.get(rid)
        except FileNotFoundError:
            abort(404)
        if request.method == "POST" and request.form.get("then") in ("dry", "live"):
            return start_push(rid, dry_run=request.form["then"] == "dry")
        return render_template("record.html", rec=rec, job=jobs.get(rid),
                               canonical=svc.field_map["canonical_fields"],
                               required=set(svc.field_map.get("required", [])))

    @app.get("/record/<rid>/pdf")
    def record_pdf(rid):
        rec = svc.get(rid)
        svc.audit.write("record.view_pdf", rid)
        return Response(rec.pdf, mimetype="application/pdf",
                        headers={"Content-Disposition": "inline; filename=intake.pdf"})

    @app.post("/record/<rid>/delete")
    def record_delete(rid):
        svc.delete(rid)
        return redirect(url_for("index"))

    def start_push(rid: str, dry_run: bool):
        if any(j.status in ("starting", "running", "awaiting_review", "awaiting_login") for j in jobs.values()):
            return redirect(url_for("record", rid=rid))
        job = Job(rid=rid, dry_run=dry_run)
        jobs[rid] = job

        def work():
            def on_status(s):
                job.status = s
            try:
                job.status = "running"
                res = svc.push(rid, dry_run=dry_run, on_review=job.wait_review, on_status=on_status)
                job.notes = res.notes
                job.status = "done"
                job.message = "Dry run finished. Nothing saved in Jane." if dry_run else "Saved to Jane."
            except Exception as e:
                job.status = "rejected" if type(e).__name__ == "ReviewRejected" else "error"
                job.message = str(e)[:300]

        threading.Thread(target=work, daemon=True).start()
        return redirect(url_for("record", rid=rid))

    @app.get("/record/<rid>/job")
    def job_status(rid):
        j = jobs.get(rid)
        if not j:
            return jsonify({"status": "none"})
        return jsonify({"status": j.status, "message": j.message, "review_message": j.review_message,
                        "dry_run": j.dry_run, "notes": j.notes})

    @app.post("/record/<rid>/review")
    def job_review(rid):
        j = jobs.get(rid)
        if j and j.status == "awaiting_review":
            approved = request.form.get("decision") == "approve"
            svc.audit.write("jane.review", rid, outcome="approved" if approved else "rejected")
            j.answer(approved)
            j.status = "running"
        return redirect(url_for("record", rid=rid))

    @app.get("/audit")
    def audit():
        ok, n, msg = svc.audit.verify()
        return render_template("audit.html", ok=ok, n=n, msg=msg)

    @app.errorhandler(VaultLocked)
    def locked(_):
        session.clear()
        return redirect(url_for("unlock"))

    return app


def serve(svc: IntakeService | None = None) -> None:
    svc = svc or IntakeService()
    app = create_app(svc)
    if svc.settings.watch_folder:
        def watcher():
            while True:
                if svc.vault.unlocked:
                    try:
                        svc.watch_once(svc.settings.watch_folder)
                    except Exception:
                        pass
                time.sleep(5)
        threading.Thread(target=watcher, daemon=True).start()
    print(f"Intake Bridge running at http://{svc.settings.host}:{svc.settings.port}  (Ctrl+C to stop)")
    app.run(host=svc.settings.host, port=svc.settings.port, debug=False, threaded=True)
