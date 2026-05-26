# PrintServer Node Agent

Lightweight Windows print client agent for PrintServer Pro.

## Features

- **Auto Printer Discovery** — Scans local/network printers via WMIC, WMI, or registry
- **Spool Directory Monitoring** — Watches for new print files (.pdf, .ps, .prn, images)
- **Print Job Execution** — Silent printing via SumatraPDF or PowerShell
- **Central Server Communication** — Registers and heartbeats to PrintServer Pro
- **Offline Operation** — Works even if central server is unreachable
- **Cross-Platform** — Also runs on Linux/macOS via Node.js

## Requirements

- Node.js 16+ (on Windows)
- OR compiled standalone executable (pkg)

## Quick Start

### Option 1: Run with Node.js

```bash
cd apps/client-agent
npm install
node src/index.js
```

### Option 2: Run standalone .exe

Download `printserver-agent.exe` from releases and run.

## Configuration

Default config stored at: `%APPDATA%\printserver-agent\config.json`

Or use command line:
```bash
node src/index.js --config=my-config.json
```

### Config Options

```json
{
  "serverUrl": "http://192.168.1.100:3000",
  "checkInterval": 10000,
  "spoolDirs": [
    "C:\\Users\\*\\AppData\\Local\\Temp"
  ],
  "watchExtensions": [".pdf", ".ps", ".prn"],
  "logLevel": "info"
}
```

## Windows Installation (Standalone)

1. Download `printserver-agent.exe`
2. Run as Administrator first time (installs service)
3. Agent will appear in system tray
4. Right-click tray icon to configure

## Building Standalone .exe

```bash
cd apps/client-agent
npm install
npm run build
```

Output: `dist/printserver-agent.exe`

Requires: `pkg` npm package

## Running as Windows Service

For production, run as Windows service:

```powershell
# Install as service (requires admin)
sc create PrintServerAgent binPath= "C:\Program Files\PrintServer Agent\printserver-agent.exe --service"
sc start PrintServerAgent
```

## Uninstall

```powershell
sc stop PrintServerAgent
sc delete PrintServerAgent
# Also remove: %APPDATA%\printserver-agent
```