import { FastifyInstance } from 'fastify';
import { logger } from '../utils/logger.js';
import { createDriver, PrinterDriver, PrinterStatus } from './drivers/index.js';
import { addPrintJob, printQueue } from '../queues/index.js';
import { notifyJobRetrying, notifyJobFailedFinal } from '../services/telegram-notifier.js';
import path from 'path';
import fs from 'fs';

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
    private jobWaiters: Map<string, (result: any) => void> = new Map();

    constructor(fastify: FastifyInstance) {
        this.fastify = fastify;
        this.drivers = new Map();
        this.failoverMap = new Map();
    }

    async initialize(): Promise<void> {
        logger.info('[PrintRouter] Initializing...');

        try {
            await this.loadPrinters();
            logger.info('[PrintRouter] loadPrinters done');
        } catch(e) {
            logger.error('[PrintRouter] loadPrinters error:', e);
            throw e;
        }

        try {
            await this.setupFailoverMap();
            logger.info('[PrintRouter] setupFailoverMap done');
        } catch(e) {
            logger.error('[PrintRouter] setupFailoverMap error:', e);
            throw e;
        }

        this.startHealthCheck();
        this.startStuckJobReaper();

        logger.info('[PrintRouter] Initialization complete');
    }

    /**
     * Periodically clean up jobs stuck in 'processing' state for >5 minutes.
     * These can happen if the server crashes mid-dispatch or agent disconnects
     * without sending a result.
     */
    private startStuckJobReaper(): void {
        setInterval(async () => {
            try {
                const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);
                const stuckJobs = await this.fastify.knex('print_jobs')
                    .where({ status: 'processing' })
                    .where('started_at', '<', fiveMinAgo);

                for (const job of stuckJobs) {
                    logger.warn(`[PrintRouter] Reaper: force-failing stuck job ${job.id} (processing since ${job.started_at})`);
                    await this.fastify.knex('print_jobs')
                        .where({ id: job.id })
                        .update({
                            status: 'failed',
                            error_message: 'Job timed out — agent did not report back within 5 minutes',
                            attempts: (job.attempts || 0) + 1
                        });
                    this.fastify.io?.emit('job:error', {
                        jobId: job.job_id,
                        error: 'Job timed out'
                    });
                    await this.handleFailure(job.id, job.printer_id, 'Timeout — agent did not report back');
                }
            } catch (err) {
                logger.error('[PrintRouter] Stuck job reaper error:', err);
            }
        }, 60_000); // Run every 60 seconds
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

        if (job.status === 'held') {
            logger.info(`[PrintRouter] Job ${jobId} is held, skipping execution.`);
            return { success: true, error: 'Job is held' };
        }

        // ── Find printer + its owning node ──────────────────────────────────
        const printer = await this.fastify.knex('printers')
            .leftJoin('clients', 'printers.client_id', 'clients.id')
            .select('printers.*', 'clients.id as client_id', 'clients.hostname as client_hostname', 'clients.is_online as client_online')
            .where('printers.id', printerId)
            .first();

        if (!printer) {
            logger.error(`[PrintRouter] Printer ${printerId} not found`);
            return { success: false, error: 'Printer not found' };
        }

        if (!printer.client_id) {
            logger.error(`[PrintRouter] Printer ${printerId} is not bound to any node`);
            await this.fastify.knex('print_jobs')
                .where({ id: jobId })
                .update({ status: 'failed', error_message: 'Printer is not bound to any node', attempts: job.attempts + 1 });
            return { success: false, error: 'Printer is not bound to any node' };
        }

        // ── Check if agent is connected via Socket.IO ───────────────────────
        const io = this.fastify.io;
        if (!io) {
            logger.error(`[PrintRouter] Socket.IO not available`);
            return { success: false, error: 'Socket.IO not available' };
        }

        const room = io.sockets.adapter.rooms.get(`client:${printer.client_id}`);
        if (!room || room.size === 0) {
            const errMsg = `Node "${printer.client_hostname || printer.client_id}" is offline — cannot dispatch print job`;
            logger.warn(`[PrintRouter] ${errMsg}`);
            await this.fastify.knex('print_jobs')
                .where({ id: jobId })
                .update({ status: 'failed', error_message: errMsg, attempts: job.attempts + 1 });
            this.fastify.io?.emit('job:error', { jobId: job.job_id, error: errMsg });
            return { success: false, error: errMsg };
        }

        // ── Update status to processing ─────────────────────────────────────
        await this.fastify.knex('print_jobs')
            .where({ id: jobId })
            .update({ status: 'processing', started_at: new Date() });

        // ── Dispatch to agent via Socket.IO ─────────────────────────────────
        try {
            const result = await this.forwardToAgent(printer.client_id, {
                jobId: job.id,
                action: 'print',
                printerName: printer.name,
                fileName: job.file_name,
                copies: copies || job.copies || 1,
                fileType: job.file_type,
                fileData: await this.readFileAsBase64(filePath),
                paper: options?.paper || null,
                options: options || {},
            });

            if (result.success) {
                // Success — update job status
                await this.fastify.knex('print_jobs')
                    .where({ id: jobId })
                    .update({ status: 'completed', completed_at: new Date() });

                // Update queue status
                await this.fastify.knex('queues')
                    .where({ print_job_id: jobId })
                    .update({ status: 'completed', completed_at: new Date() });

                // Update user quota
                if (job.user_id) {
                    await this.fastify.knex('users')
                        .where({ id: job.user_id })
                        .increment('quota_used', (job.pages || 1) * (copies || job.copies || 1));
                }

                this.fastify.io?.emit('job:complete', {
                    jobId: job.job_id,
                    printerId: printerId,
                    status: 'completed'
                });

                logger.info(`[PrintRouter] Job ${jobId} completed successfully via node ${printer.client_hostname || printer.client_id}`);
                return { success: true };
            } else {
                throw new Error(result.error || 'Print failed on agent');
            }

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
            await this.handleFailure(jobId, printerId, error.message);

            return { success: false, error: error.message };
        }
    }

    /**
     * Read a file and return base64-encoded content for Socket.IO dispatch.
     */
    private async readFileAsBase64(filePath: string): Promise<string> {
        if (!fs.existsSync(filePath)) {
            throw new Error(`File not found: ${filePath}`);
        }
        const buffer = fs.readFileSync(filePath);
        return buffer.toString('base64');
    }

    /**
     * Dispatch a print job to a Windows agent via Socket.IO and wait for result.
     * Same mechanism as IPP server's forwardToAgent — 90s timeout.
     */
    private forwardToAgent(clientId: number, payload: any): Promise<{ success: boolean; error?: string; method?: string }> {
        const io = this.fastify.io;
        if (!io) throw new Error('Socket.IO not available');

        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                this.jobWaiters.delete(String(payload.jobId));
                reject(new Error('Print job timed out after 90s (agent did not report back)'));
            }, 90000);

            this.jobWaiters.set(String(payload.jobId), (result: any) => {
                clearTimeout(timeout);
                resolve(result);
            });

            // Push job to the agent's room
            io.to(`client:${clientId}`).emit('print:execute', payload);
            logger.info(`[PrintRouter] Job ${payload.jobId} dispatched to client:${clientId} room`);
        });
    }

    /**
     * Resolve a waiting forwardToAgent() promise when the agent sends print:result.
     * Called from Socket.IO handler in index.ts.
     */
    handleAgentResult(data: { jobId: number | string; success: boolean; method?: string; error?: string }) {
        const waiter = this.jobWaiters.get(String(data.jobId));
        if (waiter) {
            waiter(data);
            this.jobWaiters.delete(String(data.jobId));
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

        const newAttempt = (job.attempts || 0) + 1;
        logger.info(`[PrintRouter] Handling failure for job ${jobId}, attempt ${newAttempt}/${maxAttempts}`);

        // TIER-1 #2: Record EVERY retry attempt (not just final failure) so we
        // have a complete audit trail. Each row shows the printer, attempt #,
        // error, and what the next action will be.
        const isFinal = newAttempt >= maxAttempts;

        // Lookup printer name + node context for human-friendly Telegram messages
        const printer = await this.fastify.knex('printers').where({ id: printerId }).first();
        const printerName = printer?.name || `Printer#${printerId}`;
        const client = printer?.client_id
            ? await this.fastify.knex('clients').where({ id: printer.client_id }).first()
            : null;

        await this.fastify.knex('retries')
            .insert({
                job_id: jobId,
                print_job_id: jobId,
                printer_id: printerId,
                retry_count: newAttempt,
                max_retries: maxAttempts,
                status: isFinal ? 'failed' : 'pending',
                error_message: errorMessage,
                reason: errorMessage,
                attempt_number: newAttempt,
                next_retry_at: isFinal
                    ? null
                    : new Date(Date.now() + Math.min(1000 * Math.pow(2, newAttempt), 30000))
            })
            .catch((err: any) => {
                // Never let retry-logging failure break the retry path
                logger.warn(`[PrintRouter] Failed to log retry attempt: ${err.message}`);
            });

        // Check if can retry on same printer
        if (newAttempt < maxAttempts) {
            // Exponential backoff delay (capped at 30s)
            const delay = Math.min(1000 * Math.pow(2, newAttempt), 30000);
            logger.info(`[PrintRouter] Will retry job ${jobId} after ${delay}ms (attempt ${newAttempt}/${maxAttempts})`);

            // Update print_jobs so the UI sees the attempt count climbing.
            await this.fastify.knex('print_jobs')
                .where({ id: jobId })
                .update({
                    status: 'queued',
                    error_message: `Retry ${newAttempt}/${maxAttempts} scheduled in ${Math.round(delay/1000)}s: ${errorMessage}`,
                    attempts: newAttempt,
                    updated_at: new Date()
                })
                .catch(() => {});

            this.fastify.io?.emit('job:retry-scheduled', {
                jobId: job.job_id,
                attempt: newAttempt,
                maxAttempts,
                nextRetryIn: delay
            });

            // TIER-1 #2: Telegram — silent "retrying" notification
            notifyJobRetrying({
                jobId: job.job_id,
                jobName: job.job_name || job.file_name,
                printerName,
                attempt: newAttempt,
                maxAttempts,
                nextRetryIn: delay,
                error: errorMessage
            }).catch(() => {});

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

                // ... (failover code continues unchanged below)
                await this.fastify.knex('print_jobs')
                    .where({ id: jobId })
                    .update({
                        printer_id: failoverId,
                        attempts: 0, // Reset attempts for new printer
                        error_message: `Failover from printer ${printerId}: ${errorMessage}`
                    });
                return true;
            }
        }

        // No failover available - record as final failure
        logger.error(`[PrintRouter] Job ${jobId} failed permanently after ${newAttempt} attempts`);

        // Mark the most recent retry record as 'exhausted' (no further action)
        await this.fastify.knex('retries')
            .where({ print_job_id: jobId, status: 'pending' })
            .orderBy('id', 'desc')
            .limit(1)
            .update({ status: 'exhausted', completed_at: new Date() })
            .catch(() => {});

        // TIER-1 #2: Telegram — final-failure notification (the only one that
        // pings, since intermediate retries are silent).
        notifyJobFailedFinal({
            jobId: job.job_id,
            jobName: job.job_name || job.file_name,
            printerName,
            attempts: newAttempt,
            error: errorMessage,
            nodeHostname: client?.hostname,
            nodeIp: client?.ip_address
        }).catch(() => {});

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
     * Hold print job
     */
    async holdJob(jobId: string): Promise<{ success: boolean; error?: string }> {
        const job = await this.fastify.knex('print_jobs')
            .where({ job_id: jobId })
            .first();

        if (!job) {
            return { success: false, error: 'Job not found' };
        }

        if (['completed', 'cancelled', 'failed'].includes(job.status)) {
            return { success: false, error: `Cannot hold job that is already ${job.status}` };
        }

        // Update job status to held
        await this.fastify.knex('print_jobs')
            .where({ id: job.id })
            .update({ status: 'held' });

        // Update queue
        await this.fastify.knex('queues')
            .where({ print_job_id: job.id })
            .update({ status: 'held' });

        this.fastify.io?.emit('job:held', { jobId: job.job_id });
        logger.info(`[PrintRouter] Job ${jobId} held`);
        return { success: true };
    }

    /**
     * Release held print job
     */
    async releaseJob(jobId: string): Promise<{ success: boolean; error?: string }> {
        const job = await this.fastify.knex('print_jobs')
            .where({ job_id: jobId })
            .first();

        if (!job) {
            return { success: false, error: 'Job not found' };
        }

        if (job.status !== 'held') {
            return { success: false, error: 'Job is not held' };
        }

        // Update job status back to queued
        await this.fastify.knex('print_jobs')
            .where({ id: job.id })
            .update({ status: 'queued' });

        // Update queue
        await this.fastify.knex('queues')
            .where({ print_job_id: job.id })
            .update({ status: 'queued' });

        // Re-queue to BullMQ
        const { addPrintJob } = await import('../queues/index.js');
        await addPrintJob({
            jobId: job.id,
            printerId: job.printer_id,
            filePath: job.file_path,
            copies: job.copies,
            options: {}
        });

        this.fastify.io?.emit('job:released', { jobId: job.job_id });
        logger.info(`[PrintRouter] Job ${jobId} released`);
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
        let interval = parseInt(process.env.CHECK_INTERVAL || '30000');
        if (interval < 1000) {
            interval = interval * 1000; // convert seconds to ms if configured in seconds
        }

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
                // Node-managed printers (client_id set) are physically attached to
                // a remote Windows node (e.g. USB001 on IT-99). The central server
                // can't reach them directly, so driver.healthCheck() always returns
                // false here and would wrongly flip them offline — fighting the
                // node's heartbeat and causing the "node RUNNING but printer red"
                // flapping bug. Their status is owned by the heartbeat handler in
                // clients.ts; skip them in this local loop.
                const ownerRow = await this.fastify.knex('printers')
                    .where({ id: printerId })
                    .select('client_id')
                    .first();
                if (ownerRow?.client_id) {
                    continue;
                }

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

                    // Check if unresolved alert already exists to prevent duplication
                    const existingAlert = await this.fastify.knex('alerts')
                        .where({
                            printer_id: printerId,
                            type: 'printer_offline',
                            is_resolved: false
                        })
                        .first();

                    if (!existingAlert) {
                        await this.fastify.knex('alerts')
                            .insert({
                                printer_id: printerId,
                                type: 'printer_offline',
                                severity: 'error',
                                title: 'Printer Offline',
                                message: `Printer ${printer?.name} is not responding`
                            });
                    }

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