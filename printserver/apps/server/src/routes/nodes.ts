import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { generatePrinterSlug, ensureUniquePrinterSlug } from '../utils/printer-slug.js';

const heartbeatSchema = z.object({
    printers: z.array(z.object({
        name: z.string(),
        status: z.string(),
        jobs_in_queue: z.number().int().nonnegative().default(0)
    })).default([]),
    stats: z.object({
        printers_online: z.number().int().nonnegative().default(0),
        printers_offline: z.number().int().nonnegative().default(0),
        jobs_in_queue: z.number().int().nonnegative().default(0),
        cpu_usage: z.number().min(0).max(100).default(0),
        memory_usage: z.number().min(0).max(100).default(0)
    }).default({
        printers_online: 0,
        printers_offline: 0,
        jobs_in_queue: 0,
        cpu_usage: 0,
        memory_usage: 0
    }),
    version: z.string().optional(),
    hostname: z.string().optional()
});

const printerUpdateSchema = z.object({
    printers: z.array(z.object({
        name: z.string(),
        status: z.string(),
        driver: z.string().optional(),
        port: z.string().optional(),
        is_shared: z.boolean().default(true),
        share_name: z.string().optional(),
        capabilities: z.any().optional()
    })).default([]),
    force_sync: z.boolean().default(false)
});

const nodeQuerySchema = z.object({
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(100).default(50),
    status: z.enum(['online', 'offline', 'all']).default('all')
});

const jobQuerySchema = z.object({
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(100).default(50),
    status: z.enum(['queued', 'printing', 'completed', 'failed', 'all']).default('all')
});

async function ensureNodesTable(knex: any) {
    const exists = await knex.schema.hasTable('windows_nodes');
    if (!exists) {
        await knex.schema.createTable('windows_nodes', (table: any) => {
            table.increments('id').primary();
            table.string('hostname').unique().notNullable();
            table.string('ip_address');
            table.string('mac_address');
            table.string('os_version');
            table.string('node_version').defaultTo('1.0.0');
            table.string('secret_key').unique();
            table.boolean('is_online').defaultTo(false);
            table.timestamp('last_heartbeat');
            table.jsonb('printer_stats').defaultTo('{}');
            table.jsonb('system_stats').defaultTo('{}');
            table.timestamps(true, true);
        });
        logger.info('[Nodes] windows_nodes table created');
    }
}

async function syncPrintersFromNode(knex: any, nodeId: number, printers: any[], forceSync: boolean) {
    for (const printer of printers) {
        const existing = await knex('printers')
            .where('name', printer.name)
            .where('client_id', nodeId)
            .first();

        const printerData = {
            name: printer.name,
            driver: printer.driver || null,
            port: printer.port || null,
            type: 'network',
            is_shared: printer.is_shared !== false,
            share_name: printer.share_name || null,
            status: printer.status === 'online' ? 'online' : 'offline',
            capabilities: printer.capabilities ? JSON.stringify(printer.capabilities) : null,
            client_id: nodeId
        };

        if (existing) {
            if (forceSync) {
                // Backfill slug if missing
                const slug = existing.slug || await ensureUniquePrinterSlug(
                    knex,
                    generatePrinterSlug(printer.name),
                    existing.id
                );
                await knex('printers')
                    .where({ id: existing.id })
                    .update({
                        ...printerData,
                        slug
                    });
                logger.debug(`[Nodes] Printer updated: ${printer.name}`);
            }
        } else {
            // Auto-generate unique slug
            const slug = await ensureUniquePrinterSlug(knex, generatePrinterSlug(printer.name));
            const [created] = await knex('printers')
                .insert({
                    ...printerData,
                    slug
                })
                .returning('*');
            logger.debug(`[Nodes] Printer created: ${printer.name} (slug=${slug})`);
        }
    }
}

