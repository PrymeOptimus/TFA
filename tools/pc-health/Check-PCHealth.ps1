<#
.SYNOPSIS
  Windows security + performance checkup. Read-only by default.

.DESCRIPTION
  Default      : audit only. Changes nothing. Writes PC-Health-<date>.html to the Desktop.
  -Scan        : also runs a Microsoft Defender quick scan (-FullScan for a full scan).
  -Optimize    : after the audit, offers safe, reversible tune-ups one at a time (Y/N each).

  Checks: Defender/antivirus status and threat history; running programs that are unsigned or
  run from user-writable folders; programs with internet connections; autostart locations
  malware uses (Run keys, Startup folders, scheduled tasks, services, WMI subscriptions);
  hosts-file redirects; plus CPU, memory, disk, startup load, power plan, updates and battery.
#>
[CmdletBinding()]
param([switch]$Scan, [switch]$FullScan, [switch]$Optimize)

$ErrorActionPreference = 'SilentlyContinue'
$ProgressPreference = 'SilentlyContinue'
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator)

$findings = New-Object System.Collections.Generic.List[object]
function Add-Finding($severity, $area, $item, $detail) {
    $findings.Add([pscustomobject]@{ Severity = $severity; Area = $area; Item = $item; Detail = $detail })
}
function Section($t) { Write-Host "`n== $t" -ForegroundColor Cyan }

# user-writable places malware likes to run from
$riskyPath = '\\AppData\\Local\\Temp\\|\\Windows\\Temp\\|\\Downloads\\|\\Users\\Public\\|\\AppData\\Roaming\\[^\\]+\.exe|\\ProgramData\\[^\\]+\.exe|\\\$Recycle'
$riskyArgs = '-enc\b|-encodedcommand|frombase64string|downloadstring|downloadfile|invoke-expression|\biex\b|mshta|regsvr32.+(http|scrobj)|rundll32.+(http|javascript)|bitsadmin.+transfer|certutil.+-urlcache'

$sigCache = @{}
function Get-SignatureState([string]$path) {
    if (-not $path -or -not (Test-Path -LiteralPath $path)) { return 'Missing' }
    if ($sigCache.ContainsKey($path)) { return $sigCache[$path] }
    $s = Get-AuthenticodeSignature -LiteralPath $path
    $state = if ($s.Status -eq 'Valid') { "Signed: $($s.SignerCertificate.GetNameInfo('SimpleName', $false))" } else { "NOT signed ($($s.Status))" }
    $sigCache[$path] = $state
    return $state
}
function Get-ExePath([string]$command) {
    if (-not $command) { return $null }
    $c = [Environment]::ExpandEnvironmentVariables($command.Trim())
    if ($c -match '^"([^"]+)"') { return $Matches[1] }
    if ($c -match '^(.+?\.(exe|com|bat|cmd|ps1|vbs|js|scr|dll))\b') { return $Matches[1] }
    return ($c -split ' ')[0]
}

Write-Host '==============================================================' -ForegroundColor Cyan
Write-Host '  PC Health Check (read-only audit)' -ForegroundColor Cyan
Write-Host '==============================================================' -ForegroundColor Cyan
if (-not $isAdmin) { Write-Host '  Not running as Administrator: some checks will be partial.' -ForegroundColor Yellow }

