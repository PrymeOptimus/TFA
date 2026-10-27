@echo off
rem One-click StemForge installer. Extra options are passed through, e.g. -Cpu or -UserLibrary "D:\Ableton\User Library"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0windows\Install-StemForge.ps1" %*
echo.
pause
