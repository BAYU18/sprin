/**
 * PrintServer Pro - Windows Node API Routes
 * Internal routes for print commands from Central Hub
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { logger } from '../utils/logger.js';
import { WindowsPrinterDriver } from '../printer-engine/drivers/windows-driver.js';
import { createDriver } from '../printer-engine/drivers/index.js';
import fs from 'fs';
import path from 'path';
import axios from 'axios';
import FormData from 'form-data';
import { pipeline } from 'stream/promises';

const printJobSchema = z.object({
    jobId: z.string(),
    printerId: z.number(),
    copies: z.number().default(1),
    options: z.any().optional()
});

const cancelJobSchema = z.object({
    jobId: z.string(),
    printJobId: z.number()
});

export async function setupNodeInternalRoutes(fastify: FastifyInstance) {

    /**
     * POST /internal/print
     * Receive print job from Central Hub (multipart/form-data)
     */
    fastify.post('/internal/print', async (request: FastifyRequest, reply: FastifyReply) => {
        const tempFilePaths: string[] = [];

        try {
            const nodeSecret = request.headers['x-node-secret'];
            if (nodeSecret !== process.env.NODE_SECRET) {
                return reply.status(401).send({ error: 'Unauthorized' });
            }

            const data = await request.parseMultipart();

            const jobId = data.fields.jobId?.value as string;
            const printerId = parseInt(data.fields.printerId?.value as string);
            const copies = parseInt(data.fields.copies?.value as string || '1');
            const options = JSON.parse(data.fields.options?.value as string || '{}');

            if (!jobId || !printerId) {
                return reply.status(400).send({ error: 'Missing jobId or printerId' });
            }

            let filePath: string;

            const file = data.files[0];
            if (file) {
                const tempDir = process.env.SPOOL_DIR || 'C:\\PrintServer\\Spool';
                if (!fs.existsSync(tempDir)) {
                    fs.mkdirSync(tempDir, { recursive: true });
                }

                filePath = path.join(tempDir, `${Date.now()}_${file.filename}`);
                tempFilePaths.push(filePath);

                if (Buffer.isBuffer(file.file)) {
                    fs.writeFileSync(filePath, file.file);
                } else {
                    await pipeline(file.file, fs.createWriteStream(filePath));
                }

                logger.info(`[NodeAPI] Received file job ${jobId}, saved to ${filePath}`);
            } else if (data.fields.filePath) {
                filePath = data.fields.filePath.value as string;
                logger.info(`[NodeAPI] Received path job ${jobId}: ${filePath}`);
            } else {
                return reply.status(400).send({ error: 'No file or filePath provided' });
            }

            let driver = fastify.printRouter.getDriver(printerId);

            if (!driver) {
                const printer = await fastify.knex('printers').where({ id: printerId }).first();
                if (printer) {
                    driver = createDriver(fastify, printer);
                    await driver.initialize();
                    fastify.printRouter['drivers']?.set(printerId, driver);
                } else {
                    throw new Error(`Printer ${printerId} not found on this node`);
                }
            }

            await driver.print(filePath, copies, options);

            if (fs.existsSync(filePath)) {
                try {
                    fs.unlinkSync(filePath);
                } catch (e) {
                    logger.warn(`[NodeAPI] Could not delete temp file: ${filePath}`);
                }
            }

            if (process.env.CENTRAL_HUB_URL) {
                axios.post(`${process.env.CENTRAL_HUB_URL}/api/jobs/${jobId}/status`, {
                    status: 'completed',
                    completed_at: new Date().toISOString()
                }).catch(() => logger.warn('[NodeAPI] Could not update Central Hub'));
            }

            return {
                success: true,
                jobId,
                printerId,
                message: 'Print job completed'
            };

        } catch (error: any) {
            logger.error('[NodeAPI] Print failed:', error);

            if (process.env.CENTRAL_HUB_URL) {
                const jobId = (request.body as any)?.jobId || 'unknown';
                axios.post(`${process.env.CENTRAL_HUB_URL}/api/jobs/${jobId}/status`, {
                    status: 'failed',
                    error: error.message
                }).catch(() => logger.warn('[NodeAPI] Could not update Central Hub'));
            }

            return reply.status(500).send({
                success: false,
                error: error.message
            });
        } finally {
            for (const filePath of tempFilePaths) {
                if (fs.existsSync(filePath)) {
                    try {
                        fs.unlinkSync(filePath);
                    } catch {}
                }
            }
        }
    });

    /**
     * POST /internal/print-json
     * Alternative: Receive print job as JSON with file_path (Central Hub sends file path directly)
     */
    fastify.post('/internal/print-json', async (request: FastifyRequest, reply: FastifyReply) => {
        try {
            const nodeSecret = request.headers['x-node-secret'];
            if (nodeSecret !== process.env.NODE_SECRET) {
                return reply.status(401).send({ error: 'Unauthorized' });
            }

            const body = printJobSchema.parse(request.body);
            const { jobId, printerId, copies, options } = body;

            const filePath = options?.filePath as string;
            if (!filePath) {
                return reply.status(400).send({ error: 'No filePath in options' });
            }

            if (!fs.existsSync(filePath)) {
                return reply.status(400).send({ error: `File not found: ${filePath}` });
            }

            let driver = fastify.printRouter.getDriver(printerId);

            if (!driver) {
                const printer = await fastify.knex('printers').where({ id: printerId }).first();
                if (printer) {
                    driver = createDriver(fastify, printer);
                    await driver.initialize();
                    fastify.printRouter['drivers']?.set(printerId, driver);
                } else {
                    throw new Error(`Printer ${printerId} not found on this node`);
                }
            }

            await driver.print(filePath, copies, options);

            if (process.env.CENTRAL_HUB_URL) {
                axios.post(`${process.env.CENTRAL_HUB_URL}/api/jobs/${jobId}/status`, {
                    status: 'completed',
                    completed_at: new Date().toISOString()
                }).catch(() => logger.warn('[NodeAPI] Could not update Central Hub'));
            }

            return {
                success: true,
                jobId,
                printerId,
                message: 'Print job completed'
            };

        } catch (error: any) {
            logger.error('[NodeAPI] Print-json failed:', error);
            return reply.status(500).send({ success: false, error: error.message });
        }
    });

    /**
     * POST /internal/cancel
     * Cancel print job on this node
     */
    fastify.post('/internal/cancel', async (request: FastifyRequest, reply: FastifyReply) => {
        try {
            const nodeSecret = request.headers['x-node-secret'];
            if (nodeSecret !== process.env.NODE_SECRET) {
                return reply.status(401).send({ error: 'Unauthorized' });
            }

            const body = cancelJobSchema.parse(request.body);
            const { printJobId } = body;

            const driver = new WindowsPrinterDriver(fastify, { id: 0, name: 'cancel', type: 'windows' });
            const result = await driver.cancelPrintJob(printJobId);

            logger.info(`[NodeAPI] Cancel request for job ${printJobId}: ${result}`);

            return { success: result };
        } catch (error) {
            logger.error('[NodeAPI] Cancel failed:', error);
            return reply.status(500).send({ error: (error as Error).message });
        }
    });

    /**
     * POST /internal/scan-printers
     * Scan local printers and return list
     */
    fastify.post('/internal/scan-printers', async (request: FastifyRequest, reply: FastifyReply) => {
        try {
            const nodeSecret = request.headers['x-node-secret'];
            if (nodeSecret !== process.env.NODE_SECRET) {
                return reply.status(401).send({ error: 'Unauthorized' });
            }

            const driver = new WindowsPrinterDriver(fastify, { id: 0, name: 'scanner', type: 'windows' });
            await driver.initialize();

            const printers = await driver.getPrinterList();

            return {
                success: true,
                printers,
                scanned_at: new Date().toISOString()
            };
        } catch (error) {
            logger.error('[NodeAPI] Scan printers failed:', error);
            return reply.status(500).send({ error: (error as Error).message });
        }
    });

    /**
     * GET /internal/printers
     * Get all printers managed by this node
     */
    fastify.get('/internal/printers', async (request: FastifyRequest, reply: FastifyReply) => {
        const nodeSecret = request.headers['x-node-secret'];
        if (nodeSecret !== process.env.NODE_SECRET) {
            return reply.status(401).send({ error: 'Unauthorized' });
        }

        const printers = await fastify.knex('printers')
            .where('node_id', process.env.NODE_ID)
            .orderBy('name');

        return { printers };
    });

    /**
     * GET /internal/health
     * Health check endpoint for Central Hub
     */
    fastify.get('/internal/health', async (request: FastifyRequest, reply: FastifyReply) => {
        const driver = new WindowsPrinterDriver(fastify, { id: 0, name: 'health', type: 'windows' });
        const status = await driver.healthCheck();

        return {
            status: 'ok',
            node: process.env.NODE_NAME || 'unknown',
            uptime: process.uptime(),
            printerDrivers: fastify.printRouter.getAllDrivers().size,
            healthCheck: status,
            timestamp: new Date().toISOString()
        };
    });

    /**
     * POST /internal/cleanup-spool
     * Clean up old files in spool directory (older than 24 hours)
     */
    fastify.post('/internal/cleanup-spool', async (request: FastifyRequest, reply: FastifyReply) => {
        const nodeSecret = request.headers['x-node-secret'];
        if (nodeSecret !== process.env.NODE_SECRET) {
            return reply.status(401).send({ error: 'Unauthorized' });
        }

        try {
            const { maxAgeHours } = request.body as { maxAgeHours?: number };
            const driver = new WindowsPrinterDriver(fastify, { id: 0, name: 'cleanup', type: 'windows' });
            const result = await driver.cleanupSpool(maxAgeHours || 24);

            return result;
        } catch (error) {
            logger.error('[NodeAPI] Spool cleanup failed:', error);
            return reply.status(500).send({ error: (error as Error).message });
        }
    });

    /**
     * POST /internal/restart-spooler
     * Restart Windows Print Spooler
     */
    fastify.post('/internal/restart-spooler', async (request: FastifyRequest, reply: FastifyReply) => {
        const nodeSecret = request.headers['x-node-secret'];
        if (nodeSecret !== process.env.NODE_SECRET) {
            return reply.status(401).send({ error: 'Unauthorized' });
        }

        try {
            const driver = new WindowsPrinterDriver(fastify, { id: 0, name: 'spooler', type: 'windows' });
            const result = await driver.restartSpoolerService();

            return result;
        } catch (error) {
            logger.error('[NodeAPI] Restart spooler failed:', error);
            return reply.status(500).send({ error: (error as Error).message });
        }
    });

    /**
     * POST /internal/heartbeat
     * Receive periodic heartbeat from Windows node agent
     * Payload: { node_name, status, printers: [...], os_info: {...} }
     */
    fastify.post('/internal/heartbeat', async (request: FastifyRequest, reply: FastifyReply) => {
        try {
            const nodeSecret = request.headers['x-node-secret'];
            if (nodeSecret !== process.env.NODE_SECRET) {
                return reply.status(401).send({ error: 'Unauthorized' });
            }

            const body = request.body as {
                node_name?: string;
                status?: string;
                printers?: Array<{
                    name: string;
                    status?: string;
                    port?: string;
                    type?: string;
                    jobs_in_queue?: number;
                }>;
                os_info?: {
                    platform?: string;
                    release?: string;
                    hostname?: string;
                    arch?: string;
                    memory_gb?: number;
                    cpus?: number;
                };
            };

            const nodeName = body.node_name || os.hostname();
            const status = body.status || 'online';
            const printers = body.printers || [];
            const osInfo = body.os_info || {};

            logger.info(`[NodeAPI] Heartbeat from node: ${nodeName}, status: ${status}, printers: ${printers.length}`);

            // Update node last_seen in database
            const existingNode = await fastify.knex('windows_nodes')
                .where('hostname', nodeName)
                .first();

            if (existingNode) {
                await fastify.knex('windows_nodes')
                    .where({ id: existingNode.id })
                    .update({
                        last_heartbeat: new Date(),
                        is_online: status === 'online',
                        metadata: JSON.stringify({ printers, os_info: osInfo })
                    });
            }

            // Record heartbeat in history table
            await fastify.knex('node_heartbeats').insert({
                node_id: existingNode?.id || null,
                node_name: nodeName,
                status,
                printers_json: JSON.stringify(printers),
                os_info_json: JSON.stringify(osInfo),
                recorded_at: new Date()
            });

            // Emit Socket.IO event for real-time updates
            fastify.io?.emit('node:heartbeat', {
                node_name: nodeName,
                status,
                printers,
                os_info: osInfo,
                timestamp: new Date().toISOString()
            });

            return {
                success: true,
                node_name: nodeName,
                received_at: new Date().toISOString()
            };
        } catch (error) {
            logger.error('[NodeAPI] Heartbeat failed:', error);
            return reply.status(500).send({ error: (error as Error).message });
        }
    });
}

export default setupNodeInternalRoutes;