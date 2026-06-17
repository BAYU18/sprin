/**
 * PrintServer Pro - Central Print Router
 * Cross-Node Routing Logic
 *
 * Handles print job routing between Windows Nodes
 */

import { FastifyInstance } from 'fastify';
import { logger } from '../utils/logger.js';
import axios, { AxiosInstance } from 'axios';
import FormData from 'form-data';
import fs from 'fs';
import path from 'path';
import { Readable } from 'stream';
import { scaleForZpl, cleanupScaledFile } from '../utils/file-scaler.js';

export interface IPrintNode {
    id: number;
    node_name: string;
    api_url: string;
    status: 'online' | 'offline' | 'warning';
    last_heartbeat?: Date;
}

export interface IPrinter {
    id: number;
    name: string;
    node_id: number;
    status: string;
    type: string;
}

export interface PrintJobData {
    userId: number;
    clientId: number;
    printerId: number;
    filePath: string;
    fileName: string;
    fileType: string;
    pages?: number;
    copies?: number;
    options?: any;
}

export class CentralPrintRouter {
    private fastify: FastifyInstance;
    private nodeClients: Map<number, AxiosInstance>;
    private nodeCache: Map<number, IPrintNode>;
    private printerToNodeCache: Map<number, number>;

    constructor(fastify: FastifyInstance) {
        this.fastify = fastify;
        this.nodeClients = new Map();
        this.nodeCache = new Map();
        this.printerToNodeCache = new Map();
    }

    /**
     * Initialize router - load all nodes and build caches
     */
    async initialize(): Promise<void> {
        await this.refreshNodeCache();
        await this.refreshPrinterNodeMapping();

        // Refresh every 5 minutes
        setInterval(() => {
            this.refreshNodeCache();
            this.refreshPrinterNodeMapping();
        }, 5 * 60 * 1000);

        logger.info('[CentralRouter] Initialized');
    }

    /**
     * Refresh node cache from database
     */
    async refreshNodeCache(): Promise<void> {
        try {
            // Kita ambil data dari tabel clients yang memiliki is_online = true
            const nodes = await this.fastify.knex('clients')
                .where('is_online', true);

            this.nodeCache.clear();
            this.nodeClients.clear();

            for (const node of nodes) {
                // Gunakan id client sebagai id node
                const nodeId = node.id;
                const nodeName = node.hostname || `client-${nodeId}`;

                // Central hub berkomunikasi dengan client-agent menggunakan api_url.
                // Jika client-agent tidak mengirim api_url secara eksplisit, kita buat url defaultnya
                // (karena agent biasanya berjalan di port 3000 atau port lain pada IP client)
                const port = 3000; // default agent port
                const apiUrl = node.metadata?.api_url || `http://${node.ip_address || '127.0.0.1'}:${port}`;

                this.nodeCache.set(nodeId, {
                    id: nodeId,
                    node_name: nodeName,
                    api_url: apiUrl,
                    status: 'online',
                    last_heartbeat: node.last_seen
                });

                // Create axios client for this node
                const client = axios.create({
                    baseURL: apiUrl,
                    timeout: 60000, // 1 minute timeout for print jobs
                    headers: {
                        'X-Node-Secret': node.secret_key
                    }
                });

                this.nodeClients.set(nodeId, client);
            }

            logger.info(`[CentralRouter] Cached ${nodes.length} online nodes from clients table`);
        } catch (error) {
            logger.error('[CentralRouter] Failed to refresh node cache:', error);
        }
    }

    /**
     * Refresh printer -> node mapping
     */
    async refreshPrinterNodeMapping(): Promise<void> {
        try {
            // Di schema printer, node diwakili oleh client_id.
            // Kita map printers ke client_id-nya (sebagai pengganti node_id).
            const printers = await this.fastify.knex('printers')
                .whereNotNull('client_id')
                .where('status', '!=', 'inactive')
                .select('id', 'client_id');

            this.printerToNodeCache.clear();

            for (const printer of printers) {
                this.printerToNodeCache.set(printer.id, printer.client_id);
            }

            logger.info(`[CentralRouter] Mapped ${printers.length} printers to client nodes`);
        } catch (error) {
            logger.error('[CentralRouter] Failed to refresh printer mapping:', error);
        }
    }

    /**
     * Get node client by printer ID
     */
    private getNodeClientForPrinter(printerId: number): { node: IPrintNode; client: AxiosInstance } | null {
        const nodeId = this.printerToNodeCache.get(printerId);

        if (!nodeId) {
            logger.error(`[CentralRouter] No node found for printer ${printerId}`);
            return null;
        }

        const node = this.nodeCache.get(nodeId);

        if (!node) {
            logger.error(`[CentralRouter] Node ${nodeId} not in cache (printer: ${printerId})`);
            return null;
        }

        const client = this.nodeClients.get(nodeId);

        if (!client) {
            logger.error(`[CentralRouter] No HTTP client for node ${nodeId}`);
            return null;
        }

        return { node, client };
    }

