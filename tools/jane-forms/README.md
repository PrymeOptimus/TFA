# Jane → PDF Form Filler

Fills your in-house PDF forms from Jane patient data in seconds: one patient or a whole list.
Everything runs on your PC. No patient data is uploaded anywhere, and none is kept in this repo.

## One-time setup per form (5–10 min)

1. Put the blank PDF in `forms\`.
2. Drop it onto **`Setup Form.bat`**. It writes `forms\<Form>.map.yaml`, listing every fillable field.
3. Open the `.map.yaml` in Notepad and say which Jane value goes in each field:

```yaml
form: Intake.pdf
output: "{Last Name}_{First Name}_Intake.pdf"
flatten: true                       # lock values so the PDF can't be edited after
fields:
  PatientName: "{First Name} {Last Name}"
  DOB: {value: "{Date of Birth}", date: "%m/%d/%Y"}
  Male: {checked_if: "{Sex}", equals: "Male"}
  Phone: "{Mobile Phone}"
```

`{...}` names are the **column headers in your Jane export**, exactly as spelled there.

**Scanned/flat forms** (no fillable boxes): Setup Form also writes `<Form>.grid.pdf` with a ruler grid.
Read the x/y where each value should go, and use `overlay:` instead of `fields:`:

```yaml
overlay:
  - {page: 1, x: 120, y: 690, size: 10, value: "{Phone}"}
```

## Daily use

1. Get the data. Either:
   - export the patients from Jane as a CSV, or
   - use the one-click capture of the open profile (coming once a test-patient page is mapped).
2. Drop the `.csv`/`.json` onto **`Fill Forms.bat`**, pick the form (or **A** for all forms).
3. Filled PDFs open in the `filled\` folder.

## HIPAA housekeeping

- `filled\` and exports contain PHI: keep them on the clinic PC or encrypted drive, and delete exports after use.
- Don't email filled forms unencrypted. Use your secure fax (Clearwave e-fax) or Jane's secure messaging.

## Command line

```
_run.bat fields forms\Intake.pdf
_run.bat grid forms\Intake.pdf
_run.bat fill forms\Intake.map.yaml export.csv --out filled
```
