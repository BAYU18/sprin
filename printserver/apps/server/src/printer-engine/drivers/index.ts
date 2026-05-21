import { logger } from '../../utils/logger.js';

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
// Driver Imports
// ============================================

import { WindowsPrinterDriver } from './windows-driver.js';

export { WindowsPrinterDriver };

// ============================================
// Factory Function
// ============================================

/**
 * createDriver - Factory function untuk membuat driver sesuai printer type
 *
 * @param fastify - Fastify instance untuk akses database dll
 * @param config - Printer configuration dari database
 * @returns PrinterDriver instance yang sesuai dengan type
 *
 * Supported types:
 * - 'windows', 'local', 'usb' → WindowsPrinterDriver
 * - 'network', 'tcp', 'ip' → NetworkPrinterDriver
 * - 'thermal', 'receipt' → ThermalPrinterDriver
 * - 'pdf', 'virtual' → PDFPrinterDriver
 */
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

// ============================================
// Network Printer Driver (TCP/IP)
// ============================================

export class NetworkPrinterDriver extends PrinterDriver {
    private host: string;
    private port: number;

    constructor(fastify: any, config: PrinterConfig) {
        super(fastify, config);

        // Parse host:port dari config.port
        // Format: "192.168.1.100:9100" atau "tcp://192.168.1.100:9100"
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
        const fs = await import('fs');
        const net = await import('net');

        // Validate file exists
        if (!fs.existsSync(filePath)) {
            throw new Error(`File not found: ${filePath}`);
        }

        this.log('info', `Printing ${filePath} to ${this.host}:${this.port}, ${copies} copies`);

        const fileBuffer = fs.readFileSync(filePath);

        return new Promise((resolve, reject) => {
            const client = new net.Socket();

            const timeout = setTimeout(() => {
                client.destroy();
                reject(new Error('Print job timed out after 30s'));
            }, 30000);

            client.connect(this.port, this.host, () => {
                this.log('info', `Connected to ${this.host}:${this.port}`);

                // Send copies sequentially
                let remaining = copies;

                const sendCopy = () => {
                    if (remaining > 0) {
                        remaining--;
                        client.write(fileBuffer);
                        if (remaining > 0) {
                            // Small delay between copies
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

        const fs = await import('fs');

        if (!fs.existsSync(filePath)) {
            throw new Error(`File not found: ${filePath}`);
        }

        const content = fs.readFileSync(filePath);

        // TODO: Implementasi actual thermal printing
        // Untuk sekarang, assume success
        this.log('info', `Thermal print: ${content.length} bytes, ${copies} copies`);

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

        const fs = await import('fs');

        if (!fs.existsSync(this.outputDir)) {
            fs.mkdirSync(this.outputDir, { recursive: true });
        }

        this.isInitialized = true;
    }

    async print(filePath: string, copies: number, options: any): Promise<boolean> {
        this.log('info', `Printing to PDF: ${filePath} → ${this.outputDir}`);

        const fs = await import('fs');
        const pathModule = await import('path');

        if (!fs.existsSync(filePath)) {
            throw new Error(`File not found: ${filePath}`);
        }

        const fileName = `${Date.now()}_${pathModule.basename(filePath)}`;
        const destPath = pathModule.join(this.outputDir, fileName);

        fs.copyFileSync(filePath, destPath);

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

export default { createDriver, PrinterDriver };