    /**
     * Find backup node with same printer name when primary node is offline
     */
    private async findBackupNode(printerId: number, originalNodeId: number): Promise<{ node: IPrintNode; client: AxiosInstance } | null> {
        const printer = await this.fastify.knex('printers').where({ id: printerId }).first();
        if (!printer) {
            logger.warn(`[CentralRouter] Printer ${printerId} not found for failover`);
            return null;
        }

        const backupNode = await this.fastify.knex('clients')
            .where('is_online', true)
            .where('id', '!=', originalNodeId)
            .first();

        if (!backupNode) {
            logger.warn(`[CentralRouter] No online backup node found for printer ${printer.name}`);
            return null;
        }

        const backupPrinter = await this.fastify.knex('printers')
            .where('name', printer.name)
            .where('client_id', backupNode.id)
            .where('status', '!=', 'inactive')
            .first();

        if (!backupPrinter) {
            logger.warn(`[CentralRouter] No backup printer with name ${printer.name} found on node ${backupNode.hostname || backupNode.id}`);
            return null;
        }

        const port = 3000;
        const apiUrl = backupNode.metadata?.api_url || `http://${backupNode.ip_address || '127.0.0.1'}:${port}`;

        const client = axios.create({
            baseURL: apiUrl,
            timeout: 60000,
            headers: {
                'X-Node-Secret': backupNode.secret_key
            }
        });

        return {
            node: {
                id: backupNode.id,
                node_name: backupNode.hostname || `client-${backupNode.id}`,
                api_url: apiUrl,
                status: 'online',
                last_heartbeat: backupNode.last_seen
            },
            client
        };
    }

