# PrintServer Client

Windows desktop agent for PrintServer print management system.

## Features

- Connect to PrintServer API
- Monitor printer status
- Handle print jobs
- System tray integration

## Requirements

- Windows 10/11 (64-bit)
- .NET 6.0 Runtime or higher
- Admin rights for installation

## Installation

1. Download `PrintServer-Client-Setup.exe` from releases
2. Run as Administrator
3. Follow installation wizard
4. Enter server URL and node secret

## Development

```bash
npm install
npm run dev    # Development mode
npm run build  # Build for Windows
```

## Configuration

- Server URL: `http://your-server:3000`
- Node Secret: Get from Settings page in dashboard
## Build Status
Windows client build: GitHub Actions

# Build v1.0.1

## Build Status
v1.0.1 - GitHub Actions CI/CD
