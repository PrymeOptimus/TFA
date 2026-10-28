@echo off
rem Double-click to list TVs, Firesticks, Chromecasts/Google TVs and Rokus on this network.
rem Add -All to list every device:  "Find TVs.bat" -All
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Find-TVDevices.ps1" %*
echo.
pause
