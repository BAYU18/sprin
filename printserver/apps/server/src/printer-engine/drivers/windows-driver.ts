import { PrinterDriver, PrinterStatus } from './index.js';
import { exec as execCallback, spawn } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs';
import { logger } from '../../utils/logger.js';

const execAsync = promisify(execCallback);

// Path untuk script PowerShell
const SCRIPT_PATH = process.env.PRINTER_SCRIPT_PATH
    || path.join(process.cwd(), 'scripts', 'printer-helpers.ps1');

// Direktori spool Windows
const WINDOWS_SPOOL_DIR = 'C:\\PrintServer\\Spool';

export interface WindowsPrinterInfo {
    Name: string;
    StatusCode: number;
    Status: 'ready' | 'offline' | 'not_ready' | 'printing' | 'other' | 'unknown' | 'error';
    StatusDescription: string;
    IsOnline: boolean;
    IsPrinting: boolean;
    IsOffline: boolean;
    PortName: string;
    DriverName: string;
    IsShared: boolean;
    ShareName: string | null;
    IsDefault: boolean;
    JobsInQueue: number;
    Location: string | null;
}

export interface PrinterJob {
    JobId: number;
    Document: string;
    Status: string;
    PagesPrinted: number;
    TotalPages: number;
    Size?: number;
    SubmittedAt: string;
    Owner: string;
    Priority: number;
}

export interface PowerShellResponse<T = any> {
    Success: boolean;
    Command: string;
    Timestamp: string;
    PrinterName?: string;
    Error?: string;
    [key: string]: T;
}

export class WindowsPrinterDriver extends PrinterDriver {
    private powershellPath: string;
    private spoolDir: string;
    private scriptsPath: string;

    constructor(fastify: any, config: any) {
        super(fastify, config);

        // Path ke PowerShell executable
        this.powershellPath = 'powershell.exe';

        // Direktori spool untuk file yang akan dicetak
        this.spoolDir = config.config?.spoolDir || WINDOWS_SPOOL_DIR;

        // Path ke script helper
        this.scriptsPath = config.config?.scriptsPath || SCRIPT_PATH;

        // Ensure spool directory exists
        this.ensureSpoolDirectory();
    }

    private async ensureSpoolDirectory(): Promise<void> {
        try {
            if (!fs.existsSync(this.spoolDir)) {
                fs.mkdirSync(this.spoolDir, { recursive: true });
                this.log('info', `Created spool directory: ${this.spoolDir}`);
            }
        } catch (error) {
            this.log('warn', `Could not create spool directory: ${error}`);
        }
    }

    async initialize(): Promise<void> {
        this.log('info', `Initializing WindowsPrinterDriver for: ${this.config.name}`);

        // Ensure spool directory exists
        await this.ensureSpoolDirectory();

        // Verify PowerShell script exists
        if (!fs.existsSync(this.scriptsPath)) {
            this.log('warn', `PowerShell script not found at: ${this.scriptsPath}`);
        }

        // Test connection ke printer
        const status = await this.getStatus();
        this.log('info', `Printer status: ${status.status}, queue: ${status.jobsInQueue}`);

        this.isInitialized = true;
        this.log('info', 'WindowsPrinterDriver initialized successfully');
    }

