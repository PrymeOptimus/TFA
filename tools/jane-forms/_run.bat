@echo off
rem Runs janeforms.py with its three libraries via uv (installs uv once if missing). Nothing leaves this PC.
where uv >nul 2>&1 || (
  echo Installing uv, one time only...
  powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://astral.sh/uv/install.ps1 | iex"
  set "PATH=%USERPROFILE%\.local\bin;%PATH%"
)
uv run --quiet --python 3.12 --with pypdf --with reportlab --with pyyaml python "%~dp0janeforms.py" %*