# ---- 1. Antivirus ----------------------------------------------------------------------
Section 'Antivirus'
$avs = Get-CimInstance -Namespace root/SecurityCenter2 -ClassName AntiVirusProduct
foreach ($av in $avs) { Write-Host "  Installed antivirus: $($av.displayName)" }
$mp = Get-MpComputerStatus
if ($mp) {
    Write-Host ("  Defender real-time: {0} | definitions {1} day(s) old | last quick scan {2} day(s) ago" -f `
        $mp.RealTimeProtectionEnabled, $mp.AntivirusSignatureAge, $mp.QuickScanAge)
    if (-not $mp.RealTimeProtectionEnabled -and @($avs).Count -le 1) { Add-Finding 'HIGH' 'Antivirus' 'Real-time protection is OFF' 'Turn on in Windows Security > Virus & threat protection.' }
    if ($mp.AntivirusSignatureAge -gt 3) { Add-Finding 'MEDIUM' 'Antivirus' 'Defender definitions are out of date' "$($mp.AntivirusSignatureAge) days old. Run Windows Update." }
    if ($mp.IsTamperProtected -eq $false) { Add-Finding 'MEDIUM' 'Antivirus' 'Tamper Protection is off' 'Malware can switch Defender off. Turn it on in Windows Security.' }
    $threats = Get-MpThreatDetection | Sort-Object InitialDetectionTime -Descending | Select-Object -First 15
    foreach ($t in $threats) {
        $name = (Get-MpThreat -ThreatID $t.ThreatID).ThreatName
        $state = switch ($t.ThreatStatusID) { 1 {'Cleaned'} 2 {'Quarantined'} 3 {'Removed'} 4 {'Allowed'} 6 {'Blocked'} default {"Status $($t.ThreatStatusID)"} }
        $sev = if ($state -in 'Allowed', 'Status 0', 'Status 5') { 'HIGH' } else { 'INFO' }
        Add-Finding $sev 'Threat history' $name ("{0:yyyy-MM-dd} {1}: {2}" -f $t.InitialDetectionTime, $state, ($t.Resources -join '; '))
    }
} else {
    Write-Host '  Microsoft Defender status unavailable (another antivirus may manage the PC).'
}

if ($Scan -or $FullScan) {
    $type = if ($FullScan) { 'FullScan' } else { 'QuickScan' }
    Write-Host "  Updating definitions and running Defender $type (quick scan: a few minutes)..." -ForegroundColor Yellow
    Update-MpSignature
    Start-MpScan -ScanType $type
    $new = Get-MpThreatDetection | Where-Object { $_.InitialDetectionTime -gt (Get-Date).AddHours(-3) }
    if ($new) { foreach ($t in $new) { Add-Finding 'HIGH' 'Scan result' (Get-MpThreat -ThreatID $t.ThreatID).ThreatName ($t.Resources -join '; ') } }
    else { Write-Host "  $type finished: no threats found." -ForegroundColor Green }
}

# ---- 2. Running programs ---------------------------------------------------------------
Section 'Running programs'
$procs = Get-CimInstance Win32_Process | Where-Object ExecutablePath
$byPid = @{}
foreach ($p in $procs) {
    $byPid[[int]$p.ProcessId] = $p
    $sig = Get-SignatureState $p.ExecutablePath
    $unsigned = $sig -like 'NOT signed*'
    $risky = $p.ExecutablePath -match $riskyPath
    if ($unsigned -and $risky) { Add-Finding 'HIGH' 'Running program' $p.Name "$($p.ExecutablePath) | $sig | runs from a user-writable folder" }
    elseif ($unsigned) { Add-Finding 'LOW' 'Running program' $p.Name "$($p.ExecutablePath) | $sig" }
    elseif ($risky) { Add-Finding 'MEDIUM' 'Running program' $p.Name "$($p.ExecutablePath) | $sig | runs from a temp/download folder" }
    if ($p.CommandLine -match $riskyArgs) { Add-Finding 'HIGH' 'Running program' $p.Name "Suspicious command line: $($p.CommandLine)" }
}
Write-Host "  Checked $(@($procs).Count) running programs."

# ---- 3. Internet connections -----------------------------------------------------------
Section 'Programs talking to the internet'
$conns = Get-NetTCPConnection -State Established | Where-Object { $_.RemoteAddress -notmatch '^(127\.|::1|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|fe80|0\.0\.0\.0)' }
$talkers = $conns | Group-Object OwningProcess
foreach ($g in $talkers) {
    $p = $byPid[[int]$g.Name]
    if (-not $p) { continue }
    $sig = Get-SignatureState $p.ExecutablePath
    if ($sig -like 'NOT signed*') {
        $remotes = ($g.Group | Select-Object -ExpandProperty RemoteAddress -Unique | Select-Object -First 5) -join ', '
        Add-Finding 'HIGH' 'Network' $p.Name "Unsigned program with internet connections to $remotes | $($p.ExecutablePath)"
    }
}
Write-Host "  $(@($talkers).Count) programs have open internet connections."

# ---- 4. Autostart (persistence) --------------------------------------------------------
Section 'Programs that start automatically'
$runKeys = 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Run', 'HKLM:\Software\Microsoft\Windows\CurrentVersion\RunOnce',
           'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Run', 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run',
           'HKCU:\Software\Microsoft\Windows\CurrentVersion\RunOnce'
$autoCount = 0
foreach ($k in $runKeys) {
    $props = Get-ItemProperty -Path $k
    if (-not $props) { continue }
    foreach ($prop in $props.PSObject.Properties | Where-Object { $_.Name -notlike 'PS*' }) {
        $autoCount++
        $cmd = [string]$prop.Value
        $sig = Get-SignatureState (Get-ExePath $cmd)
        if ($cmd -match $riskyArgs) { Add-Finding 'HIGH' 'Autostart (registry)' $prop.Name "Suspicious command: $cmd" }
        elseif ($sig -like 'NOT signed*' -and $cmd -match $riskyPath) { Add-Finding 'HIGH' 'Autostart (registry)' $prop.Name "$cmd | $sig" }
        elseif ($sig -eq 'Missing') { Add-Finding 'LOW' 'Autostart (registry)' $prop.Name "Points to a missing file (leftover): $cmd" }
    }
}
foreach ($dir in [Environment]::GetFolderPath('Startup'), [Environment]::GetFolderPath('CommonStartup')) {
    foreach ($f in Get-ChildItem -LiteralPath $dir -File | Where-Object Name -ne 'desktop.ini') {
        $autoCount++
        if ($f.Extension -match '\.(vbs|js|jse|wsf|bat|cmd|ps1|hta|scr)$') { Add-Finding 'MEDIUM' 'Autostart (Startup folder)' $f.Name "Script in Startup folder: $($f.FullName)" }
    }
}
foreach ($t in Get-ScheduledTask | Where-Object { $_.State -ne 'Disabled' }) {
    foreach ($a in $t.Actions) {
        if (-not $a.Execute) { continue }
        $line = "$($a.Execute) $($a.Arguments)"
        if ($line -match $riskyArgs) { Add-Finding 'HIGH' 'Scheduled task' $t.TaskName "Suspicious command: $line" }
        elseif ($a.Execute -match $riskyPath -and (Get-SignatureState (Get-ExePath $a.Execute)) -like 'NOT signed*') {
            Add-Finding 'HIGH' 'Scheduled task' $t.TaskName "Unsigned program in user-writable folder: $line"
        }
    }
}
foreach ($svc in Get-CimInstance Win32_Service | Where-Object { $_.StartMode -eq 'Auto' }) {
    $exe = Get-ExePath $svc.PathName
    if ($exe -match $riskyPath) { Add-Finding 'HIGH' 'Service' $svc.Name "Auto-start service runs from user-writable folder: $($svc.PathName)" }
    elseif ($exe -and $exe -notmatch '\\Windows\\' -and (Get-SignatureState $exe) -like 'NOT signed*') {
        Add-Finding 'MEDIUM' 'Service' $svc.Name "Unsigned auto-start service: $($svc.PathName)"
    }
}
foreach ($c in Get-CimInstance -Namespace root/subscription -ClassName __EventConsumer) {
    if ($c.CimClass.CimClassName -in 'CommandLineEventConsumer', 'ActiveScriptEventConsumer') {
        Add-Finding 'HIGH' 'WMI persistence' $c.Name "$($c.CimClass.CimClassName): $($c.CommandLineTemplate)$($c.ScriptText)"
    }
}
Write-Host "  $autoCount startup entries checked, plus scheduled tasks, services and WMI."

# ---- 5. Hosts file ---------------------------------------------------------------------
$hosts = Get-Content "$env:windir\System32\drivers\etc\hosts" | Where-Object { $_ -match '^\s*\d' -and $_ -notmatch '\blocalhost\b' }
foreach ($h in $hosts) { Add-Finding 'MEDIUM' 'Hosts file' ($h -replace '\s+', ' ').Trim() 'Redirects a website. Fine if you added it; malware uses this to hijack sites.' }

# ---- 6. Performance --------------------------------------------------------------------
Section 'Performance'
$os = Get-CimInstance Win32_OperatingSystem
$cpu = Get-CimInstance Win32_Processor | Select-Object -First 1
$ramGB = [math]::Round($os.TotalVisibleMemorySize / 1MB, 1)
$freePct = [math]::Round($os.FreePhysicalMemory / $os.TotalVisibleMemorySize * 100)
$uptime = (Get-Date) - $os.LastBootUpTime
$sys = Get-Volume -DriveLetter ($env:SystemDrive.TrimEnd(':'))
$diskFreePct = if ($sys.Size) { [math]::Round($sys.SizeRemaining / $sys.Size * 100) } else { 0 }
$disk = Get-PhysicalDisk | Select-Object -First 1
$plan = (powercfg /getactivescheme) -replace '.*\((.+)\).*', '$1'
$tempMB = [math]::Round(((Get-ChildItem $env:TEMP, "$env:windir\Temp" -Recurse -File -Force | Measure-Object Length -Sum).Sum) / 1MB)
$lastPatch = Get-HotFix | Sort-Object InstalledOn -Descending | Select-Object -First 1
$rebootPending = (Test-Path 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Component Based Servicing\RebootPending') -or
                 (Test-Path 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\WindowsUpdate\Auto Update\RebootRequired')

Write-Host ("  {0} | {1} | {2} GB RAM ({3}% free) | CPU load {4}%" -f $os.Caption, $cpu.Name.Trim(), $ramGB, $freePct, $cpu.LoadPercentage)
Write-Host ("  {0}: {1}% free of {2} GB | {3} {4} | power plan: {5} | up {6} days" -f $env:SystemDrive, $diskFreePct,
    [math]::Round($sys.Size / 1GB), $disk.MediaType, $disk.HealthStatus, $plan, [math]::Floor($uptime.TotalDays))

if ($ramGB -lt 8) { Add-Finding 'MEDIUM' 'Performance' "Only $ramGB GB RAM" 'Below 8 GB, Windows 11 with a browser and Office will page to disk. A RAM upgrade is the biggest speed win if the laptop allows it.' }
if ($freePct -lt 15) { Add-Finding 'MEDIUM' 'Performance' "Memory nearly full ($freePct% free)" 'Close heavy apps (see top programs below) or add RAM.' }
if ($diskFreePct -lt 15) { Add-Finding 'HIGH' 'Performance' "System drive almost full ($diskFreePct% free)" 'Under 15% free slows Windows and blocks updates. Use -Optimize or Settings > Storage.' }
if ($disk.MediaType -eq 'HDD') { Add-Finding 'MEDIUM' 'Performance' 'System disk is a spinning hard drive' 'Moving to an SSD is the single biggest speed upgrade for an older laptop.' }
if ($disk.HealthStatus -and $disk.HealthStatus -ne 'Healthy') { Add-Finding 'HIGH' 'Hardware' "Disk health: $($disk.HealthStatus)" 'Back up now; the drive may be failing.' }
if ($uptime.TotalDays -gt 7) { Add-Finding 'LOW' 'Performance' "No restart in $([math]::Floor($uptime.TotalDays)) days" 'A restart clears memory leaks and finishes updates.' }
if ($rebootPending) { Add-Finding 'MEDIUM' 'Updates' 'Restart pending' 'Updates are waiting on a restart.' }
if ($lastPatch.InstalledOn -and $lastPatch.InstalledOn -lt (Get-Date).AddDays(-45)) { Add-Finding 'HIGH' 'Updates' 'Windows updates are behind' "Last update installed $("{0:yyyy-MM-dd}" -f $lastPatch.InstalledOn)." }
if ($plan -match 'saver') { Add-Finding 'LOW' 'Performance' "Power plan: $plan" 'Power saver caps CPU speed. -Optimize can switch to Balanced.' }
if ($tempMB -gt 1000) { Add-Finding 'LOW' 'Performance' "Temporary files: $tempMB MB" '-Optimize can clear old temp files.' }
if ($autoCount -gt 15) { Add-Finding 'LOW' 'Performance' "$autoCount programs start with Windows" 'Disable the ones you don''t need: Settings > Apps > Startup.' }

$top = Get-Process | Sort-Object WorkingSet64 -Descending | Select-Object -First 8 |
    ForEach-Object { "{0} ({1} MB)" -f $_.ProcessName, [math]::Round($_.WorkingSet64 / 1MB) }
Write-Host "  Top memory users: $($top -join ', ')"

$batt = Get-CimInstance Win32_Battery
$battReport = $null
if ($batt) {
    $battReport = Join-Path ([Environment]::GetFolderPath('Desktop')) 'battery-report.html'
    powercfg /batteryreport /output "$battReport" | Out-Null
    Write-Host "  Battery report saved: $battReport"
}

# ---- Report ----------------------------------------------------------------------------
$order = @{ HIGH = 0; MEDIUM = 1; LOW = 2; INFO = 3 }
$sorted = $findings | Sort-Object { $order[$_.Severity] }, Area
$counts = $findings | Group-Object Severity | ForEach-Object { "$($_.Count) $($_.Name)" }
Section 'Summary'
if (-not ($findings | Where-Object Severity -eq 'HIGH')) { Write-Host '  No high-severity problems found.' -ForegroundColor Green }
foreach ($f in $sorted | Where-Object Severity -in 'HIGH', 'MEDIUM') {
    $color = if ($f.Severity -eq 'HIGH') { 'Red' } else { 'Yellow' }
    Write-Host ("  [{0}] {1}: {2}" -f $f.Severity, $f.Area, $f.Item) -ForegroundColor $color
}
Write-Host "  Totals: $($counts -join ', ')"

$enc = { param($s) [System.Net.WebUtility]::HtmlEncode([string]$s) }
$rows = ($sorted | ForEach-Object {
    "<tr class='$($_.Severity)'><td>$($_.Severity)</td><td>$(& $enc $_.Area)</td><td>$(& $enc $_.Item)</td><td>$(& $enc $_.Detail)</td></tr>"
}) -join "`n"
$html = @"
<!DOCTYPE html><html><head><meta charset="utf-8"><title>PC Health $(Get-Date -Format 'yyyy-MM-dd')</title>
<style>body{font-family:Segoe UI,Arial;margin:24px;color:#222}table{border-collapse:collapse;width:100%}
td,th{border:1px solid #ddd;padding:6px;font-size:13px;vertical-align:top;word-break:break-word}th{background:#f3f3f3;text-align:left}
tr.HIGH td:first-child{background:#fdd;font-weight:bold}tr.MEDIUM td:first-child{background:#ffe9b3}tr.LOW td:first-child{background:#eef}</style></head><body>
<h2>PC Health Check: $env:COMPUTERNAME, $(Get-Date -Format 'yyyy-MM-dd HH:mm')</h2>
<p>$(& $enc $os.Caption) | $(& $enc $cpu.Name.Trim()) | $ramGB GB RAM | $env:SystemDrive $diskFreePct% free | $($disk.MediaType) $($disk.HealthStatus) | Admin: $isAdmin</p>
<p><b>Totals:</b> $($counts -join ', ')</p>
<p>LOW items are usually harmless (e.g. unsigned helper tools). Investigate HIGH items first. Search the file name and path, or upload this report for review.</p>
<table><tr><th>Severity</th><th>Area</th><th>Item</th><th>Detail</th></tr>
$rows
</table><p>Top memory users: $(& $enc ($top -join ', '))</p></body></html>
"@
$report = Join-Path ([Environment]::GetFolderPath('Desktop')) ("PC-Health-{0:yyyy-MM-dd_HHmm}.html" -f (Get-Date))
[IO.File]::WriteAllText($report, $html, (New-Object Text.UTF8Encoding $false))
Write-Host "`n  Full report: $report" -ForegroundColor Cyan

# ---- Optional tune-ups -----------------------------------------------------------------
if (-not $Optimize) { return }
function Ask($q) { (Read-Host "`n$q [y/N]") -match '^(y|yes)$' }
Section 'Optimize (each step asks first)'
if (Ask "Delete temporary files older than 2 days (~$tempMB MB in temp folders)?") {
    Get-ChildItem $env:TEMP, "$env:windir\Temp" -Recurse -Force -File | Where-Object LastWriteTime -lt (Get-Date).AddDays(-2) |
        Remove-Item -Force
    Write-Host '  Done (files in use were skipped).' -ForegroundColor Green
}
if (Ask 'Empty the Recycle Bin?') { Clear-RecycleBin -Force; Write-Host '  Done.' -ForegroundColor Green }
if ($plan -match 'saver' -and (Ask "Switch power plan from '$plan' to Balanced?")) { powercfg /setactive SCHEME_BALANCED; Write-Host '  Done.' -ForegroundColor Green }
if ($disk.MediaType -eq 'SSD' -and $isAdmin -and (Ask 'Run SSD TRIM on the system drive (safe, keeps the SSD fast)?')) {
    Optimize-Volume -DriveLetter ($env:SystemDrive.TrimEnd(':')) -ReTrim; Write-Host '  Done.' -ForegroundColor Green
}
if ($mp -and (Ask 'Update Defender definitions now?')) { Update-MpSignature; Write-Host '  Done.' -ForegroundColor Green }
if (Ask 'Open Startup apps settings so you can switch off programs you don''t need at boot?') { Start-Process 'ms-settings:startupapps' }
if ($isAdmin -and (Ask 'Repair Windows system files (DISM + SFC, 15-30 min)? Only needed if Windows feels unstable.')) {
    DISM /Online /Cleanup-Image /RestoreHealth
    & "$env:windir\System32\sfc.exe" /scannow
}
Write-Host "`nTune-up finished. Restart the laptop to get the full benefit." -ForegroundColor Cyan