    /**
     * Convert Linux-style path ke Windows path
     * /mnt/c/PrintServer/Spool → C:\PrintServer\Spool
     */
    private normalizeToWindowsPath(filePath: string): string {
        if (!filePath) return '';

        let normalized = filePath
            // Handle UNC paths
            .replace(/^\/mnt\/([a-z])\//i, '$1:/')
            // Handle WSL paths
            .replace(/^\/([a-z])\//i, '$1:/')
            // Convert forward slashes ke backslash
            .replace(/\//g, '\\');

        // Remove duplicate backslashes
        normalized = normalized.replace(/\\\\+/g, '\\');

        return normalized;
    }

    /**
     * Execute PowerShell command dan parse JSON response
     */
    private async executePowerShell<T = any>(
        command: string,
        params: Record<string, any> = {},
        timeout: number = 30000
    ): Promise<PowerShellResponse<T>> {
        // Build arguments
        const args = [
            '-NoProfile',
            '-NonInteractive',
            '-ExecutionPolicy', 'Bypass',
            '-File', this.scriptsPath,
            '-Command', command
        ];

        // Add parameters
        for (const [key, value] of Object.entries(params)) {
            if (value !== undefined && value !== null) {
                // PowerShell parameter format: -ParamName "value"
                args.push(`-${key}`);
                if (typeof value === 'boolean') {
                    if (value) args.push('$true');
                } else if (typeof value === 'number') {
                    args.push(value.toString());
                } else {
                    args.push(`"${String(value).replace(/"/g, '`"')}"`);
                }
            }
        }

        const fullCommand = `${this.powershellPath} ${args.join(' ')}`;

        this.log('debug', `Executing PowerShell: ${command}`, { params });

        try {
            const { stdout, stderr } = await execAsync(fullCommand, {
                encoding: 'utf8',
                timeout,
                maxBuffer: 10 * 1024 * 1024, // 10MB buffer
                windowsHide: true
            });

            if (stderr) {
                this.log('warn', `PowerShell stderr: ${stderr}`);
            }

            const trimmedStdout = stdout.trim();

            if (!trimmedStdout) {
                return {
                    Success: false,
                    Command: command,
                    Timestamp: new Date().toISOString(),
                    Error: 'Empty response from PowerShell'
                };
            }

            try {
                const result = JSON.parse(trimmedStdout) as PowerShellResponse<T>;
                return result;
            } catch (parseError) {
                this.log('error', 'Failed to parse PowerShell JSON output', { stdout: trimmedStdout });
                return {
                    Success: false,
                    Command: command,
                    Timestamp: new Date().toISOString(),
                    Error: `JSON parse error: ${(parseError as Error).message}, raw: ${trimmedStdout.substring(0, 200)}`
                };
            }
        } catch (error: any) {
            this.log('error', `PowerShell execution failed: ${error.message}`, { code: error.code });

            // Handle specific error codes
            if (error.code === 'ENOENT') {
                return {
                    Success: false,
                    Command: command,
                    Timestamp: new Date().toISOString(),
                    Error: 'PowerShell executable not found'
                };
            }

            if (error.code === 'ETIMEDOUT' || error.killed) {
                return {
                    Success: false,
                    Command: command,
                    Timestamp: new Date().toISOString(),
                    Error: 'PowerShell command timed out'
                };
            }

            return {
                Success: false,
                Command: command,
                Timestamp: new Date().toISOString(),
                Error: error.message
            };
        }
    }

    /**
     * Tunggu file siap untuk dibaca (handle file locking)
     */
    private async waitForFileReady(filePath: string, maxWaitMs: number = 30000): Promise<boolean> {
        const startTime = Date.now();
        const checkInterval = 500;
        let lastSize = -1;

        while (Date.now() - startTime < maxWaitMs) {
            try {
                // Check if file exists and is accessible
                if (!fs.existsSync(filePath)) {
                    await sleep(checkInterval);
                    continue;
                }

                const stats = fs.statSync(filePath);

                // Check if file is still being written (size changing)
                if (stats.size === lastSize) {
                    // File size stable, try to open exclusive
                    try {
                        // Try opening file to check if it's accessible
                        const fd = fs.openSync(filePath, 'r+');
                        fs.closeSync(fd);
                        return true; // File is ready
                    } catch (e: any) {
                        if (e.code === 'EBUSY' || e.code === 'EACCES') {
                            // File is locked, wait
                            await sleep(checkInterval);
                            continue;
                        }
                        throw e;
                    }
                }

                lastSize = stats.size;
                await sleep(checkInterval);
            } catch (e: any) {
                if (e.code === 'ENOENT') {
                    // File not yet created
                    await sleep(checkInterval);
                    continue;
                }
                throw e;
            }
        }

        this.log('warn', `File not ready after ${maxWaitMs}ms: ${filePath}`);
        return false;
    }

    /**
     * Print file ke printer
     */
    async print(filePath: string, copies: number = 1, options: any = {}): Promise<boolean> {
        // Normalize path ke Windows format
        const windowsPath = this.normalizeToWindowsPath(filePath);

        this.log('info', `Printing: ${windowsPath}, ${copies} copies`);

        // Validasi file exists
        if (!fs.existsSync(windowsPath)) {
            throw new Error(`File not found: ${windowsPath}`);
        }

        // Tunggu file ready jika masih dalam proses upload
        const fileReady = await this.waitForFileReady(windowsPath);
        if (!fileReady) {
            throw new Error(`File is locked or still being written: ${windowsPath}`);
        }

        // Verify file size > 0
        const stats = fs.statSync(windowsPath);
        if (stats.size === 0) {
            throw new Error(`File is empty: ${windowsPath}`);
        }

        // Get printer status before printing
        const status = await this.getStatus();

        if (status.status === 'offline') {
            throw new Error(`Printer is offline: ${this.config.name}`);
        }

        if (status.status === 'busy') {
            throw new Error(`Printer is busy: ${this.config.name}`);
        }

        try {
            // Execute print via PowerShell
            const result = await this.executePowerShell('Send-PrintJob', {
                PrinterName: this.config.name,
                FilePath: windowsPath,
                Copies: copies
            }, 120000); // 2 minute timeout for large files

            if (!result.Success) {
                throw new Error(result.Error || 'Print command failed');
            }

            this.log('info', `Print job sent successfully`, {
                method: (result as any).Method,
                file: (result as any).FileName
            });

            await this.updatePrinterStatus('printing');

            return true;
        } catch (error) {
            this.log('error', `Print failed: ${(error as Error).message}`);
            await this.updatePrinterStatus('error');
            throw error;
        }
    }

    /**
     * Health check - apakah driver bisa diakses
     */
    async healthCheck(): Promise<boolean> {
        try {
            const result = await this.executePowerShell('Get-PrinterStatus', {
                PrinterName: this.config.name,
                Detailed: false
            }, 15000);

            return result.Success;
        } catch {
            return false;
        }
    }

    /**
     * Get detailed printer status
     */
    async getStatus(): Promise<PrinterStatus> {
        try {
            const result = await this.executePowerShell<{
                Status: string;
                StatusCode: number;
                StatusDescription: string;
                IsOnline: boolean;
                IsPrinting: boolean;
                IsOffline: boolean;
                JobsInQueue: number;
                Detailed?: {
                    Jobs: PrinterJob[];
                    PortAddress: string;
                    DriverName: string;
                };
            }>('Get-PrinterStatus', {
                PrinterName: this.config.name,
                Detailed: true
            }, 15000);

            if (!result.Success) {
                this.log('error', `GetStatus failed: ${result.Error}`);
                return {
                    status: 'offline',
                    jobsInQueue: 0,
                    errorMessage: result.Error
                };
            }

            // Map Windows status ke unified status
            let status: PrinterStatus['status'];
            let errorMessage: string | undefined;

            switch (result.Status) {
                case 'ready':
                    status = 'online';
                    break;
                case 'printing':
                    status = 'busy';
                    break;
                case 'offline':
                    status = 'offline';
                    errorMessage = 'Printer is offline';
                    break;
                case 'not_ready':
                    status = 'busy';
                    errorMessage = 'Printer is not ready';
                    break;
                case 'error':
                    status = 'error';
                    errorMessage = result.Error || 'Printer error';
                    break;
                default:
                    status = 'online';
            }

            return {
                status,
                jobsInQueue: result.JobsInQueue || 0,
                errorMessage
            };
        } catch (error: any) {
            this.log('error', `getStatus exception: ${error.message}`);
            return {
                status: 'offline',
                jobsInQueue: 0,
                errorMessage: error.message
            };
        }
    }

    /**
     * Restart Print Spooler service (untuk auto-healing)
     */
    async restartSpoolerService(): Promise<{ success: boolean; message: string }> {
        this.log('info', 'Restarting Print Spooler service...');

        try {
            const result = await this.executePowerShell('Restart-Spooler', {}, 60000);

            if (result.Success) {
                this.log('info', 'Spooler restarted successfully');
                return {
                    success: true,
                    message: 'Print Spooler service restarted successfully'
                };
            } else {
                this.log('error', `Spooler restart failed: ${result.Error}`);
                return {
                    success: false,
                    message: result.Error || 'Restart failed'
                };
            }
        } catch (error: any) {
            return {
                success: false,
                message: error.message
            };
        }
    }

    /**
     * Clear print queue (untuk auto-healing)
     */
    async clearPrintQueue(): Promise<{ success: boolean; jobsRemoved: number; message: string }> {
        this.log('info', `Clearing print queue for: ${this.config.name}`);

        try {
            const result = await this.executePowerShell<{
                JobsRemoved: number;
                RemainingJobs: number;
            }>('Clear-PrintQueue', {
                PrinterName: this.config.name
            }, 60000);

            if (result.Success) {
                this.log('info', `Cleared ${result.JobsRemoved} jobs from queue`);
                return {
                    success: true,
                    jobsRemoved: result.JobsRemoved || 0,
                    message: `Removed ${result.JobsRemoved || 0} jobs from queue`
                };
            } else {
                return {
                    success: false,
                    jobsRemoved: 0,
                    message: result.Error || 'Clear failed'
                };
            }
        } catch (error: any) {
            return {
                success: false,
                jobsRemoved: 0,
                message: error.message
            };
        }
    }

    /**
     * Get all jobs in print queue
     */
    async getPrintJobs(): Promise<PrinterJob[]> {
        try {
            const result = await this.executePowerShell<{
                Jobs: PrinterJob[];
                Count: number;
            }>('Get-PrinterQueue', {
                PrinterName: this.config.name
            }, 15000);

            if (result.Success && result.Jobs) {
                return result.Jobs;
            }

            return [];
        } catch {
            return [];
        }
    }

    /**
     * Cancel specific print job
     */
    async cancelPrintJob(jobId: number): Promise<boolean> {
        this.log('info', `Cancelling print job: ${jobId}`);

        try {
            // Use PowerShell directly for single job cancellation
            const psCommand = `
                Remove-PrintJob -PrinterName '${this.config.name.replace(/'/g, "''")}' -JobId ${jobId} -ErrorAction Stop
            `;

            await execAsync(
                `${this.powershellPath} -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "${psCommand}"`,
                { encoding: 'utf8', timeout: 10000 }
            );

            return true;
        } catch (error) {
            this.log('error', `Failed to cancel job ${jobId}: ${error}`);
            return false;
        }
    }

    /**
     * Get printer capabilities
     */
    async getPrinterCapabilities(): Promise<any> {
        const status = await this.getStatus();
        const jobs = await this.getPrintJobs();

        return {
            name: this.config.name,
            driver: this.config.driver,
            port: this.config.port,
            type: 'windows',
            status: status.status,
            isOnline: status.status === 'online',
            currentQueueSize: jobs.length,
            spoolDirectory: this.spoolDir
        };
    }

    private async updatePrinterStatus(status: string): Promise<void> {
        if (this.fastify?.knex) {
            try {
                await this.fastify.knex('printers')
                    .where({ id: this.config.id })
                    .update({ status });
            } catch (error) {
                this.log('warn', `Failed to update printer status in DB: ${error}`);
            }
        }
    }

    /**
     * Cleanup old files in spool directory (older than 24 hours)
     */
    async cleanupSpool(maxAgeHours: number = 24): Promise<{ filesRemoved: number; bytesFreed: number }> {
        this.log('info', `Cleaning spool directory: ${this.spoolDir}`);

        let filesRemoved = 0;
        let bytesFreed = 0;
        const maxAgeMs = maxAgeHours * 60 * 60 * 1000;
        const now = Date.now();

        try {
            if (!fs.existsSync(this.spoolDir)) {
                return { filesRemoved, bytesFreed };
            }

            const files = fs.readdirSync(this.spoolDir);

            for (const file of files) {
                const filePath = path.join(this.spoolDir, file);
                const stats = fs.statSync(filePath);

                if (stats.isFile() && (now - stats.mtimeMs) > maxAgeMs) {
                    bytesFreed += stats.size;
                    fs.unlinkSync(filePath);
                    filesRemoved++;
                    this.log('debug', `Removed old spool file: ${file}`);
                }
            }

            this.log('info', `Spool cleanup done: ${filesRemoved} files, ${bytesFreed} bytes freed`);
        } catch (error) {
            this.log('error', `Spool cleanup failed: ${(error as Error).message}`);
        }

        return { filesRemoved, bytesFreed };
    }

    /**
     * Get all printers on this Windows node
     */
    async getPrinterList(): Promise<WindowsPrinterInfo[]> {
        try {
            const result = await this.executePowerShell<{
                Printers: WindowsPrinterInfo[];
                Count: number;
            }>('Get-PrinterList', {}, 30000);

            if (result.Success && result.Printers) {
                return result.Printers;
            }

            return [];
        } catch (error) {
            this.log('error', `getPrinterList failed: ${(error as Error).message}`);
            return [];
        }
    }

    /**
     * Cleanup resources
     */
    dispose(): void {
        this.log('info', 'WindowsPrinterDriver disposed');
    }
}

// Helper function
function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

export default WindowsPrinterDriver;