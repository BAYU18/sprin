# PrintServer Node Agent - Windows Installer
# Save as install.ps1 and run as Administrator
# Usage:
#   powershell -ExecutionPolicy Bypass -File install.ps1
#   powershell -ExecutionPolicy Bypass -File install.ps1 -ServerUrl "http://192.168.1.100:3000"

param(
    [string]$ServerUrl = "http://localhost:3000",
    [string]$InstallPath = "$env:ProgramFiles\PrintServer Agent"
)

$ErrorActionPreference = "Stop"

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  PrintServer Node Agent Installer" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Check for admin rights
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Host "[WARN] Not running as Administrator. Some features may not work." -ForegroundColor Yellow
    Write-Host "       Run as Admin to install as Windows service." -ForegroundColor Yellow
    Write-Host ""
}

# Check Node.js
$nodeVersion = & node --version 2>$null
if ($LASTEXITCODE -ne 0 -or -not $nodeVersion) {
    Write-Host "[ERROR] Node.js not found!" -ForegroundColor Red
    Write-Host "        Download from: https://nodejs.org" -ForegroundColor Yellow
    Write-Host "        This installer requires Node.js 16+ to build from source." -ForegroundColor Yellow
    Write-Host ""
    Write-Host "Alternatively, download a pre-built .exe from the releases page." -ForegroundColor Cyan
    Write-Host ""
    exit 1
}
Write-Host "[OK] Node.js $nodeVersion" -ForegroundColor Green

# Check npm
$npmVersion = & npm --version 2>$null
if ($LASTEXITCODE -ne 0) {
    Write-Host "[ERROR] npm not found" -ForegroundColor Red
    exit 1
}
Write-Host "[OK] npm $npmVersion" -ForegroundColor Green

# Create install directory
Write-Host ""
Write-Host "[INFO] Installing to: $InstallPath" -ForegroundColor Cyan

if (-not (Test-Path $InstallPath)) {
    New-Item -ItemType Directory -Path $InstallPath -Force | Out-Null
}

# Download or copy source
$scriptDir = $PSScriptRoot
$sourceZip = "$scriptDir\client-agent.zip"
$sourceDir = "$scriptDir\apps\client-agent"

if (Test-Path $sourceDir) {
    Write-Host "[INFO] Copying source from: $sourceDir" -ForegroundColor Cyan
    Copy-Item -Path "$sourceDir\*" -Destination $InstallPath -Recurse -Force
} elseif (Test-Path $sourceZip) {
    Write-Host "[INFO] Extracting source package..." -ForegroundColor Cyan
    Expand-Archive -Path $sourceZip -DestinationPath $InstallPath -Force
} else {
    Write-Host "[INFO] Source not found locally. Will clone from repository..." -ForegroundColor Yellow
    $gitClone = $false
    try {
        if (Get-Command git -ErrorAction SilentlyContinue) {
            & git clone https://github.com/BAYU18/sprin "$InstallPath\src" 2>$null
            $gitClone = $true
        }
    } catch {}
    
    if (-not $gitClone) {
        Write-Host "[ERROR] Cannot get source code." -ForegroundColor Red
        Write-Host "        Please download the source package manually." -ForegroundColor Yellow
        exit 1
    }
}

# Install dependencies
Write-Host ""
Write-Host "[INFO] Installing dependencies..." -ForegroundColor Cyan
Set-Location "$InstallPath"

# Update config
$configPath = "$InstallPath\config.json"
$defaultConfig = @{
    serverUrl = $ServerUrl
    checkInterval = 10000
    spoolDirs = @("C:\Users\*\AppData\Local\Temp")
    watchExtensions = @(".pdf", ".ps", ".prn", ".tif", ".tiff", ".png", ".jpg", ".jpeg")
    logLevel = "info"
} | ConvertTo-Json -Depth 10

# Try npm install (skip if node_modules already present)
if (-not (Test-Path "$InstallPath\node_modules")) {
    & npm install --silent 2>$null
    if ($LASTEXITCODE -ne 0) {
        Write-Host "[WARN] npm install had issues, but continuing..." -ForegroundColor Yellow
    }
}

# Build executable
Write-Host ""
Write-Host "[INFO] Building standalone executable..." -ForegroundColor Cyan

