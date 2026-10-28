<#
.SYNOPSIS
  Finds TVs and streaming sticks on the local network: Fire TV / Firestick, Chromecast /
  Google TV, Roku, Samsung, LG and other smart TVs. Read-only: it only discovers and asks
  devices to identify themselves; it changes nothing.

.DESCRIPTION
  1. SSDP/UPnP discovery: TVs and sticks announce themselves with name, maker and model.
  2. Ping sweep of the subnet, then a quick check of the ports TV platforms listen on.
  3. Identity lookups: Google Cast (eureka_info), Roku (device-info), UPnP descriptions.
  Results print as a table and are saved to TV-Devices-<date>.csv on the Desktop.

.PARAMETER Subnet  First three octets to sweep, e.g. 192.168.1 (default: the PC's own /24).
.PARAMETER All     Also list every other device that answered (not just TVs/sticks).

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\Find-TVDevices.ps1
#>
[CmdletBinding()]
param(
    [string]$Subnet,
    [switch]$All
)

$ErrorActionPreference = 'SilentlyContinue'
$ProgressPreference = 'SilentlyContinue'

# Ports that identify TV platforms
$Ports = @{
    8008 = 'Google Cast'; 8009 = 'Google Cast'; 8443 = 'Google Cast'
    8060 = 'Roku ECP'
    8001 = 'Samsung'; 8002 = 'Samsung'
    3000 = 'LG webOS'; 3001 = 'LG webOS'
    5555 = 'Android ADB (Fire TV/Android TV)'
    7000 = 'AirPlay'
    9080 = 'Vizio'; 7345 = 'Vizio'
}

function Get-LocalSubnet {
    $cfg = Get-NetIPConfiguration | Where-Object { $_.IPv4DefaultGateway -and $_.NetAdapter.Status -eq 'Up' } |
        Select-Object -First 1
    if (-not $cfg) { throw 'No active network adapter with a gateway found. Pass -Subnet 192.168.1' }
    $ip = $cfg.IPv4Address.IPAddress
    return @{ Prefix = ($ip -replace '\.\d+$', ''); Self = $ip; Adapter = $cfg.InterfaceAlias }
}

function Get-Xml([string]$url) {
    try {
        $r = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 3
        return [xml]$r.Content
    } catch { return $null }
}

function Get-Json([string]$url) {
    try { return Invoke-RestMethod -Uri $url -TimeoutSec 3 } catch { return $null }
}

# ---- 1. SSDP discovery ------------------------------------------------------------------
function Invoke-SsdpDiscovery([string]$LocalIp, [int]$Seconds = 4) {
    $found = @{}
    $udp = New-Object System.Net.Sockets.UdpClient
    $udp.Client.ReceiveTimeout = 500
    $udp.Client.SetSocketOption('Socket', 'ReuseAddress', $true)
    # bind to the LAN adapter so the multicast doesn't leave via a VPN/virtual adapter
    $bindIp = if ($LocalIp) { [System.Net.IPAddress]::Parse($LocalIp) } else { [System.Net.IPAddress]::Any }
    $udp.Client.Bind((New-Object System.Net.IPEndPoint($bindIp, 0)))
    $target = New-Object System.Net.IPEndPoint([System.Net.IPAddress]::Parse('239.255.255.250'), 1900)
    foreach ($st in 'ssdp:all', 'urn:dial-multiscreen-org:service:dial:1', 'roku:ecp',
                    'urn:schemas-upnp-org:device:MediaRenderer:1') {
        $msg = "M-SEARCH * HTTP/1.1`r`nHOST: 239.255.255.250:1900`r`nMAN: `"ssdp:discover`"`r`nMX: 2`r`nST: $st`r`n`r`n"
        $bytes = [Text.Encoding]::ASCII.GetBytes($msg)
        [void]$udp.Send($bytes, $bytes.Length, $target)
    }
    $deadline = (Get-Date).AddSeconds($Seconds)
    while ((Get-Date) -lt $deadline) {
        try {
            $remote = New-Object System.Net.IPEndPoint([System.Net.IPAddress]::Any, 0)
            $data = [Text.Encoding]::ASCII.GetString($udp.Receive([ref]$remote))
        } catch { continue }
        $ip = $remote.Address.ToString()
        if (-not $found.ContainsKey($ip)) { $found[$ip] = @{ Locations = @(); Servers = @(); Types = @() } }
        foreach ($line in $data -split "`r`n") {
            if ($line -match '^LOCATION:\s*(.+)$') { $found[$ip].Locations += $Matches[1].Trim() }
            elseif ($line -match '^SERVER:\s*(.+)$') { $found[$ip].Servers += $Matches[1].Trim() }
            elseif ($line -match '^ST:\s*(.+)$') { $found[$ip].Types += $Matches[1].Trim() }
        }
    }
    $udp.Close()
    foreach ($ip in @($found.Keys)) {
        $e = $found[$ip]
        $e.Locations = $e.Locations | Select-Object -Unique
        $e.Servers = $e.Servers | Select-Object -Unique
        $e.Types = $e.Types | Select-Object -Unique
        foreach ($loc in $e.Locations) {
            $x = Get-Xml $loc
            if ($x -and $x.root.device) {
                $d = $x.root.device
                if (-not $e.Name -and $d.friendlyName) { $e.Name = [string]$d.friendlyName }
                if (-not $e.Maker -and $d.manufacturer) { $e.Maker = [string]$d.manufacturer }
                if (-not $e.Model -and $d.modelName) { $e.Model = "$($d.modelName) $($d.modelNumber)".Trim() }
            }
        }
    }
    return $found
}

# ---- 2. Ping sweep + port checks --------------------------------------------------------
function Invoke-PingSweep([string]$Prefix) {
    $tasks = @{}
    foreach ($i in 1..254) {
        $ip = "$Prefix.$i"
        $tasks[$ip] = (New-Object System.Net.NetworkInformation.Ping).SendPingAsync($ip, 800)
    }
    try { [Threading.Tasks.Task]::WaitAll([Threading.Tasks.Task[]]$tasks.Values) } catch { }
    return $tasks.Keys | Where-Object { $tasks[$_].Status -eq 'RanToCompletion' -and $tasks[$_].Result.Status -eq 'Success' }
}

function Get-OpenPorts([string[]]$Hosts) {
    $checks = @()
    foreach ($h in $Hosts) {
        foreach ($p in $Ports.Keys) {
            $c = New-Object System.Net.Sockets.TcpClient
            $checks += [pscustomobject]@{ Host = $h; Port = $p; Client = $c; Task = $c.ConnectAsync($h, $p) }
        }
    }
    Start-Sleep -Milliseconds 1500
    $open = @{}
    foreach ($c in $checks) {
        if ($c.Task.Status -eq 'RanToCompletion' -and $c.Client.Connected) {
            if (-not $open.ContainsKey($c.Host)) { $open[$c.Host] = @() }
            $open[$c.Host] += $c.Port
        }
        $c.Client.Close()
    }
    return $open
}

function Get-MacTable {
    $t = @{}
    foreach ($n in Get-NetNeighbor -AddressFamily IPv4) {
        if ($n.LinkLayerAddress -and $n.LinkLayerAddress -ne '00-00-00-00-00-00') { $t[$n.IPAddress] = $n.LinkLayerAddress }
    }
    return $t
}

function Get-HostName([string]$ip) {
    $task = [System.Net.Dns]::GetHostEntryAsync($ip)
    if ($task.Wait(800) -and $task.Result.HostName -ne $ip) { return $task.Result.HostName }
    return ''
}

# ---- 3. Classify ------------------------------------------------------------------------
function Get-DeviceType($info, [int[]]$open, [string]$hostName) {
    $text = ("{0} {1} {2} {3} {4}" -f $info.Name, $info.Maker, $info.Model, ($info.Servers -join ' '), $hostName).ToLower()
    if ($text -match 'amazon|aft[a-z]|fire ?tv|firestick') { return 'Amazon Fire TV / Firestick' }
    if ($text -match 'roku' -or $open -contains 8060) { return 'Roku' }
    if ($text -match 'nest|google home|home mini|hub|speaker' -and ($open -contains 8008 -or $text -match 'google')) {
        return 'Google Nest speaker/display (Cast, not a TV)'
    }
    if ($text -match 'chromecast|google tv|google|nvidia shield' -or ($open -contains 8008 -or $open -contains 8009)) {
        return 'Google Cast (Chromecast / Google TV / Cast-enabled TV)'
    }
    if ($text -match 'samsung' -or $open -contains 8001 -or $open -contains 8002) { return 'Samsung TV' }
    if ($text -match 'lg |lge|webos' -or $open -contains 3000 -or $open -contains 3001) { return 'LG TV' }
    if ($text -match 'vizio' -or $open -contains 9080 -or $open -contains 7345) { return 'Vizio TV' }
    if ($text -match 'sony|bravia|tcl|hisense|philips|sharp|panasonic|insignia|toshiba|apple ?tv') { return 'Smart TV / streamer' }
    if ($info.Types -match 'dial-multiscreen|MediaRenderer') { return 'Media device (DIAL / renderer)' }
    if ($open -contains 5555) { return 'Android device (ADB open)' }
    return $null
}

# ---- Run --------------------------------------------------------------------------------
$net = if ($Subnet) { @{ Prefix = $Subnet; Self = ''; Adapter = '(manual)' } } else { Get-LocalSubnet }
Write-Host "Scanning $($net.Prefix).0/24 on $($net.Adapter)..." -ForegroundColor Cyan

Write-Host '  [1/3] Listening for TV/streamer announcements (SSDP)...'
$ssdp = Invoke-SsdpDiscovery $net.Self

Write-Host '  [2/3] Finding live devices and checking TV ports...'
$alive = @(Invoke-PingSweep $net.Prefix) + @($ssdp.Keys | Where-Object { $_ -like "$($net.Prefix).*" }) |
    Where-Object { $_ -and $_ -ne $net.Self } | Sort-Object -Unique
$open = Get-OpenPorts $alive
$macs = Get-MacTable

Write-Host "  [3/3] Identifying $($alive.Count) devices..."
$results = foreach ($ip in $alive) {
    $info = if ($ssdp.ContainsKey($ip)) { $ssdp[$ip] } else { @{ Servers = @(); Types = @() } }
    $ports = if ($open.ContainsKey($ip)) { [int[]]$open[$ip] } else { @() }
    if ($ports -contains 8008) {
        $eureka = Get-Json "http://${ip}:8008/setup/eureka_info?params=name,device_info"
        if ($eureka) {
            if ($eureka.name) { $info.Name = $eureka.name }
            if ($eureka.device_info.model_name) { $info.Model = $eureka.device_info.model_name }
            if ($eureka.device_info.manufacturer) { $info.Maker = $eureka.device_info.manufacturer }
        }
    }
    if ($ports -contains 8060) {
        $roku = Get-Xml "http://${ip}:8060/query/device-info"
        if ($roku) {
            $r = $roku.'device-info'
            $info.Name = [string]($r.'user-device-name', $r.'friendly-device-name' | Where-Object { $_ } | Select-Object -First 1)
            $info.Model = "$($r.'model-name') $($r.'model-number')".Trim()
            $info.Maker = [string]$r.'vendor-name'
        }
    }
    $hostName = Get-HostName $ip
    $type = Get-DeviceType $info $ports $hostName
    if ($type -or $All) {
        [pscustomobject]@{
            Type     = if ($type) { $type } else { 'Other' }
            IP       = $ip
            Name     = $info.Name
            Maker    = $info.Maker
            Model    = $info.Model
            HostName = $hostName
            MAC      = $macs[$ip]
            TVPorts  = ($ports | ForEach-Object { "$_ ($($Ports[$_]))" }) -join ', '
        }
    }
}

$results = $results | Sort-Object Type, { [version]$_.IP }
$tvs = @($results | Where-Object Type -ne 'Other')
Write-Host ''
if ($tvs.Count) {
    Write-Host "Found $($tvs.Count) TV / streaming device(s):" -ForegroundColor Green
} else {
    Write-Host 'No TVs or streaming sticks answered. Make sure they are powered on (not deep standby) and on this network/VLAN.' -ForegroundColor Yellow
}
$results | Format-Table Type, IP, Name, Maker, Model, MAC -AutoSize -Wrap

$csv = Join-Path ([Environment]::GetFolderPath('Desktop')) ("TV-Devices-{0:yyyy-MM-dd_HHmm}.csv" -f (Get-Date))
$results | Export-Csv -NoTypeInformation -Path $csv
Write-Host "Saved: $csv"
