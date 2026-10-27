@echo off
rem Drop songs or folders on this file (or its desktop shortcut) to split them.
rem Options: set STEMFORGE_MODE=vocals|4stem|6stem and STEMFORGE_QUALITY=auto|fast|best
setlocal
title StemForge
if "%~1"=="" (
  echo Drag one or more songs or folders onto the StemForge icon.
  pause
  exit /b 1
)
if "%STEMFORGE_MODE%"=="" set "STEMFORGE_MODE=4stem"
if "%STEMFORGE_QUALITY%"=="" set "STEMFORGE_QUALITY=auto"
set "HERE=%~dp0"
"%HERE%.venv\Scripts\python.exe" -m stemforge --models "%HERE%models" split %* --mode %STEMFORGE_MODE% --quality %STEMFORGE_QUALITY% --out "%USERPROFILE%\Music\StemForge"
echo.
if errorlevel 1 (echo Some files failed - see messages above.) else (echo Finished. Opening the output folder...& start "" "%USERPROFILE%\Music\StemForge")
pause
