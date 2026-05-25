/**
 * PrintServer Pro - Discovery Service Routes
 * Central Hub API untuk multi-node print server
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { logger } from '../utils/logger.js';
import { v4 as uuidv4 } from 'uuid';
import { addPrintJob } from '../queues/index.js';

const registerNodeSchema = z.object({
    node_name: z.string().min(3),
    hostname: z.string().optional(),
    ip_address: z.string().optional(),
    mac_address: z.string().optional(),
    os_version: z.string().optional(),
    api_version: z.string().default('1.0.0'),
    printers: z.array(z.object({
        name: z.string(),
        driver: z.string().optional(),
        port: z.string().optional(),
        type: z.string().default('windows'),
        capabilities: z.any().optional()
    })).optional()
});

const heartbeatSchema = z.object({
    printers: z.array(z.object({
        name: z.string(),
        status: z.string(),
        jobs_in_queue: z.number().optional()
    })).optional(),
    stats: z.object({
        printers_online: z.number().optional(),
        printers_offline: z.number().optional(),
        jobs_in_queue: z.number().optional(),
        active_jobs: z.number().optional()
    }).optional()
});

export async function setupDiscoveryRoutes(fastify: FastifyInstance) {

    /**
     * GET /api/discovery/printers
     * Ambil semua printer dari seluruh nodes yang online
     */
    fastify.get('/discovery/printers', async (request: FastifyRequest, reply: FastifyReply) => {
        try {
            const { status, node_id, type } = request.query as {
                status?: string;
                node_id?: number;
                type?: string;
            };

            let query = fastify.knex('printers')
                .leftJoin('nodes', 'printers.node_id', 'nodes.id')
                .leftJoin('printer_groups', 'printers.group_id', 'printer_groups.id')
                .select(
                    'printers.*',
                    'nodes.node_name',
                    'nodes.api_url',
                    'nodes.status as node_status',
                    'printer_groups.name as group_name'
                )
                .where('nodes.status', 'online');

            if (status) {
                query = query.where('printers.status', status);
            }

            if (node_id) {
                query = query.where('printers.node_id', node_id);
            }

            if (type) {
                query = query.where('printers.type', type);
            }

            const printers = await query.orderBy('printers.name');

            // Group by node for client convenience
            const groupedByNode = printers.reduce((acc, printer) => {
                if (!printer.node_id) return acc;

                if (!acc[printer.node_id]) {
                    acc[printer.node_id] = {
                        node_id: printer.node_id,
                        node_name: printer.node_name,
                        api_url: printer.api_url,
                        status: printer.node_status,
                        printers: []
                    };
                }

                acc[printer.node_id].printers.push({
                    id: printer.id,
                    name: printer.name,
                    driver: printer.driver,
                    port: printer.port,
                    type: printer.type,
                    status: printer.status,
                    is_shared: printer.is_shared,
                    share_name: printer.share_name,
                    is_default: printer.is_default,
                    group_id: printer.group_id,
                    group_name: printer.group_name
                });

                return acc;
            }, {} as Record<number, any>);

            return {
                printers,
                grouped_by_node: Object.values(groupedByNode),
                total: printers.length,
                nodes_online: Object.keys(groupedByNode).length
            };
        } catch (error) {
            logger.error('[Discovery] Failed to fetch printers:', error);
            return reply.status(500).send({ error: 'Failed to fetch printers' });
        }
    });

    /**
     * GET /api/discovery/nodes
     * Ambil semua nodes (Windows Servers)
     */
    fastify.get('/discovery/nodes', async (request: FastifyRequest, reply: FastifyReply) => {
        try {
            const nodes = await fastify.knex('nodes')
                .leftJoin(
                    fastify.knex('printers')
                        .select('node_id')
                        .count('* as printer_count')
                        .groupBy('node_id')
                        .as('printer_counts'),
                    'nodes.id',
                    'printer_counts.node_id'
                )
                .select(
                    'nodes.*',
                    'printer_counts.printer_count'
                );

            const nodesWithStats = await Promise.all(nodes.map(async (node: any) => {
                const latestHeartbeat = await fastify.knex('node_heartbeats')
                    .where('node_id', node.id)
                    .orderBy('recorded_at', 'desc')
                    .first();

                return {
                    ...node,
                    printer_count: node.printer_count || 0,
                    last_stats: latestHeartbeat || null
                };
            }));

            return { nodes: nodesWithStats };
        } catch (error) {
            logger.error('[Discovery] Failed to fetch nodes:', error);
            return reply.status(500).send({ error: 'Failed to fetch nodes' });
        }
    });

    /**
     * GET /api/discovery/node/:id
     * Detail satu node dengan printer-nya
     */
    fastify.get('/discovery/node/:id', async (request: FastifyRequest, reply: FastifyReply) => {
        try {
            const { id } = request.params as { id: string };

            const node = await fastify.knex('nodes').where({ id }).first();

            if (!node) {
                return reply.status(404).send({ error: 'Node not found' });
            }

            const printers = await fastify.knex('printers')
                .where({ node_id: id })
                .orderBy('name');

            const heartbeats = await fastify.knex('node_heartbeats')
                .where('node_id', id)
                .orderBy('recorded_at', 'desc')
                .limit(10);

            return {
                node,
                printers: {
                    total: printers.length,
                    items: printers
                },
                heartbeat_history: heartbeats
            };
        } catch (error) {
            logger.error('[Discovery] Failed to fetch node:', error);
            return reply.status(500).send({ error: 'Failed to fetch node' });
        }
    });

    /**
     * POST /api/nodes/register
     * Windows Node mendaftarkan dirinya ke Central Server
     * NOTE: Handled by nodes.ts route - commenting to avoid duplicate
     */
    /*
    fastify.post('/nodes/register', async (request: FastifyRequest, reply: FastifyReply) => {
        try {
            const body = registerNodeSchema.parse(request.body);

            logger.info(`[NodeRegistration] Registering node: ${body.node_name}`);

            // Check if node already exists
            let node = await fastify.knex('nodes')
                .where('node_name', body.node_name)
                .orWhere('mac_address', body.mac_address)
                .first();

            const secretKey = node?.secret_key || uuidv4();

            if (node) {
                // Update existing node
                await fastify.knex('nodes')
                    .where({ id: node.id })
                    .update({
                        hostname: body.hostname,
                        ip_address: body.ip_address,
                        mac_address: body.mac_address,
                        os_version: body.os_version,
                        api_url: body.api_url || node.api_url,
                        status: 'online',
                        last_heartbeat: new Date()
                    });

                node = await fastify.knex('nodes').where({ id: node.id }).first();
                logger.info(`[NodeRegistration] Updated existing node: ${node.node_name} (ID: ${node.id})`);
            } else {
                // Create new node
                [node] = await fastify.knex('nodes')
                    .insert({
                        node_name: body.node_name,
                        hostname: body.hostname,
                        ip_address: body.ip_address,
                        mac_address: body.mac_address,
                        os_version: body.os_version,
                        api_url: body.api_url,
                        secret_key: secretKey,
                        status: 'online',
                        last_heartbeat: new Date()
                    })
                    .returning('*');

                logger.info(`[NodeRegistration] Created new node: ${node.node_name} (ID: ${node.id})`);
            }

            // Register/update printers
            if (body.printers && body.printers.length > 0) {
                // Deactivate old printers from this node
                await fastify.knex('printers')
                    .where({ node_id: node.id })
                    .update({ status: 'inactive' });

                for (const printer of body.printers) {
                    // Check if printer already exists
                    const existingPrinter = await fastify.knex('printers')
                        .where('name', printer.name)
                        .where('node_id', node.id)
                        .first();

                    if (existingPrinter) {
                        // Update existing printer
                        await fastify.knex('printers')
                            .where({ id: existingPrinter.id })
                            .update({
                                driver: printer.driver,
                                port: printer.port,
                                type: printer.type,
                                capabilities: JSON.stringify(printer.capabilities || {}),
                                status: 'ready',
                                last_updated: new Date()
                            });
                    } else {
                        // Insert new printer
                        await fastify.knex('printers')
                            .insert({
                                name: printer.name,
                                driver: printer.driver,
                                port: printer.port,
                                type: printer.type || 'windows',
                                capabilities: JSON.stringify(printer.capabilities || {}),
                                node_id: node.id,
                                status: 'ready'
                            });
                    }
                }

                logger.info(`[NodeRegistration] Registered ${body.printers.length} printers for node ${node.node_name}`);
            }

            // Return JWT token for this node
            const token = fastify.jwt.sign({
                id: node.id,
                node_name: node.node_name,
                type: 'node'
            });

            return {
                success: true,
                node_id: node.id,
                node_name: node.node_name,
                token,
                secret_key: secretKey
            };
        } catch (error) {
            logger.error('[NodeRegistration] Failed:', error);
            return reply.status(400).send({ error: (error as Error).message });
        }
    });
    */

    /**
     * POST /api/nodes/:id/heartbeat
     * Windows Server mengirim heartbeat secara periodik
     * NOTE: Handled by nodes.ts route - commenting to avoid duplicate
     */
    /*
    fastify.post('/nodes/:id/heartbeat', async (request: FastifyRequest, reply: FastifyReply) => {
        try {
            const { id } = request.params as { id: string };
            const body = heartbeatSchema.parse(request.body);

            // Verify node exists
            const node = await fastify.knex('nodes').where({ id }).first();
            if (!node) {
                return reply.status(404).send({ error: 'Node not found' });
            }

            // Update last heartbeat
            await fastify.knex('nodes')
                .where({ id })
                .update({
                    status: 'online',
                    last_heartbeat: new Date()
                });

            // Record heartbeat stats
            if (body.stats) {
                await fastify.knex('node_heartbeats')
                    .insert({
                        node_id: id,
                        printers_online: body.stats.printers_online || 0,
                        printers_offline: body.stats.printers_offline || 0,
                        jobs_in_queue: body.stats.jobs_in_queue || 0,
                        active_jobs: body.stats.active_jobs || 0,
                        recorded_at: new Date()
                    });
            }

            // Update printer statuses if provided
            if (body.printers && body.printers.length > 0) {
                for (const printerStatus of body.printers) {
                    await fastify.knex('printers')
                        .where({ node_id: id, name: printerStatus.name })
                        .update({ status: printerStatus.status });
                }
            }

            // Emit node update via Socket.IO
            fastify.io?.emit('node:heartbeat', {
                nodeId: parseInt(id),
                status: 'online',
                printers: body.printers
            });

            return { success: true, timestamp: new Date().toISOString() };
        } catch (error) {
            logger.error('[Heartbeat] Failed:', error);
            return reply.status(400).send({ error: (error as Error).message });
        }
    });
    */

    /**
     * DELETE /api/nodes/:id
     * Hapus node (dari Dashboard admin)
     * NOTE: Handled by nodes.ts route - commenting to avoid duplicate
     */
    /*
    fastify.delete('/nodes/:id', async (request: FastifyRequest, reply: FastifyReply) => {
        try {
            const { id } = request.params as { id: string };

            const node = await fastify.knex('nodes').where({ id }).first();
            if (!node) {
                return reply.status(404).send({ error: 'Node not found' });
            }

            // Remove node (printers will have node_id set to NULL via ON DELETE SET NULL)
            await fastify.knex('nodes').where({ id }).delete();

            logger.info(`[Node] Deleted node: ${node.node_name}`);

            return { success: true };
        } catch (error) {
            logger.error('[Node] Delete failed:', error);
            return reply.status(500).send({ error: 'Failed to delete node' });
        }
    });
    */

    /**
     * GET /api/discovery/printer-groups
     * Ambil semua printer groups dengan printers-nya
     */
    fastify.get('/discovery/printer-groups', async (request: FastifyRequest, reply: FastifyReply) => {
        try {
            const groups = await fastify.knex('printer_groups')
                .leftJoin('printers', 'printer_groups.id', 'printers.group_id')
                .select(
                    'printer_groups.*',
                    'printers.id as printer_id',
                    'printers.name as printer_name',
                    'printers.status as printer_status',
                    'printers.node_id'
                )
                .orderBy('printer_groups.name');

            // Group printers by group
            const result = groups.reduce((acc: any[], row: any) => {
                const existingGroup = acc.find(g => g.id === row.id);

                if (existingGroup) {
                    if (row.printer_id) {
                        existingGroup.printers.push({
                            id: row.printer_id,
                            name: row.printer_name,
                            status: row.printer_status,
                            node_id: row.node_id
                        });
                    }
                } else {
                    acc.push({
                        id: row.id,
                        name: row.name,
                        description: row.description,
                        printers: row.printer_id ? [{
                            id: row.printer_id,
                            name: row.printer_name,
                            status: row.printer_status,
                            node_id: row.node_id
                        }] : []
                    });
                }

                return acc;
            }, []);

            return { groups: result };
        } catch (error) {
            logger.error('[Discovery] Failed to fetch printer groups:', error);
            return reply.status(500).send({ error: 'Failed to fetch printer groups' });
        }
    });

    /**
     * POST /api/nodes/:id/command
     * Kirim perintah ke node tertentu (restart spooler, dll)
     */
    fastify.post('/nodes/:id/command', async (request: FastifyRequest, reply: FastifyReply) => {
        try {
            const { id } = request.params as { id: string };
            const { command, params } = request.body as { command: string; params?: any };

            const node = await fastify.knex('nodes').where({ id }).first();
            if (!node) {
                return reply.status(404).send({ error: 'Node not found' });
            }

            if (node.status !== 'online') {
                return reply.status(503).send({ error: 'Node is offline' });
            }

            // Emit command to node via Socket.IO
            fastify.io?.emit(`node:${id}:command`, { command, params });

            // Also publish to Redis for reliability
            await fastify.redis.publish(`node:${id}:commands`, JSON.stringify({
                command,
                params,
                timestamp: new Date().toISOString()
            }));

            logger.info(`[NodeCommand] Sent '${command}' to node ${node.node_name} (${id})`);

            return {
                success: true,
                command,
                node_id: id,
                message: `Command sent to node ${node.node_name}`
            };
        } catch (error) {
            logger.error('[NodeCommand] Failed:', error);
            return reply.status(500).send({ error: 'Failed to send command' });
        }
    });
}

// ============================================
// Types for TypeScript
// ============================================

export interface IPrintNode {
    id: number;
    node_name: string;
    hostname?: string;
    ip_address?: string;
    mac_address?: string;
    api_url: string;
    secret_key: string;
    status: 'online' | 'offline' | 'warning';
    os_version?: string;
    api_version: string;
    metadata?: any;
    last_heartbeat?: Date;
    created_at?: Date;
    updated_at?: Date;
}

export interface IPrinter {
    id: number;
    name: string;
    driver?: string;
    port?: string;
    type: string;
    node_id?: number;
    status: string;
    is_shared: boolean;
    share_name?: string;
    is_default: boolean;
    capabilities?: any;
    group_id?: number;
}

export interface NodeHeartbeat {
    id: number;
    node_id: number;
    printers_online: number;
    printers_offline: number;
    jobs_in_queue: number;
    active_jobs: number;
    cpu_usage?: string;
    memory_usage?: string;
    recorded_at: Date;
}

export default setupDiscoveryRoutes;