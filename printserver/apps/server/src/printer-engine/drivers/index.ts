import { logger } from '../../utils/logger.js';
import { exec as execCallback, spawn } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs';

const execAsync = promisify(execCallback);

// ============================================
// Types / Interfaces
// ============================================

export interface PrinterConfig {
    id: number;
    name: string;
    driver: string;
    port: string;
    type: string;
    capabilities?: any;
    config?: any;
}

export interface PrinterStatus {
    status: 'online' | 'offline' | 'busy' | 'error';
    jobsInQueue: number;
    paperStatus?: string;
    tonerLevel?: number;
    errorMessage?: string;
}

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

// ============================================
// Base Driver Class
// ============================================

export abstract class PrinterDriver {
    protected fastify: any;
    protected config: PrinterConfig;
    protected isInitialized: boolean = false;

    constructor(fastify: any, config: PrinterConfig) {
        this.fastify = fastify;
        this.config = config;
    }

    abstract initialize(): Promise<void>;
    abstract print(filePath: string, copies: number, options: any): Promise<boolean>;
    abstract healthCheck(): Promise<boolean>;
    abstract getStatus(): Promise<PrinterStatus>;

    isAvailable(): boolean {
        return this.isInitialized;
    }

    protected async updatePrinterStatus(status: string): Promise<void> {
        if (this.fastify?.knex) {
            try {
                await this.fastify.knex('printers')
                    .where({ id: this.config.id })
                    .update({ status });
            } catch (error) {
                logger.error(`[PrinterDriver] Failed to update status: ${error}`);
            }
        }
    }

    protected log(level: 'info' | 'warn' | 'error', message: string, data?: any): void {
        const prefix = `[PrinterDriver:${this.config.name}]`;
        logger[level](`${prefix} ${message}`, data || '');
    }
}

// ============================================
// Windows Printer Driver
// ============================================

const SCRIPT_PATH = process.env.PRINTER_SCRIPT_PATH
    || path.join(process.cwd(), 'scripts', 'printer-helpers.ps1');
const WINDOWS_SPOOL_DIR = 'C:\\PrintServer\\Spool';

export class WindowsPrinterDriver extends PrinterDriver {
    private powershellPath: string;
    private spoolDir: string;
    private scriptsPath: string;

    constructor(fastify: any, config: PrinterConfig) {
        super(fastify, config);

        this.powershellPath = 'powershell.exe';
        this.spoolDir = config.config?.spoolDir || WINDOWS_SPOOL_DIR;
        this.scriptsPath = config.config?.scriptsPath || SCRIPT_PATH;
        this.ensureSpoolDirectory();
    }

    private ensureSpoolDirectory(): void {
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
        this.log('info', 'Initializing WindowsPrinterDriver');

        // Test PowerShell availability
        try {
            await execAsync(`${this.powershellPath} -Command "Write-Output 'test'"`);
            this.log('info', 'PowerShell is available');
        } catch (error) {
            this.log('warn', 'PowerShell not available, driver will work in limited mode');
        }

        this.isInitialized = true;
    }

    async print(filePath: string, copies: number, options: any): Promise<boolean> {
        this.log('info', `Printing via Windows driver: ${filePath}, ${copies} copies`);

        // Copy file to spool directory
        const fileName = `${Date.now()}_${path.basename(filePath)}`;
        const spoolPath = path.join(this.spoolDir, fileName);

        try {
            fs.copyFileSync(filePath, spoolPath);
            this.log('info', `File copied to spool: ${spoolPath}`);

            // In a real implementation, this would call the PowerShell script
            // to send the file to the actual Windows printer
            this.log('info', `Print job submitted: ${this.config.name}`);
            return true;
        } catch (error) {
            this.log('error', `Print failed: ${error}`);
            return false;
        }
    }

    async healthCheck(): Promise<boolean> {
        return this.isInitialized;
    }

    async getStatus(): Promise<PrinterStatus> {
        return {
            status: 'online',
            jobsInQueue: 0
        };
    }
}

// ============================================
// Network Printer Driver (TCP/IP)
// ============================================

export class NetworkPrinterDriver extends PrinterDriver {
    private host: string;
    private port: number;

    constructor(fastify: any, config: PrinterConfig) {
        super(fastify, config);

        const portStr = config.port || '9100';

        if (portStr.startsWith('tcp://')) {
            const match = portStr.match(/tcp:\/\/([^:]+):(\d+)/);
            if (match) {
                this.host = match[1];
                this.port = parseInt(match[2]);
            } else {
                this.host = portStr.replace('tcp://', '');
                this.port = 9100;
            }
        } else if (portStr.includes(':')) {
            const parts = portStr.split(':');
            this.host = parts[0];
            this.port = parseInt(parts[1]) || 9100;
        } else {
            this.host = portStr;
            this.port = 9100;
        }
    }

    async initialize(): Promise<void> {
        this.log('info', `Initializing NetworkPrinterDriver: ${this.host}:${this.port}`);

        const isReachable = await this.testConnection();

        if (!isReachable) {
            this.log('warn', `Cannot reach ${this.host}:${this.port}, but continuing initialization`);
        }

        this.isInitialized = true;
        this.log('info', 'NetworkPrinterDriver initialized');
    }

