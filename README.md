# Intake Bridge: ALOHA PDF → Jane App

A local app that reads an ALOHA intake PDF, stages the data encrypted on the front-desk PC, and enters it into Jane App by driving Jane's staff web UI with a browser. Jane has no write API for this, so the app uses browser automation.

```
ALOHA PDF ──► Extract (fillable fields + text labels) ──► Encrypted vault ──► Staff review/edit
                                                                                   │
           Jane App (staff's own logged-in Chrome session) ◄── Playwright flow ◄───┘
           • find patient by name + DOB, or create a new one
           • upload the original PDF to the patient's Files
           • fill + submit the intake form       (human approves before anything saves)
```

## Quick start (Windows front-desk PC)

1. Install Python 3.11+ from python.org (check "Add to PATH").
2. Double-click `start.bat`. The first run installs dependencies and Chromium, then opens `http://127.0.0.1:8765`.
3. Create the vault passphrase (12+ characters). It encrypts all staged PHI and **cannot be recovered**.
4. Edit `config/settings.json` and set `jane_base_url` to your Jane URL.

Daily use: upload the PDF → check the fields next to the original → click **Save + push to Jane**. A Chrome window opens. Log in to Jane if prompted (MFA works normally), confirm the entries in that window, then click **Approve** in Intake Bridge.

Command-line equivalents:

```bash
python -m intake_bridge serve
```

```bash
python -m intake_bridge watch "C:\Users\frontdesk\Downloads\AlohaIntakes"
```

```bash
python -m intake_bridge push <record_id> --dry-run
```

## One-time setup: calibrate to your ALOHA form and your Jane account (≈1–2 hrs)

Calibration is required. Neither ALOHA's PDF layout nor Jane's page structure is published, so the shipped mappings are starting points. Use a **test patient** throughout.

**A. ALOHA PDF → fields** (`config/field_map.json`)
```bash
python -m intake_bridge inspect test_patient.pdf --text
```
This shows every fillable field name, the raw text, and what was mapped. Add any missing ALOHA field names under `form_fields` (fillable PDFs) or printed labels under `text_labels` (flattened PDFs). Re-run until every field maps.

**B. Jane selectors** (`config/jane_flow.json`)
```bash
python -m intake_bridge record
```
This opens Playwright's recorder on your Jane admin. Create a test patient, upload a file and fill your intake form by hand. Copy the button and field names it shows into the matching steps. In the `intake_form` section, the labels must match **your** Jane intake form's question text exactly (Jane → Settings → Forms).

**C. Prove it**
```bash
python -m intake_bridge push <id> --dry-run
```
A dry run fills everything and saves nothing. Then do one live push on the test patient and confirm the result in Jane.

When Jane changes its UI, fix the selector in `jane_flow.json`. No code changes needed.

## HIPAA safeguards built in

| Requirement (45 CFR 164.312) | Implementation |
|---|---|
| Access control (a)(1) | Vault passphrase gate; UI auto-locks after 15 min idle (`idle_lock_seconds`); key held in memory only |
| Encryption at rest (a)(2)(iv) | Every record + source PDF is Fernet-encrypted (AES-128-CBC + HMAC-SHA256), key derived via scrypt. Nothing is written in plaintext |
| Audit controls (b) | Append-only, SHA-256 hash-chained `audit.jsonl`: who, what, when, record ID, outcome. **No PHI in the log.** `verify-audit` detects edits or deletions |
| Integrity (c)(1) | Encrypted blobs are authenticated (HMAC); tampering fails decryption |
| Transmission security (e)(1) | No network listener beyond `127.0.0.1` (enforced in code + Host-header check). The only outbound traffic is the staff's HTTPS session to Jane |
| Minimum necessary / retention | Record securely wiped right after a successful push (`retention_hours_after_push: 0`); anything unpushed is purged after 7 days. Watch-folder source PDFs are wiped on ingest |
| Human verification | Every save/submit step is skipped in dry run and needs explicit staff approval in live mode |
| No PHI leakage | No screenshots, traces or HAR files; browser-step errors messages show only the step name; no analytics or telemetry; no third-party AI or OCR services |

**Your responsibilities (the app can't enforce these):**
- **Full-disk encryption** (BitLocker/FileVault) on every PC running this. Required, because the Jane browser profile (`data_dir/jane-browser-profile`) holds a session cookie and SSDs don't guarantee overwrite on delete.
- Individual Windows logins per staff member, auto screen-lock, and current OS patches and antivirus.
- Confirm your **BAA with Jane** is in place (Jane offers one). This tool adds no new vendor, because PHI never leaves the PC except into Jane.
- Confirm with Jane that staff-driven browser automation is acceptable under your agreement. The tool acts as the logged-in staff member at human speed, with a human approving each save.
- Add this tool to your HIPAA risk analysis and policies, and back up `audit.jsonl` to your compliance records (`python -m intake_bridge audit-export <path>`).
- Keep `*.rejected` files out of the watch folder (they're PDFs that failed to parse and are left for manual handling).

## Limits

- Scanned (image-only) PDFs have no extractable text. The app flags them for manual entry. Local OCR (e.g. Tesseract) can be added if ALOHA ever produces scans.
- Patient de-duplication matches on name + DOB in Jane's search results. The review step is the safety net, so staff should check it.
- Flask's built-in server is fine for one loopback user. Don't expose it on the network (the app refuses to).

## Development

```bash
pip install -r requirements-dev.txt
```

```bash
python -m pytest -q
```

The tests generate fictitious fillable and flattened PDFs, check encryption, the audit chain, retention, CSRF and loopback protection, and run the real `jane_flow.json` in headless Chromium against `tests/mock_jane.html` (dry run, live run, existing-patient dedupe, rejected review). Set `CHROMIUM_EXECUTABLE` to use a specific browser binary.
