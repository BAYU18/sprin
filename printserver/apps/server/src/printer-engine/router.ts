import { FastifyInstance } from 'fastify';
import { logger } from '../utils/logger.js';
import { createDriver, PrinterDriver, PrinterStatus } from './drivers/index.js';
import { addPrintJob, printQueue } from '../queues/index.js';
import path from 'path';

export interface PrintJobData {
    userId: number;
    clientId: number;
    printerId: number;
    filePath: string;
    fileName: string;
    fileType: string;
    copies?: number;
    options?: any;
}

export interface ProcessJobData {
    jobId: number;
    printerId: number;
    filePath: string;
    copies: number;
    options: any;
}

export class PrintRouter {
    private fastify: FastifyInstance;
    private drivers: Map<number, PrinterDriver>;
    private failoverMap: Map<number, number[]>;
    private healthCheckInterval: NodeJS.Timeout | null = null;

    constructor(fastify: FastifyInstance) {
        this.fastify = fastify;
        this.drivers = new Map();
        this.failoverMap = new Map();
    }

    async initialize(): Promise<void> {
        logger.info('[PrintRouter] Initializing...');

        await this.loadPrinters();
        await this.setupFailoverMap();
        this.startHealthCheck();

        logger.info('[PrintRouter] Initialization complete');
    }

    /**
     * Load semua printer dari database dan inisialisasi driver masing-masing
     */
    private async loadPrinters(): Promise<void> {
        const printers = await this.fastify.knex('printers')
            .leftJoin('printer_groups', 'printers.group_id', 'printer_groups.id')
            .select('printers.*', 'printer_groups.name as group_name');

        logger.info(`[PrintRouter] Loading ${printers.length} printers...`);

        for (const printer of printers) {
            // Normalize config (parse JSON string if needed)
            if (printer.config) {
                try {
                    const config = typeof printer.config === 'string'
                        ? JSON.parse(printer.config)
                        : printer.config;
                    printer.config = config;
                } catch (e) {
                    logger.warn(`[PrintRouter] Failed to parse config for printer ${printer.id}`);
                }
            }

            // Create driver sesuai type
            const driver = createDriver(this.fastify, printer);
            this.drivers.set(printer.id, driver);

            // Initialize driver async (don't block)
            driver.initialize()
                .then(() => {
                    logger.info(`[PrintRouter] Driver initialized: ${printer.name}`);
                })
                .catch((error) => {
                    logger.error(`[PrintRouter] Failed to init driver for ${printer.name}:`, error);
                });
        }

        logger.info(`[PrintRouter] Loaded ${printers.length} printers with drivers`);
    }

    /**
     * Setup failover map untuk printer grouping
     */
    private async setupFailoverMap(): Promise<void> {
        const printers = await this.fastify.knex('printers')
            .whereNotNull('group_id')
            .where('status', '!=', 'offline');

        for (const printer of printers) {
            // Get printers in same group, ordered by priority (higher = preferred)
            const groupPrinters = await this.fastify.knex('printers')
                .where('group_id', printer.group_id)
                .where('id', '!=', printer.id)
                .where('status', '!=', 'offline')
                .orderBy('priority', 'desc');

            const failoverIds = groupPrinters.map(p => p.id);

            if (failoverIds.length > 0) {
                this.failoverMap.set(printer.id, failoverIds);
                logger.info(`[PrintRouter] Failover chain for ${printer.name}: [${failoverIds.join(', ')}]`);
            }
        }
    }