    /**
     * Submit print job - routes to correct node with failover support
     */
    async submitJob(data: PrintJobData): Promise<{ jobId: string; routedTo: string }> {
        const { printerId, filePath, fileName, fileType, pages, copies, options } = data;

        const target = this.getNodeClientForPrinter(printerId);

        if (!target) {
            throw new Error(`Printer ${printerId} not assigned to any online node`);
        }

        const { node, client } = target;

        logger.info(`[CentralRouter] Routing job ${fileName} to node ${node.node_name} (${node.api_url})`);

        // ── ZPL printer scaling compensation ──────────────────────────────
        // If the printer's config has a scale_factor AND the printer type is
        // 'zpl', pre-scale the file to compensate for the Windows driver's
        // EMF→ZPL zoom behavior.  PDFs are scaled on the server via ghostscript;
        // images are marked for client-side scaling via PowerShell.
        let scaledFilePath = filePath;
        let clientScaleFactor: number | null = null;
        let scaledFileCleanup = false;

        try {
            const printerRecord = await this.fastify.knex('printers').where({ id: printerId }).first();
            const printerConfig = printerRecord?.config
                ? (typeof printerRecord.config === 'string' ? JSON.parse(printerRecord.config) : printerRecord.config)
                : {};
            const scaleFactor: number | undefined = printerConfig?.scale_factor;

            if (scaleFactor && scaleFactor > 0 && scaleFactor < 1) {
                logger.info(`[CentralRouter] ZPL scale compensation active: ${(scaleFactor * 100).toFixed(0)}% for ${printerRecord?.name}`);
                const result = await scaleForZpl(filePath, scaleFactor, fileType);
                scaledFilePath = result.scaledFilePath;

                if (result.clientScale) {
                    // Server couldn't scale (image or GS failure) — tell client
                    clientScaleFactor = scaleFactor;
                } else {
                    scaledFileCleanup = true; // temp file needs cleanup
                }
            }
        } catch (scaleErr: any) {
            logger.warn(`[CentralRouter] ZPL scale failed, printing original: ${scaleErr.message}`);
            // Fall through — print original file
        }

        // Merge scale_factor into options for the client (client-side fallback)
        const mergedOptions = { ...options };
        if (clientScaleFactor !== null) {
            mergedOptions.scale_factor = clientScaleFactor;
        }
        // ── End ZPL scaling ────────────────────────────────────────────────

        const [printJob] = await this.fastify.knex('print_jobs')
            .insert({
                user_id: data.userId,
                client_id: data.clientId,
                printer_id: printerId,
                node_id: node.id,
                job_name: fileName,
                source_app: options?.sourceApp,
                file_name: fileName,
                file_path: filePath,
                file_type: fileType,
                pages: pages || 1,
                copies: copies || 1,
                status: 'queued',
                priority: options?.priority || 'normal'
            })
            .returning('*');

        try {
            const formData = new FormData();
            formData.append('jobId', printJob.job_id);
            formData.append('printerId', printerId.toString());
            formData.append('file', fs.createReadStream(scaledFilePath), fileName);
            formData.append('copies', (copies || 1).toString());
            formData.append('options', JSON.stringify(mergedOptions));

            const response = await client.post('/internal/print', formData, {
                headers: formData.getHeaders(),
                timeout: 120000
            });

            if (response.data.success) {
                await this.fastify.knex('print_jobs')
                    .where({ id: printJob.id })
                    .update({ status: 'processing' });

                this.fastify.io?.emit('job:routed', {
                    jobId: printJob.job_id,
                    printerId,
                    nodeId: node.id,
                    nodeName: node.node_name
                });

                logger.info(`[CentralRouter] Job ${printJob.job_id} sent to node ${node.node_name}`);
            }

            // Cleanup temp scaled file
            if (scaledFileCleanup) cleanupScaledFile(scaledFilePath);

            return {
                jobId: printJob.job_id,
                routedTo: node.node_name
            };

        } catch (error: any) {
            logger.error(`[CentralRouter] Failed to send job to node ${node.node_name}:`, error.message);
            // Cleanup temp scaled file on error too
            if (scaledFileCleanup) cleanupScaledFile(scaledFilePath);
            logger.info(`[CentralRouter] Attempting failover for job ${printJob.job_id}...`);

            const backup = await this.findBackupNode(printerId, node.id);

            if (backup) {
                logger.info(`[CentralRouter] Failing over to backup node ${backup.node.node_name}`);

                const backupFormData = new FormData();
                backupFormData.append('jobId', printJob.job_id);
                backupFormData.append('printerId', printerId.toString());
                backupFormData.append('file', fs.createReadStream(filePath), fileName);
                backupFormData.append('copies', (copies || 1).toString());
                backupFormData.append('options', JSON.stringify({ ...options, failover: true }));

                try {
                    const backupResponse = await backup.client.post('/internal/print', backupFormData, {
                        headers: backupFormData.getHeaders(),
                        timeout: 120000
                    });

                    if (backupResponse.data.success) {
                        await this.fastify.knex('print_jobs')
                            .where({ id: printJob.id })
                            .update({
                                status: 'processing',
                                node_id: backup.node.id,
                                error_message: `Failover from node ${node.id}`
                            });

                        this.fastify.io?.emit('job:failover', {
                            jobId: printJob.job_id,
                            fromNode: node.id,
                            toNode: backup.node.id,
                            toPrinter: printerId
                        });

                        logger.info(`[CentralRouter] Job ${printJob.job_id} successfully failed over to ${backup.node.node_name}`);

                        return {
                            jobId: printJob.job_id,
                            routedTo: backup.node.node_name
                        };
                    }
                } catch (backupError: any) {
                    logger.error(`[CentralRouter] Backup node also failed:`, backupError.message);
                }
            }

            await this.fastify.knex('print_jobs')
                .where({ id: printJob.id })
                .update({
                    status: 'failed',
                    error_message: `Failed to route to node: ${error.message}`
                });

            // Create alert record
            await this.fastify.knex('alerts')
                .insert({
                    printer_id: printerId,
                    type: 'job_failed',
                    severity: 'error',
                    title: 'Print Routing Failed',
                    message: `Failed to route print job "${fileName}" to printer ID ${printerId}. Error: ${error.message}`
                });

            throw new Error(`Failed to send job to node ${node.node_name}: ${error.message}`);
        }
    }

