# Virtual PDF Printer Setup Guide

## Overview
The PrintServer Client includes a virtual PDF printer that captures print jobs from any Windows application.

## How It Works

1. User prints from any application (Word, Excel, Browser, etc.)
2. Windows sends print job to "PrintServer PDF" virtual printer
3. Client Agent monitors the spool directory
4. PDF file is captured and uploaded to central server
5. Server routes job to appropriate physical printer

## Installation

### Option 1: Use Windows Built-in PDF Printer

Windows 10/11 includes "Microsoft Print to PDF" which can be used:

1. Enable "Microsoft Print to PDF" in Windows Features
2. Configure it to save to `C:\PrintServer\Spool`
3. Client Agent will automatically capture files

### Option 2: Bullzip PDF Printer

1. Download Bullzip PDF Printer from https://www.bullzip.com/products/pdf/info.php
2. Install with custom output folder: `C:\PrintServer\Spool`
3. Configure to auto-print (no GUI prompts)

### Option 3: PDFCreator

1. Download PDFCreator from https://pdfcreator.org/
2. Install and configure:
   - Output folder: `C:\PrintServer\Spool`
   - Auto-save mode enabled
   - No prompt for filename

## Spool Directory Setup

Create the spool directory:

```batch
mkdir C:\PrintServer\Spool
icacls C:\PrintServer\Spool /inheritance:r /grant "SYSTEM:(OI)(CI)F" /grant "Users:(OI)(CI)RX"
```

## Client Configuration

In the client config.json:

```json
{
  "serverUrl": "http://your-server:3000",
  "spoolDir": "C:\\PrintServer\\Spool",
  "checkInterval": 5000
}
```

## Supported File Types

- PDF (.pdf)
- PostScript (.ps)
- Print files (.prn)
- Images (.tif, .png, .jpg, .jpeg)

## Troubleshooting

### Files not being captured

1. Check spool directory exists
2. Verify client has read permissions
3. Check client logs for errors
4. Ensure printer is set to save to correct folder

### Large files timing out

Increase upload timeout in client config:
```json
{
  "uploadTimeout": 120000
}
```