    /**
     * Submit print job baru
     */
    async submitJob(data: PrintJobData): Promise<{ jobId: string; queuePosition: number }> {
        const {
            userId,
            clientId,
            printerId,
            filePath,
            fileName,
            fileType,
            copies = 1,
            options = {}
        } = data;

        // Validasi printer exists
        const printer = await this.fastify.knex('printers').where({ id: printerId }).first();
        if (!printer) {
            throw new Error(`Printer ${printerId} not found`);
        }

        // Check user quota
        const user = await this.fastify.knex('users').where({ id: userId }).first();
        if (user) {
            const estimatedPages = options.pages || await this.estimatePages(filePath, fileType);
            const totalPages = estimatedPages * copies;

            if (user.quota_used + totalPages > user.quota_pages) {
                throw new Error(`Quota exceeded: ${user.quota_used}/${user.quota_pages} pages used`);
            }
        }

        // Create print job record
        const [printJob] = await this.fastify.knex('print_jobs')
            .insert({
                user_id: userId,
                client_id: clientId,
                printer_id: printerId,
                job_name: fileName,
                source_app: options.sourceApp,
                file_name: fileName,
                file_path: filePath,
                file_type: fileType,
                file_size: options.fileSize,
                pages: options.pages || 1,
                copies: copies,
                status: 'queued',
                priority: options.priority || 'normal'
            })
            .returning('*');

        // Add to queue
        const queuePosition = await this.getQueuePosition(printerId);
        await this.fastify.knex('queues')
            .insert({
                print_job_id: printJob.id,
                printer_id: printerId,
                position: queuePosition,
                status: 'waiting'
            });

        // Publish to Redis for real-time updates
        await this.fastify.redis.publish('printserver:jobs', JSON.stringify({
            type: 'job_created',
            job: printJob
        }));

        // Emit to Socket.IO clients
        this.fastify.io?.emit('job:new', printJob);

        // Add to BullMQ job queue (non-blocking)
        const job = await addPrintJob({
            jobId: printJob.id,
            printerId: printerId,
            filePath: filePath,
            fileName: fileName,
            copies: copies,
            options: options
        });

        logger.info(`[PrintRouter] Job submitted: ${printJob.job_id} to printer ${printerId}`);

        return { jobId: printJob.job_id, queuePosition };
    }

    /**
     * Process print job dari queue
     */
    async processJob(data: ProcessJobData): Promise<{ success: boolean; error?: string }> {
        const { jobId, printerId, filePath, copies, options } = data;

        logger.info(`[PrintRouter] Processing job ${jobId} on printer ${printerId}`);

        // Get job from database
        const job = await this.fastify.knex('print_jobs').where({ id: jobId }).first();
        if (!job) {
            logger.error(`[PrintRouter] Job ${jobId} not found in database`);
            return { success: false, error: 'Job not found' };
        }

        // Get driver
        let driver = this.drivers.get(printerId);
        if (!driver) {
            logger.error(`[PrintRouter] Driver for printer ${printerId} not found`);
            return { success: false, error: 'Driver not found' };
        }

        // Try to print
        try {
            // Update status to processing
            await this.fastify.knex('print_jobs')
                .where({ id: jobId })
                .update({
                    status: 'processing',
                    started_at: new Date()
                });

            // Execute print
            await driver.print(filePath, copies, options);

            // Success - update job status
            await this.fastify.knex('print_jobs')
                .where({ id: jobId })
                .update({
                    status: 'completed',
                    completed_at: new Date()
                });

            // Update queue status
            await this.fastify.knex('queues')
                .where({ print_job_id: jobId })
                .update({ status: 'completed', completed_at: new Date() });

            // Update user quota
            if (job.user_id) {
                await this.fastify.knex('users')
                    .where({ id: job.user_id })
                    .increment('quota_used', job.pages * copies);
            }

            // Emit completion event
            this.fastify.io?.emit('job:complete', {
                jobId: job.job_id,
                printerId: printerId,
                status: 'completed'
            });

            logger.info(`[PrintRouter] Job ${jobId} completed successfully`);

            return { success: true };

        } catch (error: any) {
            logger.error(`[PrintRouter] Job ${jobId} failed: ${error.message}`);

            // Update job with error
            await this.fastify.knex('print_jobs')
                .where({ id: jobId })
                .update({
                    status: 'failed',
                    error_message: error.message,
                    attempts: job.attempts + 1
                });

            // Handle failure (retry or failover)
            const shouldRetry = await this.handleFailure(jobId, printerId, error.message);

            return { success: false, error: error.message };
        }
    }

