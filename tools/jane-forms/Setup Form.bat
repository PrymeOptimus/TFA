@echo off
rem Drop a blank PDF form onto this file. It lists the form's fields and writes a starter map
rem (forms\<name>.map.yaml). Flat/scanned forms also get a coordinate grid PDF.
setlocal
call "%~dp0_run.bat" fields "%~1" && call "%~dp0_run.bat" grid "%~1"
pause
