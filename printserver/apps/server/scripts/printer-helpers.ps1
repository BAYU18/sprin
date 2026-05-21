# ============================================
# PrintServer Pro - Windows Printer Helper Scripts
# PowerShell scripts untuk Node.js integration
# ============================================
# Usage: powershell.exe -ExecutionPolicy Bypass -File "printer-helpers.ps1" -Command "Get-PrinterList"
# ============================================

param(
    [Parameter(Mandatory=$true)]
    [ValidateSet('Get-PrinterList', 'Get-PrinterStatus', 'Send-PrintJob', 'Restart-Spooler', 'Clear-PrintQueue', 'Get-PrinterQueue')]
    [string]$Command,

    # Get-PrinterList params
    [Parameter(Mandatory=$false)]
    [switch]$ListAll,

    # Get-PrinterStatus params
    [Parameter(Mandatory=$false)]
    [string]$PrinterName,
    [Parameter(Mandatory=$false)]
    [switch]$Detailed,

    # Send-PrintJob params
    [Parameter(Mandatory=$false)]
    [string]$FilePath,
    [Parameter(Mandatory=$false)]
    [int]$Copies = 1,

    # Clear-PrintQueue params
    [Parameter(Mandatory=$false)]
    [switch]$ClearAll
)

$ErrorActionPreference = 'Stop'
$OutputEncoding = [Console]::OutputEncoding = [System.Text.Encoding]::UTF8

# ============================================
# Helper Functions
# ============================================

function Get-PrinterStatusText {
    param([int]$StatusCode)

    $statusMap = @{
        1 = @{ Status = 'other'; Description = 'Status lain'; }
        2 = @{ Status = 'unknown'; Description = 'Status tidak diketahui'; }
        3 = @{ Status = 'ready'; Description = 'Printer siap mencetak'; }
        4 = @{ Status = 'not_ready'; Description = 'Printer tidak siap'; }
        5 = @{ Status = 'printing'; Description = 'Sedang mencetak'; }
        6 = @{ Status = 'offline'; Description = 'Printer offline'; }
    }

    if ($statusMap.ContainsKey($StatusCode)) {
        return $statusMap[$StatusCode]
    }
    return @{ Status = 'error'; Description = "Status code tidak dikenal: $StatusCode" }
}

function Write-JsonResponse {
    param(
        [Parameter(Mandatory=$true)]
        [hashtable]$Data
    )
    $Data | ConvertTo-Json -Compress -Depth 10
}

# ============================================
# Get-PrinterList
# Mengembalikan semua printer dengan status
# ============================================
function Invoke-GetPrinterList {
    try {
        $printers = Get-Printer | ForEach-Object {
            $statusInfo = Get-PrinterStatusText -StatusCode $_.PrinterStatus
            $queueCount = (Get-PrintJob -PrinterName $_.Name -ErrorAction SilentlyContinue | Measure-Object).Count

            @{
                Name = $_.Name
                StatusCode = $_.PrinterStatus
                Status = $statusInfo.Status
                StatusDescription = $statusInfo.Description
                PortName = $_.PortName
                DriverName = $_.DriverName
                IsShared = $_.Shared
                ShareName = if ($_.ShareName) { $_.ShareName } else { $null }
                IsDefault = $_.Default
                IsOnline = ($_.PrinterStatus -eq 3)
                JobsInQueue = $queueCount
                Location = if ($_.Location) { $_.Location } else { $null }
            }
        }

        $result = @{
            Success = $true
            Command = 'Get-PrinterList'
            Timestamp = (Get-Date).ToString('o')
            Printers = @($printers)
            Count = ($printers | Measure-Object).Count
        }

        Write-JsonResponse -Data $result
    }
    catch {
        @{
            Success = $false
            Command = 'Get-PrinterList'
            Error = $_.Exception.Message
            Timestamp = (Get-Date).ToString('o')
        } | ConvertTo-Json -Compress
    }
}

