# ═══ Quick Add — UNIVERSAL FALLBACK (works on any Windows) ═══
# Use this if the bulk script complains about driver.
# PowerShell Admin, paste this WHOLE block:

$ErrorActionPreference = 'Stop'
$preferred = @('Generic / Text Only', 'Generic / Microsoft IPP Class Driver', 'Microsoft Print To PDF', 'OneNote')
$driver = $null
foreach ($d in $preferred) {
    if (Get-PrinterDriver -Name $d -ErrorAction SilentlyContinue) { $driver = $d; break }
}
if (-not $driver) {
    Write-Host "ERROR: No printer driver found. Try: Add-PrinterDriver -Name 'Generic / Text Only'" -ForegroundColor Red
    exit 1
}
Write-Host "Using driver: $driver" -ForegroundColor Green

$server = "192.168.1.141"
$printers = @(
    @{ name = "EPSON L3110 Series (Copy 1)"; slug = "epson-l3110-series-copy-1" }
    @{ name = "EPSON L3110 Series";          slug = "epson-l3110-series" }
    @{ name = "Printers";                    slug = "printers" }
    @{ name = "EPSON L3210 Series";          slug = "epson-l3210-series" }
)

foreach ($p in $printers) {
    $portUri = "ipp://${server}:631/printers/$($p.slug)"
    $displayName = "$($p.name) (PrintServer)"
    try {
        $existing = Get-Printer -Name $displayName -ErrorAction SilentlyContinue
        if ($existing) {
            Write-Host "[SKIP] $displayName already exists" -ForegroundColor DarkGray
            continue
        }
        $existingPort = Get-PrinterPort -Name $portUri -ErrorAction SilentlyContinue
        if (-not $existingPort) {
            Add-PrinterPort -Name $portUri -PrinterHostAddress $server -PortNumber 631
        }
        Add-Printer -Name $displayName -DriverName $driver -PortName $portUri
        Write-Host "[OK]   Added: $displayName" -ForegroundColor Green
    } catch {
        Write-Host "[FAIL] $($p.name): $_" -ForegroundColor Red
    }
}

Write-Host "`nDone. Verify with: Get-Printer | Where-Object Name -like '*PrintServer*'" -ForegroundColor Cyan