    /**
     * Handle job failure - retry atau failover
     */
    private async handleFailure(
        jobId: number,
        printerId: number,
        errorMessage: string
    ): Promise<boolean> {
        const job = await this.fastify.knex('print_jobs').where({ id: jobId }).first();
        const maxAttempts = parseInt(process.env.JOB_RETRY_ATTEMPTS || '3');

        logger.info(`[PrintRouter] Handling failure for job ${jobId}, attempt ${job.attempts + 1}/${maxAttempts}`);

        // Check if can retry on same printer
        if (job.attempts < maxAttempts) {
            // Exponential backoff delay
            const delay = Math.min(1000 * Math.pow(2, job.attempts), 30000);
            logger.info(`[PrintRouter] Will retry job ${jobId} after ${delay}ms`);

            // Schedule retry
            setTimeout(() => {
                addPrintJob({
                    jobId: job.id,
                    printerId: printerId,
                    filePath: job.file_path,
                    copies: job.copies,
                    options: {}
                });
            }, delay);

            return true;
        }

        // Try failover to another printer in group
        const failovers = this.failoverMap.get(printerId) || [];

        for (const failoverId of failovers) {
            const failoverDriver = this.drivers.get(failoverId);

            if (!failoverDriver || !failoverDriver.isAvailable()) {
                continue;
            }

            // Check failover printer status
            const status = await failoverDriver.getStatus();
            if (status.status === 'online') {
                logger.info(`[PrintRouter] Failing over job ${jobId} from printer ${printerId} to ${failoverId}`);

                // Update queue to use new printer
                await this.fastify.knex('queues')
                    .where({ print_job_id: jobId })
                    .update({
                        printer_id: failoverId,
                        status: 'waiting'
                    });

                // Update print job with new printer
                await this.fastify.knex('print_jobs')
                    .where({ id: jobId })
                    .update({
                        printer_id: failoverId,
                        attempts: 0, // Reset attempts for new printer
                        error_message: `Failover from printer ${printerId}: ${errorMessage}`
                    });

                // Emit failover event
                this.fastify.io?.emit('job:moved', {
                    jobId: job.job_id,
                    fromPrinter: printerId,
                    toPrinter: failoverId,
                    reason: errorMessage
                });

                // Re-queue job
                await addPrintJob({
                    jobId: job.id,
                    printerId: failoverId,
                    filePath: job.file_path,
                    copies: job.copies,
                    options: {}
                });

                return true;
            }
        }

        // No failover available - record as final failure
        logger.error(`[PrintRouter] Job ${jobId} failed permanently after ${job.attempts} attempts`);

        await this.fastify.knex('retries')
            .insert({
                print_job_id: jobId,
                printer_id: printerId,
                reason: errorMessage,
                status: 'failed',
                attempt_number: job.attempts
            });

        // Emit failure event
        this.fastify.io?.emit('job:error', {
            jobId: job.job_id,
            printerId: printerId,
            error: errorMessage,
            permanent: true
        });

        return false;
    }

    /**
     * Cancel print job
     */
    async cancelJob(jobId: string): Promise<{ success: boolean; error?: string }> {
        const job = await this.fastify.knex('print_jobs')
            .where({ job_id: jobId })
            .first();

        if (!job) {
            return { success: false, error: 'Job not found' };
        }

        if (['completed', 'cancelled'].includes(job.status)) {
            return { success: false, error: `Job already ${job.status}` };
        }

        // Update job status
        await this.fastify.knex('print_jobs')
            .where({ id: job.id })
            .update({ status: 'cancelled' });

        // Update queue
        await this.fastify.knex('queues')
            .where({ print_job_id: job.id })
            .update({ status: 'cancelled' });

        // Emit cancel event
        this.fastify.io?.emit('job:cancelled', { jobId: job.job_id });

        // If job is being processed, try to cancel via driver
        if (job.status === 'processing') {
            const driver = this.drivers.get(job.printer_id);
            if (driver && 'cancelPrintJob' in driver) {
                // Get the actual print job ID from queue
                const queueJob = await this.fastify.knex('queues')
                    .where({ print_job_id: job.id })
                    .first();

                if (queueJob) {
                    // Try to cancel the print job on the printer
                    await (driver as any).cancelPrintJob(queueJob.id);
                }
            }
        }

        logger.info(`[PrintRouter] Job ${jobId} cancelled`);

        return { success: true };
    }