export async function setupNodesRoutes(fastify: FastifyInstance) {
    await ensureNodesTable(fastify.knex);

    fastify.get('/', async (request, reply) => {
        const query = nodeQuerySchema.parse(request.query);
        const { page, limit, status } = query;

        let queryBuilder = fastify.knex('windows_nodes')
            .select('windows_nodes.*')
            .leftJoin('clients', 'windows_nodes.hostname', 'clients.hostname')
            .select(fastify.knex.raw('clients.is_online as client_online'));

        if (status !== 'all') {
            queryBuilder = queryBuilder.where('windows_nodes.is_online', status === 'online');
        }

        const nodes = await queryBuilder
            .orderBy('windows_nodes.last_heartbeat', 'desc')
            .limit(limit)
            .offset((page - 1) * limit);

        const [{ count }] = await fastify.knex('windows_nodes')
            .count('* as count');

        return {
            nodes,
            total: count,
            page,
            limit
        };
    });

    fastify.get('/:id', async (request, reply) => {
        const { id } = request.params as { id: string };

        const node = await fastify.knex('windows_nodes')
            .where({ id })
            .first();

        if (!node) {
            return reply.status(404).send({ error: 'Node not found' });
        }

        const printers = await fastify.knex('printers')
            .where({ client_id: id })
            .orderBy('name');

        const stats = await fastify.knex('print_jobs')
            .where({ client_id: id })
            .select(
                fastify.knex.raw('COUNT(*) as total_jobs'),
                fastify.knex.raw('SUM(CASE WHEN status = \'completed\' THEN 1 ELSE 0 END) as completed_jobs'),
                fastify.knex.raw('SUM(CASE WHEN status = \'failed\' THEN 1 ELSE 0 END) as failed_jobs'),
                fastify.knex.raw('SUM(file_size) as total_bytes_printed'),
                fastify.knex.raw('SUM(pages) as total_pages_printed')
            )
            .first();

        return {
            ...node,
            printers,
            job_stats: stats
        };
    });

    fastify.post('/:id/heartbeat', async (request, reply) => {
        const { id } = request.params as { id: string };

        const node = await fastify.knex('windows_nodes')
            .where({ id })
            .first();

        if (!node) {
            return reply.status(404).send({ error: 'Node not found' });
        }

        let payload: any;
        try {
            payload = heartbeatSchema.parse(request.body);
        } catch (error) {
            if (error instanceof z.ZodError) {
                return reply.status(400).send({
                    error: 'Invalid heartbeat payload',
                    details: error.errors
                });
            }
            throw error;
        }

        const { printers, stats } = payload;

        await fastify.knex('windows_nodes')
            .where({ id })
            .update({
                is_online: true,
                last_heartbeat: new Date(),
                printer_stats: {
                    printers_online: stats.printers_online,
                    printers_offline: stats.printers_offline,
                    jobs_in_queue: stats.jobs_in_queue,
                    printer_count: printers.length
                },
                system_stats: {
                    cpu_usage: stats.cpu_usage,
                    memory_usage: stats.memory_usage
                },
                node_version: payload.version || node.node_version
            });

        for (const printer of printers) {
            await fastify.knex('printers')
                .where('name', printer.name)
                .where('client_id', id)
                .update({
                    status: printer.status === 'online' ? 'online' : 'offline',
                    metadata: JSON.stringify({ jobs_in_queue: printer.jobs_in_queue })
                });
        }

        fastify.io?.emit('node:heartbeat', {
            nodeId: parseInt(id),
            hostname: node.hostname,
            stats,
            printerCount: printers.length
        });

        logger.debug(`[Nodes] Heartbeat from ${node.hostname}: ${printers.length} printers, CPU: ${stats.cpu_usage}%, Mem: ${stats.memory_usage}%`);

        return {
            success: true,
            server_time: new Date().toISOString()
        };
    });

    fastify.post('/:id/printer-update', async (request, reply) => {
        const { id } = request.params as { id: string };

        const node = await fastify.knex('windows_nodes')
            .where({ id })
            .first();

        if (!node) {
            return reply.status(404).send({ error: 'Node not found' });
        }

        let payload: any;
        try {
            payload = printerUpdateSchema.parse(request.body);
        } catch (error) {
            if (error instanceof z.ZodError) {
                return reply.status(400).send({
                    error: 'Invalid printer update payload',
                    details: error.errors
                });
            }
            throw error;
        }

        const { printers, force_sync } = payload;

        await syncPrintersFromNode(fastify.knex, parseInt(id), printers, force_sync);

        await fastify.knex('windows_nodes')
            .where({ id })
            .update({
                last_heartbeat: new Date(),
                metadata: {
                    last_printer_sync: new Date().toISOString(),
                    printer_count: printers.length
                }
            });

        fastify.io?.emit('node:printers-updated', {
            nodeId: parseInt(id),
            hostname: node.hostname,
            printerCount: printers.length
        });

        logger.info(`[Nodes] Printer update from ${node.hostname}: ${printers.length} printers (force_sync: ${force_sync})`);

        return {
            success: true,
            printers_synced: printers.length,
            timestamp: new Date().toISOString()
        };
    });

    fastify.delete('/:id', async (request, reply) => {
        const { id } = request.params as { id: string };

        const node = await fastify.knex('windows_nodes')
            .where({ id })
            .first();

        if (!node) {
            return reply.status(404).send({ error: 'Node not found' });
        }

        await fastify.knex('windows_nodes')
            .where({ id })
            .delete();

        await fastify.knex('printers')
            .where({ client_id: id })
            .update({ status: 'offline' });

        fastify.io?.emit('node:unregistered', {
            nodeId: parseInt(id),
            hostname: node.hostname
        });

        logger.info(`[Nodes] Node unregistered: ${node.hostname}`);

        return {
            success: true,
            message: 'Node unregistered successfully'
        };
    });

    fastify.get('/:id/jobs', async (request, reply) => {
        const { id } = request.params as { id: string };
        const query = jobQuerySchema.parse(request.query);
        const { page, limit, status } = query;

        const node = await fastify.knex('windows_nodes')
            .where({ id })
            .first();

        if (!node) {
            return reply.status(404).send({ error: 'Node not found' });
        }

        let jobsQuery = fastify.knex('print_jobs')
            .where({ client_id: id });

        if (status !== 'all') {
            jobsQuery = jobsQuery.where({ status });
        }

        const jobs = await jobsQuery
            .leftJoin('users', 'print_jobs.user_id', 'users.id')
            .leftJoin('printers', 'print_jobs.printer_id', 'printers.id')
            .select(
                'print_jobs.*',
                'users.username as user_name',
                'users.email as user_email',
                'printers.name as printer_name'
            )
            .orderBy('print_jobs.created_at', 'desc')
            .limit(limit)
            .offset((page - 1) * limit);

        const [{ count }] = await fastify.knex('print_jobs')
            .where({ client_id: id })
            .count('* as count');

        return {
            jobs,
            total: count,
            page,
            limit
        };
    });

    fastify.post('/register', async (request, reply) => {
        const registerSchema = z.object({
            hostname: z.string(),
            ip_address: z.string().optional(),
            mac_address: z.string().optional(),
            os_version: z.string().optional(),
            version: z.string().optional(),
            secret_key: z.string().optional()
        });

        let body: any;
        try {
            body = registerSchema.parse(request.body);
        } catch (error) {
            if (error instanceof z.ZodError) {
                return reply.status(400).send({
                    error: 'Invalid registration payload',
                    details: error.errors
                });
            }
            throw error;
        }

        const { secret_key } = body;
        if (secret_key && secret_key !== process.env.NODE_SECRET) {
            return reply.status(401).send({ error: 'Invalid secret key' });
        }

        const existing = await fastify.knex('windows_nodes')
            .where('hostname', body.hostname)
            .first();

        let node;
        if (existing) {
            [node] = await fastify.knex('windows_nodes')
                .where({ id: existing.id })
                .update({
                    ip_address: body.ip_address,
                    os_version: body.os_version,
                    node_version: body.version,
                    is_online: true,
                    last_heartbeat: new Date()
                })
                .returning('*');
            logger.info(`[Nodes] Node re-registered: ${body.hostname}`);
        } else {
            const crypto = await import('crypto');
            const secret = crypto.randomBytes(16).toString('hex');

            [node] = await fastify.knex('windows_nodes')
                .insert({
                    hostname: body.hostname,
                    ip_address: body.ip_address,
                    mac_address: body.mac_address,
                    os_version: body.os_version,
                    node_version: body.version,
                    secret_key: secret,
                    is_online: true,
                    last_heartbeat: new Date()
                })
                .returning('*');
            logger.info(`[Nodes] New node registered: ${body.hostname}`);
        }

        fastify.io?.emit('node:online', { nodeId: node.id, hostname: node.hostname });

        return {
            success: true,
            node,
            message: existing ? 'Node re-registered successfully' : 'Node registered successfully'
        };
    });
}

import { logger } from '../utils/logger.js';