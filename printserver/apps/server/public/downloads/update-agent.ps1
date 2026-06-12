# ============================================================
# PrintServer Pro - Agent Updater (PowerShell)
# Dipanggil oleh manage-agent.bat menu [9] / auto-update.
# Semua logika update di sini supaya bebas dari masalah
# escaping batch + inline PowerShell.
#
# Param:
#   -ServerUrl  : base URL server (mis. http://192.168.1.141:3000)
#   -TargetDir  : folder agent (%APPDATA%\printserver-agent)
#   -TaskName   : nama Task Scheduler
# ============================================================
param(
    [string]$ServerUrl = "http://192.168.1.141:3000",
    [string]$TargetDir = "$env:APPDATA\printserver-agent",
    [string]$TaskName  = "PrintServerNodeAgent"
)

$ErrorActionPreference = 'Stop'
$ProcName    = 'printserver-agent.exe'
$ExePath     = Join-Path $TargetDir 'printserver-agent.exe'
$BackupPath  = Join-Path $TargetDir 'printserver-agent-backup.exe'
$VersionFile = Join-Path $TargetDir 'version.txt'
$TempExe     = Join-Path $env:TEMP 'printserver-agent-new.exe'

# Resolve Desktop defensively. GetFolderPath('Desktop') can return an empty
# string in non-interactive / SYSTEM / Task Scheduler context. Falling back to
# %USERPROFILE%\Desktop, then to $null (step 5 skipped) keeps a cosmetic step
# from aborting the whole update under $ErrorActionPreference='Stop'.
$DesktopDir = $null
try { $DesktopDir = [Environment]::GetFolderPath('Desktop') } catch { $DesktopDir = $null }
if ([string]::IsNullOrWhiteSpace($DesktopDir)) {
    if ($env:USERPROFILE) {
        $cand = Join-Path $env:USERPROFILE 'Desktop'
        if (Test-Path $cand) { $DesktopDir = $cand }
    }
}
if (-not [string]::IsNullOrWhiteSpace($DesktopDir)) {
    $ManagerPath = Join-Path $DesktopDir 'Manage-PrintServer-Agent.bat'
} else {
    $ManagerPath = $null
}

function Write-Step($n, $msg) { Write-Host ("[{0}/6] {1}" -f $n, $msg) -ForegroundColor Cyan }
function Write-Ok($msg)        { Write-Host ("      {0}" -f $msg) -ForegroundColor Green }
function Write-Err($msg)       { Write-Host ("[GAGAL] {0}" -f $msg) -ForegroundColor Red }

Write-Host "===================== UPDATE AGENT =====================" -ForegroundColor Yellow

# --- Cek versi server ---
try {
    $info       = Invoke-RestMethod -Uri "$ServerUrl/downloads/agent/info" -TimeoutSec 10
    $serverVer  = $info.version
    $serverSize = [math]::Round($info.size / 1MB, 1)
} catch {
    Write-Err "Tidak bisa fetch info server: $($_.Exception.Message)"
    exit 1
}

$localVer = 'unknown'
if (Test-Path $VersionFile) { $localVer = (Get-Content $VersionFile -Raw).Trim() }

Write-Host (" Versi saat ini : {0}" -f $localVer)
Write-Host (" Versi server   : {0}" -f $serverVer)
Write-Host (" Ukuran download: {0} MB" -f $serverSize)
Write-Host ""

# --- [1] Stop agent ---
Write-Step 1 "Menghentikan agent..."
schtasks /End /TN "$TaskName" 2>$null | Out-Null
Get-Process -Name 'printserver-agent' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2
Write-Ok "Agent stopped."
Write-Host ""

# --- [2] Download exe baru ---
Write-Step 2 "Download versi baru dari server..."
Write-Host ("      URL: {0}/downloads/agent" -f $ServerUrl)
if (Test-Path $TempExe) { Remove-Item $TempExe -Force -ErrorAction SilentlyContinue }
try {
    $wc = New-Object System.Net.WebClient
    $wc.DownloadFile("$ServerUrl/downloads/agent", $TempExe)
} catch {
    Write-Err "Download gagal: $($_.Exception.Message)"
    if (Test-Path $TempExe) { Remove-Item $TempExe -Force -ErrorAction SilentlyContinue }
    Write-Host "Agent tetap menggunakan versi lama." -ForegroundColor Yellow
    exit 1
}
if (-not (Test-Path $TempExe)) { Write-Err "File tidak ditemukan setelah download."; exit 1 }
$dlSize = (Get-Item $TempExe).Length
if ($dlSize -eq 0) { Write-Err "File download kosong (0 bytes)."; Remove-Item $TempExe -Force; exit 1 }
Write-Ok ("File: {0:N0} bytes ({1} MB)" -f $dlSize, ([math]::Round($dlSize/1MB,1)))
Write-Host ""

