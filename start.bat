@echo off
REM One-click launcher for Windows front-desk PCs.
cd /d "%~dp0"
if not exist .venv (
  py -3 -m venv .venv || goto :err
  .venv\Scripts\python -m pip install -r requirements.txt || goto :err
  .venv\Scripts\python -m playwright install chromium || goto :err
)
if not exist config\settings.json copy config\settings.example.json config\settings.json >nul
start "" http://127.0.0.1:8765
.venv\Scripts\python -m intake_bridge serve
goto :eof
:err
echo Setup failed. See README.md.
pause
