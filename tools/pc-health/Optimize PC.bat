@echo off
rem Runs Check-PCHealth.ps1 -Optimize as Administrator. Read-only audit; -Optimize asks before every change.
net session >nul 2>&1
if errorlevel 1 (
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Check-PCHealth.ps1" -Optimize
echo.
pause