# ============================================
# Get-PrinterStatus
# Cek status printer spesifik
# ============================================
function Invoke-GetPrinterStatus {
    param(
        [string]$Name,
        [bool]$IncludeDetails
    )

    try {
        $printer = Get-Printer -Name $Name -ErrorAction Stop

        $statusInfo = Get-PrinterStatusText -StatusCode $printer.PrinterStatus
        $port = Get-PrinterPort -Name $printer.PortName -ErrorAction SilentlyContinue

        $result = @{
            Success = $true
            Command = 'Get-PrinterStatus'
            Timestamp = (Get-Date).ToString('o')
            PrinterName = $Name
            StatusCode = $printer.PrinterStatus
            Status = $statusInfo.Status
            StatusDescription = $statusInfo.Description
            IsOnline = ($printer.PrinterStatus -eq 3)
            IsPrinting = ($printer.PrinterStatus -eq 5)
            IsOffline = ($printer.PrinterStatus -eq 6)
        }

        if ($IncludeDetails) {
            $jobs = Get-PrintJob -PrinterName $Name -ErrorAction SilentlyContinue
            $driver = Get-PrinterDriver -Name $printer.DriverName -ErrorAction SilentlyContinue

            $result.Detailed = @{
                PortName = $printer.PortName
                PortAddress = if ($port) { $port.PrinterHostAddress } else { $null }
                PortDescription = if ($port) { $port.Description } else { $null }
                DriverName = $printer.DriverName
                DriverVersion = if ($driver) { $driver.Version } else { $null }
                IsShared = $printer.Shared
                ShareName = $printer.ShareName
                IsDefault = $printer.Default
                Location = $printer.Location
                Comment = $printer.Comment
                JobsInQueue = ($jobs | Measure-Object).Count
                Jobs = @($jobs | ForEach-Object {
                    @{
                        JobId = $_.JobId
                        Document = $_.Document
                        Status = $_.Status.ToString()
                        PagesPrinted = $_.PagesPrinted
                        TotalPages = $_.TotalPages
                        SubmittedAt = $_.SubmitTime.ToString('o')
                        Owner = $_.Owner
                        Priority = $_.Priority
                    }
                })
            }
        }

        Write-JsonResponse -Data $result
    }
    catch {
        @{
            Success = $false
            Command = 'Get-PrinterStatus'
            Timestamp = (Get-Date).ToString('o')
            PrinterName = $Name
            StatusCode = 99
            Status = 'error'
            Error = $_.Exception.Message
        } | ConvertTo-Json -Compress
    }
}

# ============================================
# Send-PrintJob
# Kirim file ke printer
# ============================================
function Invoke-SendPrintJob {
    param(
        [string]$Name,
        [string]$Path,
        [int]$NumCopies
    )

    try {
        # Validasi file exists
        if (-not (Test-Path $Path -PathType Leaf)) {
            throw "File tidak ditemukan: $Path"
        }

        # Get file info
        $fileInfo = Get-Item $Path
        $ext = $fileInfo.Extension.ToLower()

        # Get printer
        $printer = Get-Printer -Name $Name -ErrorAction Stop

        $result = @{
            Success = $false
            Command = 'Send-PrintJob'
            Timestamp = (Get-Date).ToString('o')
            PrinterName = $Name
            FilePath = $Path
            FileName = $fileInfo.Name
            FileSize = $fileInfo.Length
            FileType = $ext
            Copies = $NumCopies
        }

        # Print based on file type
        if ($ext -eq '.pdf') {
            # PDF: Use Start-Process with PrintTo verb
            for ($i = 0; $i -lt $NumCopies; $i++) {
                $process = Start-Process -FilePath $Path `
                    -Verb PrintTo `
                    -ArgumentList $Name `
                    -Wait `
                    -NoNewWindow `
                    -PassThru

                if ($process.ExitCode -ne 0 -and $process.ExitCode -ne $null) {
                    throw "Print process exited dengan kode: $($process.ExitCode)"
                }
            }
            $result.Success = $true
            $result.Method = 'PrintTo'
        }
        elseif ($ext -in '.prn', '.raw') {
            # RAW: Copy directly to spool
            $spoolPath = "$env:SystemRoot\System32\spool\PRINTERS"
            $destFile = Join-Path $spoolPath "$([guid]::NewGuid().ToString()).SPL"

            # Stop spooler, copy, start spooler
            Stop-Service -Name Spooler -Force -ErrorAction SilentlyContinue
            try {
                Copy-Item -Path $Path -Destination $destFile -Force
                Start-Service -Name Spooler -ErrorAction Stop
                $result.Success = $true
                $result.Method = 'SpoolCopy'
                $result.SpoolFile = $destFile
            }
            catch {
                Start-Service -Name Spooler -ErrorAction SilentlyContinue
                throw "Gagal spool file: $($_.Exception.Message)"
            }
        }
        else {
            # Other files: Use Out-Printer
            for ($i = 0; $i -lt $NumCopies; $i++) {
                try {
                    # Try to read and print
                    $content = Get-Content -Path $Path -Raw -ErrorAction Stop
                    $content | Out-Printer -Name $Name
                }
                catch {
                    # Fallback: Use Start-Process
                    $process = Start-Process -FilePath $Path `
                        -Verb Print `
                        -ArgumentList "/p" `
                        -Wait `
                        -NoNewWindow `
                        -PassThru
                }
            }
            $result.Success = $true
            $result.Method = 'OutPrinter'
        }

        $result.CompletedAt = (Get-Date).ToString('o')
        Write-JsonResponse -Data $result
    }
    catch {
        @{
            Success = $false
            Command = 'Send-PrintJob'
            Timestamp = (Get-Date).ToString('o')
            PrinterName = $Name
            FilePath = $Path
            Error = $_.Exception.Message
        } | ConvertTo-Json -Compress
    }
}