    async print(filePath: string, copies: number, options: any): Promise<boolean> {
        const fsMod = await import('fs');
        const net = await import('net');

        if (!fsMod.existsSync(filePath)) {
            throw new Error(`File not found: ${filePath}`);
        }

        this.log('info', `Printing ${filePath} to ${this.host}:${this.port}, ${copies} copies`);

        const fileBuffer = fsMod.readFileSync(filePath);

        return new Promise((resolve, reject) => {
            const client = new net.Socket();

            const timeout = setTimeout(() => {
                client.destroy();
                reject(new Error('Print job timed out after 30s'));
            }, 30000);

            client.connect(this.port, this.host, () => {
                this.log('info', `Connected to ${this.host}:${this.port}`);

                let remaining = copies;

                const sendCopy = () => {
                    if (remaining > 0) {
                        remaining--;
                        client.write(fileBuffer);
                        if (remaining > 0) {
                            setImmediate(sendCopy);
                        } else {
                            client.end();
                        }
                    }
                };

                sendCopy();
            });

            client.on('close', () => {
                clearTimeout(timeout);
                this.log('info', 'Print data sent successfully');
                resolve(true);
            });

            client.on('error', (err) => {
                clearTimeout(timeout);
                this.log('error', `Connection error: ${err.message}`);
                client.destroy();
                reject(err);
            });

            client.on('timeout', () => {
                clearTimeout(timeout);
                client.destroy();
                reject(new Error('Connection timed out'));
            });
        });
    }

    async healthCheck(): Promise<boolean> {
        return this.testConnection();
    }

    async getStatus(): Promise<PrinterStatus> {
        const connected = await this.testConnection();

        return {
            status: connected ? 'online' : 'offline',
            jobsInQueue: 0
        };
    }

    private async testConnection(): Promise<boolean> {
        const net = await import('net');

        return new Promise((resolve) => {
            const client = new net.Socket();
            const timeoutId = setTimeout(() => {
                client.destroy();
                resolve(false);
            }, 5000);

            client.connect(this.port, this.host, () => {
                clearTimeout(timeoutId);
                client.destroy();
                resolve(true);
            });

            client.on('error', () => {
                clearTimeout(timeoutId);
                client.destroy();
                resolve(false);
            });
        });
    }
}

// ============================================
// Thermal Printer Driver (ESC/POS)
// ============================================

export class ThermalPrinterDriver extends PrinterDriver {
    private connectionType: 'usb' | 'serial' | 'bluetooth' | 'network';

    constructor(fastify: any, config: PrinterConfig) {
        super(fastify, config);
        this.connectionType = (config.config?.connection as any) || 'network';
    }

    async initialize(): Promise<void> {
        this.log('info', `Initializing ThermalPrinterDriver via ${this.connectionType}`);
        this.isInitialized = true;
    }

    async print(filePath: string, copies: number, options: any): Promise<boolean> {
        this.log('info', `Printing thermal receipt: ${filePath}`);

        const fsMod = await import('fs');

        if (!fsMod.existsSync(filePath)) {
            throw new Error(`File not found: ${filePath}`);
        }

        const content = fsMod.readFileSync(filePath);

        // TODO: Implementasi actual thermal printing
        this.log('info', `Thermal print: ${content.length} bytes, ${copies} copies`);

        return true;
    }

    async healthCheck(): Promise<boolean> {
        return this.isInitialized;
    }

    async getStatus(): PrinterStatus {
        return {
            status: 'online',
            jobsInQueue: 0
        };
    }
}

// ============================================
// PDF Virtual Printer Driver
// ============================================

export class PDFPrinterDriver extends PrinterDriver {
    private outputDir: string;

    constructor(fastify: any, config: PrinterConfig) {
        super(fastify, config);
        this.outputDir = config.config?.outputDir || './printed-pdf';
    }

    async initialize(): Promise<void> {
        this.log('info', `Initializing PDFPrinterDriver, output: ${this.outputDir}`);

        const fsMod = await import('fs');

        if (!fsMod.existsSync(this.outputDir)) {
            fsMod.mkdirSync(this.outputDir, { recursive: true });
        }

        this.isInitialized = true;
    }

    async print(filePath: string, copies: number, options: any): Promise<boolean> {
        this.log('info', `Printing to PDF: ${filePath} → ${this.outputDir}`);

        const fsMod = await import('fs');
        const pathMod = await import('path');

        if (!fsMod.existsSync(filePath)) {
            throw new Error(`File not found: ${filePath}`);
        }

        const fileName = `${Date.now()}_${pathMod.basename(filePath)}`;
        const destPath = pathMod.join(this.outputDir, fileName);

        fsMod.copyFileSync(filePath, destPath);

        this.log('info', `PDF saved: ${destPath}`);

        return true;
    }

    async healthCheck(): Promise<boolean> {
        return this.isInitialized;
    }

    async getStatus(): Promise<PrinterStatus> {
        return {
            status: 'online',
            jobsInQueue: 0
        };
    }
}

// ============================================
// Factory Function
// ============================================

export function createDriver(fastify: any, config: PrinterConfig): PrinterDriver {
    const type = (config.type || 'network').toLowerCase();

    logger.info(`[DriverFactory] Creating driver for "${config.name}" (type: ${type})`);

    switch (type) {
        case 'windows':
        case 'local':
        case 'usb':
            return new WindowsPrinterDriver(fastify, config);

        case 'network':
        case 'tcp':
        case 'ip':
            return new NetworkPrinterDriver(fastify, config);

        case 'thermal':
        case 'receipt':
        case 'escpos':
            return new ThermalPrinterDriver(fastify, config);

        case 'pdf':
        case 'virtual':
            return new PDFPrinterDriver(fastify, config);

        default:
            logger.warn(`[DriverFactory] Unknown type "${type}" for printer "${config.name}", defaulting to NetworkPrinterDriver`);
            return new NetworkPrinterDriver(fastify, config);
    }
}