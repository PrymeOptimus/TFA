@echo off
rem Drop a Jane export (.csv) or captured profile (.json) onto this file.
rem Choose a form; filled PDFs go to the "filled" folder.
setlocal EnableDelayedExpansion
if "%~1"=="" (echo Drag a Jane export .csv or a captured .json onto this file. & pause & exit /b 1)
set n=0
for %%M in ("%~dp0forms\*.map.yaml") do (
  set /a n+=1
  set "map!n!=%%~fM"
  echo   !n!. %%~nM
)
if %n%==0 (echo No maps in the forms folder yet. Drop a PDF onto "Setup Form.bat" first. & pause & exit /b 1)
set /p pick=Which form? (number, or A for all): 
if /i "%pick%"=="A" (
  for /l %%i in (1,1,%n%) do call "%~dp0_run.bat" fill "!map%%i!" "%~1" --out "%~dp0filled"
) else (
  call "%~dp0_run.bat" fill "!map%pick%!" "%~1" --out "%~dp0filled"
)
start "" "%~dp0filled"
pause
