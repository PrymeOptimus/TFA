<#
.SYNOPSIS
  Installs StemForge on Windows in one pass: Python (via uv), the engine, the right
  PyTorch build for this PC (NVIDIA CUDA or CPU), the models, the Ableton device and
  a drag-and-drop desktop shortcut.

.PARAMETER InstallDir   Where the engine and models live (default: %LOCALAPPDATA%\StemForge).
.PARAMETER UserLibrary  Ableton User Library (default: auto-detected).
.PARAMETER Cpu          Force the CPU build even if an NVIDIA GPU is present.
.PARAMETER SkipModels   Don't pre-download models (they download on first use).
#>
[CmdletBinding()]
param(
    [string]$InstallDir = (Join-Path $env:LOCALAPPDATA 'StemForge'),
    [string]$UserLibrary,
    [switch]$Cpu,
    [switch]$SkipModels
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$Source = Split-Path -Parent $PSScriptRoot
$CudaIndex = 'https://download.pytorch.org/whl/cu128'

function Step($n, $text) { Write-Host "`n[$n/7] $text" -ForegroundColor Cyan }
function Ok($text) { Write-Host "      OK  $text" -ForegroundColor Green }
function Warn($text) { Write-Host "      !!  $text" -ForegroundColor Yellow }
function Write-Json($obj, $path) {
    # UTF-8 without BOM: Windows PowerShell's -Encoding UTF8 adds one and breaks JSON.parse
    [IO.File]::WriteAllText($path, ($obj | ConvertTo-Json), (New-Object Text.UTF8Encoding $false))
}
function Run([string]$exe, [string[]]$argv) {
    & $exe @argv
    if ($LASTEXITCODE -ne 0) { throw "$exe failed (exit $LASTEXITCODE): $($argv -join ' ')" }
}

Write-Host '==============================================================' -ForegroundColor Cyan
Write-Host '  StemForge installer (Windows)' -ForegroundColor Cyan
Write-Host '==============================================================' -ForegroundColor Cyan
Write-Host "  Engine + models: $InstallDir"

# 1. uv: manages Python itself, so no separate Python install and no PATH refresh needed
Step 1 'Python toolchain (uv)'
$uv = (Get-Command uv -ErrorAction SilentlyContinue).Source
if (-not $uv) {
    Invoke-RestMethod https://astral.sh/uv/install.ps1 | Invoke-Expression
    $env:Path = "$env:USERPROFILE\.local\bin;$env:Path"
    $uv = (Get-Command uv -ErrorAction Stop).Source
}
Ok "uv at $uv"

# 2. Python 3.12 in a private environment
Step 2 'Python 3.12 environment'
New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
$venv = Join-Path $InstallDir '.venv'
$py = Join-Path $venv 'Scripts\python.exe'
Run $uv @('python', 'install', '3.12')
if (-not (Test-Path $py)) { Run $uv @('venv', '--python', '3.12', $venv) }
Ok $py

# 3. PyTorch: CUDA build for NVIDIA GPUs, CPU build otherwise
Step 3 'PyTorch (GPU check)'
$gpu = $null
if (-not $Cpu -and (Get-Command nvidia-smi -ErrorAction SilentlyContinue)) {
    try { $gpu = (& nvidia-smi --query-gpu=name --format=csv,noheader 2>$null | Select-Object -First 1) } catch { $gpu = $null }
}
if ($gpu) {
    Ok "NVIDIA GPU found: $gpu. Installing CUDA build (large download)"
    Run $uv @('pip', 'install', '--python', $py, '--index', $CudaIndex, 'torch', 'torchaudio')
    $extra = 'gpu'
} else {
    Ok 'No NVIDIA GPU (or -Cpu): installing CPU build'
    Run $uv @('pip', 'install', '--python', $py, 'torch', 'torchaudio')
    $extra = 'cpu'
}

# 4. Engine
Step 4 'StemForge engine'
$engine = Join-Path $InstallDir 'engine'
if (Test-Path $engine) { Remove-Item -Recurse -Force $engine }
Copy-Item -Recurse (Join-Path $Source 'engine') $engine
Run $uv @('pip', 'install', '--python', $py, "audio-separator[$extra]>=0.47,<0.48", $engine)
$doctor = (& $py -m stemforge --models (Join-Path $InstallDir 'models') doctor) -join "`n" | ConvertFrom-Json
if ($gpu -and $doctor.device -ne 'cuda') {
    Warn 'The GPU build installed but CUDA is not usable. Update your NVIDIA driver; StemForge will use the CPU until then.'
}
Ok "device: $($doctor.device) ($($doctor.device_name)), default quality: $($doctor.auto_quality)"

# 5. Models
Step 5 'Models'
$models = Join-Path $InstallDir 'models'
if ($SkipModels) {
    Warn 'Skipped. Models download on first use.'
} else {
    Run $py @('-m', 'stemforge', '--models', $models, 'download', '--quality', 'auto')
    Ok "models in $models"
}

# 6. Ableton device
Step 6 'Ableton Live device'
if (-not $UserLibrary) {
    $UserLibrary = @(
        "$env:USERPROFILE\Documents\Ableton\User Library",
        "$env:USERPROFILE\Ableton\User Library",
        "$env:USERPROFILE\OneDrive\Documents\Ableton\User Library"
    ) | Where-Object { Test-Path $_ } | Select-Object -First 1
}
$outDir = Join-Path ([Environment]::GetFolderPath('MyMusic')) 'StemForge'
$config = [ordered]@{ python = $py; models = $models; out = $outDir }
if ($UserLibrary) {
    $dest = Join-Path $UserLibrary 'Presets\Audio Effects\Max Audio Effect\StemForge'
    New-Item -ItemType Directory -Force -Path $dest | Out-Null
    Copy-Item (Join-Path $Source 'device\*') $dest -Force -Exclude '*.py'
    Write-Json $config (Join-Path $dest 'stemforge-config.json')
    Ok "device installed to $dest"
} else {
    Warn 'Ableton User Library not found. Re-run with -UserLibrary "<path>" (Live: Preferences > Library).'
}

# 7. Drag-and-drop shortcut (works without Ableton)
Step 7 'Desktop shortcut'
Write-Json $config (Join-Path $InstallDir 'stemforge-config.json')
$drop = Join-Path $InstallDir 'StemForge.bat'
Copy-Item (Join-Path $PSScriptRoot 'StemForge.bat') $drop -Force
$shell = New-Object -ComObject WScript.Shell
$lnk = $shell.CreateShortcut((Join-Path ([Environment]::GetFolderPath('Desktop')) 'StemForge.lnk'))
$lnk.TargetPath = $drop
$lnk.WorkingDirectory = $InstallDir
$lnk.Description = 'Drop songs or folders here to split them into stems'
$lnk.Save()
Ok 'Desktop shortcut "StemForge": drop songs or folders on it'

Write-Host "`n==============================================================" -ForegroundColor Green
Write-Host '  StemForge is installed.' -ForegroundColor Green
Write-Host '  Ableton: Browser > Audio Effects > Max Audio Effect > StemForge'
Write-Host '  Desktop: drop songs/folders on the StemForge shortcut'
Write-Host "  Output:  $outDir"
Write-Host '==============================================================' -ForegroundColor Green
