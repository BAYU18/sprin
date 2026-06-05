# ════════════════════════════════════════════════════════════════════════
# PrintServer IPP — Bulk Add Printers (auto-generated from server)
# ════════════════════════════════════════════════════════════════════════
# Generated: 2026-06-02
# Server: 192.168.1.141:631 (IPP)
# API:    192.168.1.141:3000
# Generated from /api/printers endpoint
#
# CARA PAKAI:
#   1. Buka PowerShell AS ADMINISTRATOR
#   2. Paste SELURUH script ini
#   3. Tunggu selesai
#   4. Printers akan muncul di Settings → Printers & Scanners
#
# Atau kalau mau 1 printer saja, copy bagian yang ada labelnya
# ════════════════════════════════════════════════════════════════════════

$ErrorActionPreference = 'Stop'
$serverHost = "192.168.1.141"
$ippPort    = 631
$apiUrl     = "http://$serverHost`:3000"
$driver     = "Generic / Microsoft IPP Class Driver"  # Built-in Windows driver

# ── Pre-flight checks ─────────────────────────────────────────────────
Write-Host "`n[Pre-flight] Checking environment...`n" -ForegroundColor Cyan

# 1. Check admin
$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Host "ERROR: Run PowerShell AS ADMINISTRATOR!" -ForegroundColor Red
    Write-Host "Right-click PowerShell → Run as administrator`n"
    exit 1
}
Write-Host "  [OK] Running as Administrator" -ForegroundColor Green

# 2. Check IPP server reachable
try {
    $test = Invoke-WebRequest -Uri "http://${serverHost}:$ippPort/printers" -Method Post -ContentType "application/ipp" -Body "test" -TimeoutSec 5 -ErrorAction Stop
    Write-Host "  [OK] IPP server reachable at ${serverHost}:$ippPort" -ForegroundColor Green
} catch {
    $code = $_.Exception.Response.StatusCode.value__
    if ($code -ge 400) {
        Write-Host "  [OK] IPP server reachable (got HTTP $code — body parser rejected probe, but server is up)" -ForegroundColor Green
    } else {
        Write-Host "  [WARN] Cannot reach IPP server: $_" -ForegroundColor Yellow
    }
}

# 3. Check driver exists
$preferredDrivers = @(
    'Generic / Microsoft IPP Class Driver',  # Windows 10 1903+ / Windows 11
    'Generic / Text Only',                   # All Windows
    'Microsoft Shared Fax Driver',           # Built-in
    'Microsoft Print To PDF',                # Universal
    'OneNote'                                # Universal
)

$driver = $null
foreach ($pref in $preferredDrivers) {
    $found = Get-PrinterDriver -Name $pref -ErrorAction SilentlyContinue
    if ($found) {
        $driver = $pref
        Write-Host "  [OK] Using preferred driver: $driver" -ForegroundColor Green
        break
    }
}

if (-not $driver) {
    Write-Host "  [WARN] No preferred driver found. Searching for any compatible driver..." -ForegroundColor Yellow
    # Try ANY driver that looks compatible with IPP/network
    $fallbackCandidates = Get-PrinterDriver | Where-Object {
        $_.Name -like "*Generic*" -or
        $_.Name -like "*Microsoft*" -or
        $_.Name -like "*IPP*" -or
        $_.Name -like "*Text Only*"
    } | Select-Object -ExpandProperty Name -First 5

    if ($fallbackCandidates) {
        $driver = $fallbackCandidates[0]
        Write-Host "  [OK] Using fallback driver: $driver" -ForegroundColor Green
        Write-Host "  Available alternatives:" -ForegroundColor Yellow
        $fallbackCandidates | ForEach-Object { Write-Host "       - $_" -ForegroundColor Yellow }
    } else {
        Write-Host "" -ForegroundColor Red
        Write-Host "  ERROR: No compatible driver found on this system." -ForegroundColor Red
        Write-Host "  Available drivers on this Windows:" -ForegroundColor Yellow
        Get-PrinterDriver | Select-Object -First 20 -ExpandProperty Name | ForEach-Object { Write-Host "       - $_" -ForegroundColor Yellow }
        Write-Host "" -ForegroundColor Red
        Write-Host "  Try one of these solutions:" -ForegroundColor Yellow
        Write-Host "    1. Run on Windows 10 (1903+) or Windows 11 — 'Generic / Microsoft IPP Class Driver' is built-in" -ForegroundColor Yellow
        Write-Host "    2. Install driver manually:" -ForegroundColor Yellow
        Write-Host "       pnputil /add-driver <driver.inf> /install" -ForegroundColor Yellow
        Write-Host "    3. Use 'Generic / Text Only' which is always available:" -ForegroundColor Yellow
        Write-Host "       Add-PrinterDriver -Name 'Generic / Text Only'" -ForegroundColor Yellow
        exit 1
    }
}

# ── Fetch printer list from server ─────────────────────────────────────
Write-Host "`n[Fetch] Querying $apiUrl/api/printers ...`n" -ForegroundColor Cyan
try {
    $apiResp = Invoke-RestMethod -Uri "$apiUrl/api/printers" -TimeoutSec 10
    $allPrinters = $apiResp
} catch {
    Write-Host "ERROR: Cannot reach API at $apiUrl : $_" -ForegroundColor Red
    exit 1
}

# Filter to node-bound printers (client_id != null) — these are the ones that route via IPP
$printers = $allPrinters | Where-Object { $_.client_id -ne $null }
Write-Host "  Found $($printers.Count) node-bound printer(s):" -ForegroundColor Green
$printers | ForEach-Object {
    $statusColor = if ($_.status -eq 'online') { 'Green' } else { 'Yellow' }
    Write-Host "    - $($_.name) [slug=$($_.slug), status=$($_.status)]" -ForegroundColor $statusColor
}

