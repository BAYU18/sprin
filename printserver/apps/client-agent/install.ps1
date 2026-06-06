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
    Write-Host "[INFO] Installing as Windows service using NSSM..." -ForegroundColor Cyan
    
    $serviceName = "PrintServerAgent"
    $serviceDesc = "PrintServer Pro Node Agent"
    $nssmPath = "$InstallPath\nssm.exe"
    
    # Check if service exists
    $existingService = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
    if ($existingService) {
        Write-Host "[INFO] Service already exists, removing..." -ForegroundColor Yellow
        Stop-Service -Name $serviceName -Force -ErrorAction SilentlyContinue
        Start-Sleep -Seconds 1
        & sc.exe delete $serviceName 2>$null
    }
    
    # Download NSSM if not exists
    if (-not (Test-Path $nssmPath)) {
        Write-Host "[INFO] Downloading NSSM (Non-Sucking Service Manager)..." -ForegroundColor Cyan
        $nssmUrl = "https://nssm.cc/release/nssm-2.24.zip"
        $zipPath = "$env:TEMP\nssm.zip"
        $extractPath = "$env:TEMP\nssm-temp"
        
        try {
            [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
            Invoke-WebRequest -Uri $nssmUrl -OutFile $zipPath -UseBasicParsing
            Expand-Archive -Path $zipPath -DestinationPath $extractPath -Force
            
            # Copy 64-bit nssm.exe to install directory
            Copy-Item -Path "$extractPath\nssm-2.24\win64\nssm.exe" -Destination $nssmPath -Force
            
            # Cleanup temp files
            Remove-Item -Path $zipPath -Force
            Remove-Item -Path $extractPath -Recurse -Force
            Write-Host "[OK] NSSM downloaded successfully." -ForegroundColor Green
        } catch {
            Write-Host "[WARN] Failed to download NSSM: $($_.Exception.Message)" -ForegroundColor Yellow
            Write-Host "       Attempting to install using standard sc.exe..." -ForegroundColor Yellow
            $nssmPath = $null
        }
    }
    
    $exeFile = if (Test-Path "$InstallPath\dist\printserver-agent.exe") {
        "$InstallPath\dist\printserver-agent.exe"
    } else {
        "$InstallPath\src\index.js"
    }

    if ($nssmPath -and (Test-Path $nssmPath)) {
        try {
            # Use NSSM to create and configure the service
            if ($exeFile.EndsWith(".js")) {
                & $nssmPath install $serviceName "node" "`"$exeFile`" --config=`"$InstallPath\config.json`""
            } else {
                & $nssmPath install $serviceName "$exeFile" "--config=`"$InstallPath\config.json`""
            }
            
            & $nssmPath set $serviceName Description "$serviceDesc"
            & $nssmPath set $serviceName Start SERVICE_AUTO_START
            & $nssmPath set $serviceName AppDirectory "$InstallPath"
            
            # Redirect logs
            & $nssmPath set $serviceName AppStdout "$InstallPath\agent-out.log"
            & $nssmPath set $serviceName AppStderr "$InstallPath\agent-err.log"
            & $nssmPath set $serviceName AppRotateFiles 1
            & $nssmPath set $serviceName AppRotateOnline 1
            & $nssmPath set $serviceName AppRotateSeconds 86400
            & $nssmPath set $serviceName AppRotateBytes 1048576
            
            # Restart action on exit
            & $nssmPath set $serviceName AppExit Default Restart
            & $nssmPath set $serviceName AppThrottle 1500
            
            # Start service
            Start-Service -Name $serviceName
            Write-Host "[OK] Service installed and started successfully via NSSM!" -ForegroundColor Green
        } catch {
            Write-Host "[ERROR] NSSM installation failed: $($_.Exception.Message)" -ForegroundColor Red
        }
    } else {
        # Fallback using standard Windows sc
        try {
            $serviceBinary = if ($exeFile.EndsWith(".js")) {
                "node `"$exeFile`" --config=`"$InstallPath\config.json`""
            } else {
                "`"$exeFile`" --config=`"$InstallPath\config.json`""
            }
            & cmd /c "sc create $serviceName binPath= `"$serviceBinary`" start= auto DisplayName= `"$serviceDesc`"" 2>$null
            
            $newService = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
            if ($newService) {
                & sc.exe failure $serviceName reset= 86400 actions= restart/5000/restart/10000/""
                Start-Service -Name $serviceName
                Write-Host "[OK] Service installed and started using fallback sc.exe" -ForegroundColor Green
            }
        } catch {
            Write-Host "[WARN] Could not install as service: $($_.Exception.Message)" -ForegroundColor Yellow
        }
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