    /**
     * Cancel print job - propagate to node if needed
     */
    async cancelJob(jobId: string): Promise<{ success: boolean; error?: string }> {
        try {
            const job = await this.fastify.knex('print_jobs')
                .where({ job_id: jobId })
                .first();

            if (!job) {
                return { success: false, error: 'Job not found' };
            }

            if (job.status === 'completed' || job.status === 'cancelled') {
                return { success: false, error: `Job already ${job.status}` };
            }

            // If job is processing on a node, tell the node to cancel
            if (job.node_id && job.status === 'processing') {
                const node = this.nodeCache.get(job.node_id);
                const client = this.nodeClients.get(job.node_id);

                if (node && client) {
                    try {
                        await client.post('/internal/cancel', {
                            jobId: job.job_id,
                            printJobId: job.id
                        });
                    } catch (e: any) {
                        logger.warn(`[CentralRouter] Could not cancel on node: ${e.message}`);
                    }
                }
            }

            // Update local status
            await this.fastify.knex('print_jobs')
                .where({ id: job.id })
                .update({ status: 'cancelled' });

            this.fastify.io?.emit('job:cancelled', { jobId: job.job_id });

            return { success: true };

        } catch (error: any) {
            logger.error('[CentralRouter] Cancel job failed:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Get job status - includes node info if applicable
     */
    async getJobStatus(jobId: string): Promise<any> {
        const job = await this.fastify.knex('print_jobs')
            .where({ job_id: jobId })
            .first();

        if (!job) {
            return null;
        }

        let nodeName = null;
        if (job.node_id) {
            const node = await this.fastify.knex('clients').where({ id: job.node_id }).first();
            nodeName = node?.hostname || `client-${job.node_id}`;
        }

        return {
            ...job,
            node_name: nodeName
        };
    }

    /**
     * Check node health - called periodically
     */
    async checkNodeHealth(): Promise<void> {
        for (const [nodeId, client] of this.nodeClients) {
            try {
                const response = await client.get('/health', { timeout: 5000 });

                if (response.data.status !== 'ok') {
                    await this.markNodeOffline(nodeId);
                }
            } catch (error: any) {
                // Node is unreachable
                if (error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT') {
                    await this.markNodeOffline(nodeId);
                }
            }
        }
    }

    /**
     * Mark node as offline in database
     */
    private async markNodeOffline(nodeId: number): Promise<void> {
        const node = await this.fastify.knex('clients').where({ id: nodeId }).first();

        if (node && node.is_online) {
            await this.fastify.knex('clients')
                .where({ id: nodeId })
                .update({ is_online: false, updated_at: new Date() });

            // Node mati = printernya tak mungkin online. Turunkan statusnya juga.
            const printersOff = await this.fastify.knex('printers')
                .where({ client_id: nodeId })
                .whereIn('status', ['online', 'busy'])
                .update({ status: 'offline', updated_at: new Date() });
            if (printersOff > 0) {
                this.fastify.io?.emit('printer:patch', { client_id: nodeId, status: 'offline' });
            }

            const nodeName = node.hostname || `client-${nodeId}`;

            // Emit alert
            this.fastify.io?.emit('node:offline', {
                nodeId,
                nodeName: nodeName
            });

            // Create alert record
            await this.fastify.knex('alerts')
                .insert({
                    type: 'node_offline',
                    severity: 'error',
                    title: 'Print Node Offline',
                    message: `Print server ${nodeName} is not responding`
                });

            // Fail over jobs to another node if possible
            await this.failoverJobsFromNode(nodeId);

            logger.warn(`[CentralRouter] Node ${nodeName} marked as offline`);

            // Remove from cache
            this.nodeCache.delete(nodeId);
            this.nodeClients.delete(nodeId);
        }
    }

    /**
     * Fail over queued jobs from offline node
     */
    private async failoverJobsFromNode(nodeId: number): Promise<void> {
        // Get jobs that were queued/processing on this node
        const stuckJobs = await this.fastify.knex('print_jobs')
            .where({ node_id: nodeId })
            .whereIn('status', ['queued', 'processing']);

        logger.info(`[CentralRouter] ${stuckJobs.length} jobs need failover from node ${nodeId}`);

        for (const job of stuckJobs) {
            // Try to find another node with the same printer
            const originalPrinter = await this.fastify.knex('printers')
                .where({ id: job.printer_id })
                .first();

            if (!originalPrinter) continue;

            // Find printers with same name on different nodes/clients
            const backupPrinter = await this.fastify.knex('printers')
                .where('name', originalPrinter.name)
                .where('client_id', '!=', nodeId)
                .where('status', '!=', 'inactive')
                .first();

            if (backupPrinter) {
                // Re-route job to backup printer/client node
                await this.fastify.knex('print_jobs')
                    .where({ id: job.id })
                    .update({
                        printer_id: backupPrinter.id,
                        node_id: backupPrinter.client_id,
                        error_message: `Failover from node ${nodeId}`
                    });

                this.fastify.io?.emit('job:failover', {
                    jobId: job.job_id,
                    fromNode: nodeId,
                    toNode: backupPrinter.client_id,
                    toPrinter: backupPrinter.id
                });

                logger.info(`[CentralRouter] Job ${job.job_id} failed over to printer ${backupPrinter.name}`);
            } else {
                // No backup - mark as failed
                await this.fastify.knex('print_jobs')
                    .where({ id: job.id })
                    .update({
                        status: 'failed',
                        error_message: `Node ${nodeId} offline, no backup printer available`
                    });
            }
        }
    }

    /**
     * Get all online nodes
     */
    getOnlineNodes(): IPrintNode[] {
        return Array.from(this.nodeCache.values());
    }

    /**
     * Get node client for internal use
     */
    getNodeClient(nodeId: number): AxiosInstance | undefined {
        return this.nodeClients.get(nodeId);
    }
}

// Export singleton
export default CentralPrintRouter;