# --- [3] Backup versi lama ---
Write-Step 3 "Backup versi lama..."
if (Test-Path $ExePath) {
    Copy-Item $ExePath $BackupPath -Force
    Write-Ok "Backup: $BackupPath"
} else {
    Write-Ok "Tidak ada versi lama untuk di-backup."
}
Write-Host ""

# --- [4] Ganti executable ---
Write-Step 4 "Ganti executable..."
try {
    if (Test-Path $ExePath) { Remove-Item $ExePath -Force }
    Start-Sleep -Seconds 1
    Move-Item $TempExe $ExePath -Force
} catch {
    Write-Err "Gagal mengganti executable: $($_.Exception.Message)"
    if (Test-Path $BackupPath) { Copy-Item $BackupPath $ExePath -Force; Write-Host "      Backup direstore." -ForegroundColor Yellow }
    exit 1
}
if (-not (Test-Path $ExePath)) {
    Write-Err "Executable hilang setelah replace!"
    if (Test-Path $BackupPath) { Copy-Item $BackupPath $ExePath -Force }
    exit 1
}
Write-Ok "Executable diganti ke versi $serverVer"
Set-Content -Path $VersionFile -Value $serverVer -NoNewline
Write-Host ""

# --- [5] Update manage-agent.bat di Desktop ---
Write-Step 5 "Update Manage-PrintServer-Agent.bat di Desktop..."
if ([string]::IsNullOrWhiteSpace($ManagerPath)) {
    Write-Ok "Lewati (Desktop tidak terdeteksi di konteks ini)."
} else {
    try {
        Invoke-WebRequest -Uri "$ServerUrl/downloads/manage-agent.bat" -OutFile $ManagerPath -TimeoutSec 30
        Write-Ok "Manager bat diperbarui."
    } catch {
        Write-Ok "Lewati (gagal download manager bat)."
    }
}
Write-Host ""

# --- [6] Start agent + tunggu online ---
Write-Step 6 "Memulai agent baru..."
schtasks /Run /TN "$TaskName" 2>$null | Out-Null
Write-Host ""
Write-Host (" Menunggu server menerima heartbeat dari {0}..." -f $env:COMPUTERNAME)
Write-Host " ------------------------------------------------------------"

$maxTries = 20
$online   = $false
for ($i = 1; $i -le $maxTries; $i++) {
    try {
        $st = Invoke-RestMethod -Uri "$ServerUrl/downloads/node-status?hostname=$env:COMPUTERNAME" -TimeoutSec 4
        if ($st.online) {
            Write-Host (" [{0}] 100%" -f ('#' * 20))
            Write-Host ""
            Write-Host " ============================================================" -ForegroundColor Green
            Write-Host ("  [SUKSES] Agent ONLINE! Heartbeat {0}s lalu, IP {1}" -f $st.secondsAgo, $st.ip) -ForegroundColor Green
            Write-Host ("  Versi lama : {0}  ->  Versi baru : {1}" -f $localVer, $serverVer) -ForegroundColor Green
            Write-Host " ============================================================" -ForegroundColor Green
            $online = $true
            break
        }
    } catch { }
    $done = '#' * $i
    $left = '.' * ($maxTries - $i)
    $pct  = [math]::Floor($i * 100 / $maxTries)
    Write-Host (" [{0}{1}] {2}%  (percobaan {3}/{4})" -f $done, $left, $pct, $i, $maxTries)
    Start-Sleep -Seconds 3
}

if (-not $online) {
    Write-Host ""
    Write-Host " ============================================================" -ForegroundColor Red
    Write-Host "  [TIMEOUT] Server belum menerima heartbeat setelah 60 detik." -ForegroundColor Red
    Write-Host "  Update file SUDAH berhasil (versi $serverVer terpasang)." -ForegroundColor Yellow
    Write-Host "  Tapi agent belum konek. Cek:" -ForegroundColor Yellow
    Write-Host "   - Menu [5] Log untuk error agent"
    Write-Host "   - Koneksi/firewall ke $ServerUrl"
    Write-Host " ============================================================" -ForegroundColor Red
    exit 2
}

exit 0