    /**
     * Retry failed job
     */
    async retryJob(jobId: string): Promise<{ success: boolean; error?: string }> {
        const job = await this.fastify.knex('print_jobs')
            .where({ job_id: jobId })
            .first();

        if (!job) {
            return { success: false, error: 'Job not found' };
        }

        if (job.status !== 'failed') {
            return { success: false, error: 'Can only retry failed jobs' };
        }

        // Reset job
        await this.fastify.knex('print_jobs')
            .where({ id: job.id })
            .update({
                status: 'queued',
                attempts: 0,
                error_message: null
            });

        // Re-queue
        await addPrintJob({
            jobId: job.id,
            printerId: job.printer_id,
            filePath: job.file_path,
            copies: job.copies,
            options: {}
        });

        // Emit retry event
        this.fastify.io?.emit('job:retry', { jobId: job.job_id });

        logger.info(`[PrintRouter] Job ${jobId} queued for retry`);

        return { success: true };
    }

    /**
     * Estimate pages dari file
     */
    private async estimatePages(filePath: string, fileType: string): Promise<number> {
        // Simple estimation based on extension
        const ext = path.extname(filePath || '').toLowerCase();

        const estimates: Record<string, number> = {
            '.pdf': 1,
            '.txt': 1,
            '.doc': 1,
            '.docx': 1,
            '.xls': 1,
            '.xlsx': 1,
            '.png': 1,
            '.jpg': 1,
            '.jpeg': 1,
            '.tif': 1,
            '.tiff': 1,
            '.prn': 1,
            '.raw': 1
        };

        return estimates[ext] || 1;
    }

    /**
     * Get queue position
     */
    private async getQueuePosition(printerId: number): Promise<number> {
        const result = await this.fastify.knex('queues')
            .where({ printer_id: printerId, status: 'waiting' })
            .count('* as count')
            .first();

        return (result?.count || 0) + 1;
    }

    /**
     * Start periodic health check
     */
    private startHealthCheck(): void {
        const interval = parseInt(process.env.CHECK_INTERVAL || '30000');

        this.healthCheckInterval = setInterval(async () => {
            await this.checkAllPrinterHealth();
        }, interval);

        logger.info(`[PrintRouter] Health check started (interval: ${interval}ms)`);
    }

    /**
     * Check health semua printer dan update status
     */
    private async checkAllPrinterHealth(): Promise<void> {
        for (const [printerId, driver] of this.drivers) {
            try {
                const isHealthy = await driver.healthCheck();
                const status = await driver.getStatus();

                // Record health metric
                await this.fastify.knex('printer_health')
                    .insert({
                        printer_id: printerId,
                        metric_name: 'status',
                        metric_value: isHealthy ? 'healthy' : 'unhealthy',
                        recorded_at: new Date()
                    });

                // Update printer status in DB
                await this.fastify.knex('printers')
                    .where({ id: printerId })
                    .update({ status: status.status });

                // If printer went offline, emit event
                if (!isHealthy) {
                    const printer = await this.fastify.knex('printers')
                        .where({ id: printerId })
                        .first();

                    await this.fastify.knex('alerts')
                        .insert({
                            printer_id: printerId,
                            type: 'printer_offline',
                            severity: 'error',
                            title: 'Printer Offline',
                            message: `Printer ${printer?.name} is not responding`
                        });

                    this.fastify.io?.emit('printer:offline', {
                        printerId,
                        name: printer?.name,
                        message: status.errorMessage
                    });

                    logger.warn(`[PrintRouter] Printer ${printer?.name} is offline: ${status.errorMessage}`);
                }
            } catch (error) {
                logger.error(`[PrintRouter] Health check error for printer ${printerId}:`, error);
            }
        }
    }

    /**
     * Get driver untuk printer tertentu
     */
    getDriver(printerId: number): PrinterDriver | undefined {
        return this.drivers.get(printerId);
    }

    /**
     * Get all drivers
     */
    getAllDrivers(): Map<number, PrinterDriver> {
        return this.drivers;
    }

    /**
     * Shutdown router
     */
    async shutdown(): Promise<void> {
        if (this.healthCheckInterval) {
            clearInterval(this.healthCheckInterval);
            this.healthCheckInterval = null;
        }

        for (const [, driver] of this.drivers) {
            if ('dispose' in driver) {
                (driver as any).dispose();
            }
        }

        this.drivers.clear();
        logger.info('[PrintRouter] Shutdown complete');
    }
}

export default PrintRouter;