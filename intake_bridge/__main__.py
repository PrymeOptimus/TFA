"""python -m intake_bridge <command>"""
from __future__ import annotations

import argparse
import getpass
import json
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path

from . import pdf_extract


def _svc(unlock: bool = True):
    from .service import IntakeService

    svc = IntakeService()
    if unlock:
        if not svc.vault.initialized:
            sys.exit("Vault not initialized. Run: python -m intake_bridge init")
        pw = os.environ.get("INTAKE_BRIDGE_PASSPHRASE") or getpass.getpass("Vault passphrase: ")
        svc.unlock(pw)
    return svc


def cmd_init(_):
    svc = _svc(unlock=False)
    if svc.vault.initialized:
        sys.exit("Vault already initialized.")
    p1 = getpass.getpass("New vault passphrase (12+ chars): ")
    if p1 != getpass.getpass("Confirm: "):
        sys.exit("Passphrases do not match.")
    svc.vault.initialize(p1)
    svc.audit.write("vault.init")
    print(f"Vault created at {svc.settings.vault_dir}")


def cmd_inspect(a):
    """Show raw form fields + text from a TEST PDF so you can tune config/field_map.json."""
    from .config import load_json_config

    data = Path(a.pdf).read_bytes()
    raw = pdf_extract.inspect(data)
    print("=== AcroForm fields ===")
    for k, v in raw["form_fields"].items():
        print(f"  {k!r}: {v!r}")
    if not raw["form_fields"]:
        print("  (none — PDF is flattened; text labels will be used)")
    if a.text:
        print("=== Extracted text ===")
        print(raw["text"])
    fields, warnings = pdf_extract.extract(data, load_json_config("field_map.json"))
    print("=== Canonical mapping result ===")
    for k, v in fields.items():
        print(f"  {k:32} {v}")
    for w in warnings:
        print("  WARNING:", w)


def cmd_ingest(a):
    svc = _svc()
    for p in a.pdf:
        rec = svc.ingest_file(Path(p), delete_source=a.delete_source)
        print(f"{rec.id}  {len(rec.warnings)} warnings")


def cmd_list(_):
    svc = _svc()
    for r in svc.vault.list():
        print(f"{r.id}  {r.status:9} {time.strftime('%Y-%m-%d %H:%M', time.localtime(r.created))}  "
              f"{r.fields.get('last_name','')}, {r.fields.get('first_name','')}  warnings={len(r.warnings)}")


def cmd_push(a):
    svc = _svc()

    def on_review(msg):
        print("\n>>> " + msg)
        return input("Type 'yes' to approve, anything else to stop: ").strip().lower() == "yes"

    res = svc.push(a.record_id, dry_run=a.dry_run, on_review=on_review,
                   on_status=lambda s: print(f"[{s}]") if s.startswith("awaiting_login") else None)
    print(f"steps run={res.steps_run} skipped={res.steps_skipped} commits_skipped={res.commits_skipped}")
    for n in res.notes:
        print("  -", n)


def cmd_purge(_):
    svc = _svc()  # unlock runs the retention purge
    print("Retention purge complete.")


def cmd_watch(a):
    svc = _svc()
    folder = Path(a.folder) if a.folder else svc.settings.watch_folder
    if not folder:
        sys.exit("No folder given and watch_folder not set in settings.json")
    print(f"Watching {folder} (Ctrl+C to stop)")
    try:
        while True:
            for rid in svc.watch_once(folder):
                print("ingested", rid)
            time.sleep(5)
    except KeyboardInterrupt:
        svc.lock("watch stopped")


def cmd_serve(_):
    from .web import serve

    serve()


def cmd_record(_):
    """Open Playwright codegen against Jane so you can capture real selectors for jane_flow.json."""
    from .config import load_settings

    s = load_settings()
    print("Log in, click through creating a TEST patient and filling a TEST intake form.\n"
          "Copy the selectors codegen shows into config/jane_flow.json. Use a test patient only.")
    subprocess.run([sys.executable, "-m", "playwright", "codegen", "--target", "python",
                    f"{s.jane_base_url.rstrip('/')}/admin"], check=False)


def cmd_verify_audit(_):
    from .audit import AuditLog
    from .config import load_settings

    ok, n, msg = AuditLog(load_settings().audit_path).verify()
    print(f"{msg} ({n} entries)")
    sys.exit(0 if ok else 1)


def cmd_audit_export(a):
    from .config import load_settings

    src = load_settings().audit_path
    shutil.copyfile(src, a.dest)
    print(f"Copied {src} -> {a.dest}")


def main(argv=None):
    ap = argparse.ArgumentParser(prog="intake_bridge", description="ALOHA PDF intake -> Jane App (local, HIPAA-oriented)")
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("init", help="create the encrypted vault").set_defaults(fn=cmd_init)
    p = sub.add_parser("inspect", help="show fields found in a TEST PDF (for mapping setup)")
    p.add_argument("pdf"); p.add_argument("--text", action="store_true", help="also print raw text")
    p.set_defaults(fn=cmd_inspect)
    p = sub.add_parser("ingest", help="extract PDF(s) into the vault")
    p.add_argument("pdf", nargs="+"); p.add_argument("--delete-source", action="store_true")
    p.set_defaults(fn=cmd_ingest)
    sub.add_parser("list", help="list staged records").set_defaults(fn=cmd_list)
    p = sub.add_parser("push", help="push a record into Jane")
    p.add_argument("record_id"); p.add_argument("--dry-run", action="store_true")
    p.set_defaults(fn=cmd_push)
    sub.add_parser("purge", help="apply retention policy").set_defaults(fn=cmd_purge)
    p = sub.add_parser("watch", help="auto-ingest PDFs dropped in a folder")
    p.add_argument("folder", nargs="?"); p.set_defaults(fn=cmd_watch)
    sub.add_parser("serve", help="start the local web UI").set_defaults(fn=cmd_serve)
    sub.add_parser("record", help="capture Jane selectors with Playwright codegen").set_defaults(fn=cmd_record)
    sub.add_parser("verify-audit", help="check audit log hash chain").set_defaults(fn=cmd_verify_audit)
    p = sub.add_parser("audit-export", help="copy audit log for compliance review")
    p.add_argument("dest"); p.set_defaults(fn=cmd_audit_export)
    a = ap.parse_args(argv)
    a.fn(a)


if __name__ == "__main__":
    main()