# ============================================
# Restart-Spooler
# Restart Windows Print Spooler service
# ============================================
function Invoke-RestartSpooler {
    try {
        $spooler = Get-Service -Name Spooler -ErrorAction Stop
        $previousStatus = $spooler.Status

        if ($spooler.Status -eq 'Running') {
            Stop-Service -Name Spooler -Force -ErrorAction Stop
            Start-Sleep -Milliseconds 1500
        }

        Start-Service -Name Spooler -ErrorAction Stop
        $spooler = Get-Service -Name Spooler -ErrorAction Stop

        @{
            Success = $true
            Command = 'Restart-Spooler'
            Timestamp = (Get-Date).ToString('o')
            PreviousStatus = $previousStatus.ToString()
            CurrentStatus = $spooler.Status.ToString()
            Message = 'Print Spooler berhasil di-restart'
        } | ConvertTo-Json -Compress
    }
    catch {
        @{
            Success = $false
            Command = 'Restart-Spooler'
            Timestamp = (Get-Date).ToString('o')
            Error = $_.Exception.Message
        } | ConvertTo-Json -Compress
    }
}

# ============================================
# Clear-PrintQueue
# Hapus semua job di print queue
# ============================================
function Invoke-ClearPrintQueue {
    param([string]$Name)

    try {
        $jobs = Get-PrintJob -PrinterName $Name -ErrorAction SilentlyContinue
        $removedCount = 0
        $errors = @()

        foreach ($job in $jobs) {
            try {
                Remove-PrintJob -PrinterName $Name -JobId $job.JobId -ErrorAction Stop
                $removedCount++
            }
            catch {
                $errors += $_.Exception.Message
            }
        }

        @{
            Success = $true
            Command = 'Clear-PrintQueue'
            Timestamp = (Get-Date).ToString('o')
            PrinterName = $Name
            JobsRemoved = $removedCount
            Errors = if ($errors.Count -gt 0) { $errors } else { $null }
            RemainingJobs = ((Get-PrintJob -PrinterName $Name -ErrorAction SilentlyContinue | Measure-Object).Count)
        } | ConvertTo-Json -Compress
    }
    catch {
        @{
            Success = $false
            Command = 'Clear-PrintQueue'
            Timestamp = (Get-Date).ToString('o')
            PrinterName = $Name
            Error = $_.Exception.Message
        } | ConvertTo-Json -Compress
    }
}

# ============================================
# Get-PrinterQueue
# Ambil semua job di print queue
# ============================================
function Invoke-GetPrinterQueue {
    param([string]$Name)

    try {
        $jobs = Get-PrintJob -PrinterName $Name -ErrorAction Stop | ForEach-Object {
            @{
                JobId = $_.JobId
                Document = $_.Document
                Status = $_.Status.ToString()
                StatusMask = $_.Status
                PagesPrinted = $_.PagesPrinted
                TotalPages = $_.TotalPages
                Size = $_.Size
                SubmittedAt = $_.SubmitTime.ToString('o')
                Owner = $_.Owner
                Priority = $_.Priority
            }
        }

        @{
            Success = $true
            Command = 'Get-PrinterQueue'
            Timestamp = (Get-Date).ToString('o')
            PrinterName = $Name
            Jobs = @($jobs)
            Count = ($jobs | Measure-Object).Count
        } | ConvertTo-Json -Compress -Depth 3
    }
    catch {
        @{
            Success = $false
            Command = 'Get-PrinterQueue'
            Timestamp = (Get-Date).ToString('o')
            PrinterName = $Name
            Error = $_.Exception.Message
        } | ConvertTo-Json -Compress
    }
}

# ============================================
# Main Dispatcher
# ============================================

switch ($Command) {
    'Get-PrinterList' {
        Invoke-GetPrinterList
    }
    'Get-PrinterStatus' {
        Invoke-GetPrinterStatus -Name $PrinterName -IncludeDetails $Detailed
    }
    'Send-PrintJob' {
        Invoke-SendPrintJob -Name $PrinterName -Path $FilePath -NumCopies $Copies
    }
    'Restart-Spooler' {
        Invoke-RestartSpooler
    }
    'Clear-PrintQueue' {
        Invoke-ClearPrintQueue -Name $PrinterName
    }
    'Get-PrinterQueue' {
        Invoke-GetPrinterQueue -Name $PrinterName
    }
    default {
        @{ Error = "Unknown command: $Command" } | ConvertTo-Json -Compress
    }
}