if ($printers.Count -eq 0) {
    Write-Host "`nNo node-bound printers found. Exiting." -ForegroundColor Yellow
    exit 0
}

# Show per-printer driver info
Write-Host "`n  Per-printer driver assignments:" -ForegroundColor Cyan
$printers | ForEach-Object {
    $drv = if ($_.driver_name) { $_.driver_name } else { '<unassigned → will use default>' }
    $drvColor = if ($_.driver_name) { 'White' } else { 'DarkGray' }
    Write-Host "    - $($_.name) [driver: $drv]" -ForegroundColor $drvColor
}

# ── Add each printer ───────────────────────────────────────────────────
Write-Host "`n[Install] Adding printers to Windows...`n" -ForegroundColor Cyan

$results = @()
foreach ($p in $printers) {
    $portUri = "ipp://${serverHost}:$ippPort/printers/$($p.slug)"
    $printerName = ($p.name -replace '[\\/:*?"<>|]', '_') + " (PrintServer)"

    # Per-printer driver: use assigned driver from PrintServer catalog, fallback to default
    $printerDriver = $driver  # default (validated, exists on this Windows)
    if ($p.driver_name) {
        # Check if the assigned driver exists on this Windows
        $assignedExists = Get-PrinterDriver -Name $p.driver_name -ErrorAction SilentlyContinue
        if ($assignedExists) {
            $printerDriver = $p.driver_name
            Write-Host "  → $printerName" -ForegroundColor White
            Write-Host "    URI:  $portUri" -ForegroundColor DarkGray
            Write-Host "    Driver: $printerDriver (from server catalog)" -ForegroundColor DarkGray
        } else {
            Write-Host "  → $printerName" -ForegroundColor White
            Write-Host "    URI:  $portUri" -ForegroundColor DarkGray
            Write-Host "    Driver: $printerDriver (fallback — assigned '$($p.driver_name)' not found locally)" -ForegroundColor Yellow
        }
    } else {
        Write-Host "  → $printerName" -ForegroundColor White
        Write-Host "    URI:  $portUri" -ForegroundColor DarkGray
        Write-Host "    Driver: $printerDriver (default — no assignment in catalog)" -ForegroundColor DarkGray
    }

    # Step 1: Add IPP port (idempotent — skip if exists)
    $existingPort = Get-PrinterPort -Name $portUri -ErrorAction SilentlyContinue
    if (-not $existingPort) {
        try {
            # Try modern syntax first (Win10 1903+)
            Add-PrinterPort -Name $portUri -PrinterHostAddress $serverHost -PortNumber $ippPort -ErrorAction Stop
            Write-Host "    [OK] Port added" -ForegroundColor Green
        } catch {
            try {
                # Fallback: use LPR port or generic TCP port
                $port = New-Object -ComObject WScript.Network
                $port.AddWindowsPrinterConnection($portUri)
                Write-Host "    [OK] Port added (COM fallback)" -ForegroundColor Green
            } catch {
                Write-Host "    [FAIL] Cannot add port: $_" -ForegroundColor Red
                $results += [PSCustomObject]@{ Printer = $printerName; Status = "FAILED_PORT"; Error = $_.Exception.Message }
                continue
            }
        }
    } else {
        Write-Host "    [SKIP] Port already exists" -ForegroundColor DarkGray
    }

    # Step 2: Add printer
    $existingPrinter = Get-Printer -Name $printerName -ErrorAction SilentlyContinue
    if ($existingPrinter) {
        Write-Host "    [SKIP] Printer already exists" -ForegroundColor DarkGray
        $results += [PSCustomObject]@{ Printer = $printerName; Status = "EXISTS"; Error = "" }
        continue
    }

    try {
        Add-Printer -Name $printerName -DriverName $printerDriver -PortName $portUri -ErrorAction Stop
        Write-Host "    [OK] Printer added" -ForegroundColor Green
        $results += [PSCustomObject]@{ Printer = $printerName; Status = "ADDED"; Error = "" }
    } catch {
        Write-Host "    [FAIL] Cannot add printer: $_" -ForegroundColor Red
        $results += [PSCustomObject]@{ Printer = $printerName; Status = "FAILED"; Error = $_.Exception.Message }
    }
    Write-Host ""
}

# ── Summary ────────────────────────────────────────────────────────────
Write-Host "════════════════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "  SUMMARY" -ForegroundColor Cyan
Write-Host "════════════════════════════════════════════════════════════════════" -ForegroundColor Cyan
$results | Format-Table -AutoSize

$added = ($results | Where-Object Status -eq 'ADDED').Count
$exists = ($results | Where-Object Status -eq 'EXISTS').Count
$failed = ($results | Where-Object Status -match 'FAILED').Count

Write-Host "  Added:   $added" -ForegroundColor Green
Write-Host "  Exists:  $exists" -ForegroundColor Gray
Write-Host "  Failed:  $failed" -ForegroundColor $(if ($failed -gt 0) { 'Red' } else { 'Gray' })

if ($added -gt 0 -or $exists -gt 0) {
    Write-Host "`n[Tip] Print test page: " -NoNewline -ForegroundColor Cyan
    Write-Host "Get-Printer | Where-Object Name -like '*PrintServer*' | ForEach-Object { (Get-Printer -Name \$_.Name | Out-Printer -InputObject 'Hello from PrintServer!' -ErrorAction SilentlyContinue) }" -ForegroundColor White
    Write-Host "`n[Tip] Or via notepad: " -NoNewline -ForegroundColor Cyan
    Write-Host "notepad /p test.txt`n" -ForegroundColor White
}

Write-Host "Done.`n"