if (Test-Path "$InstallPath\node_modules\.bin\pkg") {
    & npm run build 2>$null
    if ($LASTEXITCODE -eq 0 -and (Test-Path "$InstallPath\dist\printserver-agent.exe")) {
        Write-Host "[OK] Build successful!" -ForegroundColor Green
    } else {
        Write-Host "[WARN] Build failed, but you can run with Node.js directly:" -ForegroundColor Yellow
        Write-Host "        node $InstallPath\src\index.js" -ForegroundColor Cyan
    }
} else {
    Write-Host "[INFO] pkg not installed. Skipping .exe build." -ForegroundColor Yellow
    Write-Host "       Install pkg globally with: npm install -g pkg" -ForegroundColor Cyan
}

# Create startup shortcut
Write-Host ""
Write-Host "[INFO] Creating startup shortcut..." -ForegroundColor Cyan

$exePath = if (Test-Path "$InstallPath\dist\printserver-agent.exe") {
    "$InstallPath\dist\printserver-agent.exe"
} else {
    "node $InstallPath\src\index.js"
}

$WshShell = New-Object -ComObject WScript.Shell
$Shortcut = $WshShell.CreateShortcut("$env:APPDATA\Microsoft\Windows\Start Menu\Programs\PrintServer Agent.lnk")
$Shortcut.TargetPath = "node"
$Shortcut.Arguments = "$InstallPath\src\index.js"
$Shortcut.WorkingDirectory = $InstallPath
$Shortcut.Description = "PrintServer Node Agent"
$Shortcut.Save()

# Install as service (if admin)
if ($isAdmin) {
    Write-Host ""
    Write-Host "[INFO] Installing as Windows service..." -ForegroundColor Cyan
    
    $serviceName = "PrintServerAgent"
    $serviceDesc = "PrintServer Pro Node Agent"
    
    # Check if service exists
    $existingService = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
    
    if ($existingService) {
        Write-Host "[INFO] Service already exists, removing..." -ForegroundColor Yellow
        Stop-Service -Name $serviceName -Force -ErrorAction SilentlyContinue
        & sc.exe delete $serviceName 2>$null
    }
    
    # Create service using nssm or sc
    $execPath = if (Test-Path "$InstallPath\dist\printserver-agent.exe") {
        "$InstallPath\dist\printserver-agent.exe"
    } else {
        "node"
        $execArgs = "$InstallPath\src\index.js"
    }
    
    $createService = @"
    sc create $serviceName binPath= "$nodePath $InstallPath\src\index.js" start= auto DisplayName= "$serviceDesc"
"@
    
    try {
        # Try using sc.exe directly
        $serviceBinary = "node `"$InstallPath\src\index.js`""
        & cmd /c "sc create $serviceName binPath= `"$serviceBinary`" start= auto DisplayName= `"$serviceDesc`"" 2>$null
        
        $newService = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
        if ($newService) {
            Write-Host "[OK] Service installed successfully!" -ForegroundColor Green
            
            # Set service to restart on failure
            & sc.exe failure $serviceName reset= 86400 actions= restart/5000/restart/10000/""
            
            # Start service
            Start-Service -Name $serviceName
            Write-Host "[OK] Service started" -ForegroundColor Green
        }
    } catch {
        Write-Host "[WARN] Could not install as service: $($_.Exception.Message)" -ForegroundColor Yellow
        Write-Host "       You can still run the agent manually." -ForegroundColor Cyan
    }
}

# Final status
Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Installation Complete!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Agent installed at: $InstallPath" -ForegroundColor White
Write-Host "Server URL: $ServerUrl" -ForegroundColor White
Write-Host ""
Write-Host "To run manually:" -ForegroundColor Cyan
if (Test-Path "$InstallPath\dist\printserver-agent.exe") {
    Write-Host "  $InstallPath\dist\printserver-agent.exe" -ForegroundColor White
} else {
    Write-Host "  node $InstallPath\src\index.js" -ForegroundColor White
}
Write-Host ""
Write-Host "Or use the Start Menu shortcut: PrintServer Agent" -ForegroundColor Cyan
Write-Host ""

# Start the agent
if (-not $isAdmin) {
    Write-Host "Starting agent (non-admin mode)..." -ForegroundColor Cyan
    Start-Process powershell -ArgumentList "-NoProfile -Command", "cd '$InstallPath'; node src/index.js" -WindowStyle Hidden
}

Write-Host "Done!" -ForegroundColor Green