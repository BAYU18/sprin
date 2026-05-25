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