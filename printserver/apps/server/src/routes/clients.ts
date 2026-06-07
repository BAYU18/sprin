import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { generatePrinterSlug, ensureUniquePrinterSlug } from '../utils/printer-slug.js';

const clientSchema = z.object({
    hostname: z.string().optional(),
    name: z.string().optional(),
    ip_address: z.string().optional(),
    mac_address: z.string().optional(),
    os_version: z.string().optional(),
    client_version: z.string().optional(),
    secret_key: z.string().optional(),
    secretKey: z.string().optional(),
    printers: z.array(z.string()).optional(),
    capabilities: z.object({}).passthrough().optional(),
    platform: z.string().optional(),
    arch: z.string().optional(),
    memory: z.number().optional(),
    cpus: z.number().optional(),
    version: z.string().optional()
}).refine(data => data.hostname || data.name, {
    message: "Either hostname or name is required"
});

const heartbeatSchema = z.object({
    status: z.enum(['online', 'offline']).optional(),
    printers: z.array(z.object({
        name: z.string(),
        status: z.string().optional(),
        jobs_in_queue: z.number().int().nonnegative().optional()
    })).optional(),
    jobs: z.any().optional()
});

export async function setupClientsRoutes(fastify: FastifyInstance) {
    fastify.get('/', async (request, reply) => {
        const clients = await fastify.knex('clients')
            .select('*')
            .orderBy('hostname');

        return clients;
    });

    fastify.get('/:id', async (request, reply) => {
        const { id } = request.params as { id: string };

        const client = await fastify.knex('clients')
            .where({ id })
            .first();

        if (!client) {
            return reply.status(404).send({ error: 'Client not found' });
        }

        const printers = await fastify.knex('printers')
            .where({ client_id: id });

        const recentJobs = await fastify.knex('print_jobs')
            .where({ client_id: id })
            .orderBy('created_at', 'desc')
            .limit(10);

        return { ...client, printers, recentJobs };
    });

    fastify.post('/register', async (request, reply) => {
        try {
            const raw = request.body as any;
            // Normalize field names (support both old and new agent formats)
            const hostname = raw.hostname || raw.name || 'unknown';
            const clientVersion = raw.client_version || raw.version || '1.0.0';
            const secretKey = raw.secret_key || raw.secretKey;
            const ipAddress = raw.ip_address || null;
            const osVersion = raw.os_version || raw.platform || null;

            const insertData = {
                hostname,
                ip_address: ipAddress,
                mac_address: raw.mac_address || null,
                os_version: osVersion,
                client_version: clientVersion,
            };

            if (secretKey && secretKey !== process.env.CLIENT_SECRET) {
                return reply.status(401).send({ error: 'Invalid secret key' });
            }

            const existing = await fastify.knex('clients')
                .where('hostname', hostname)
                .first();

            let client;
            if (existing) {
                [client] = await fastify.knex('clients')
                    .where({ id: existing.id })
                    .update({
                        ip_address: ipAddress,
                        os_version: osVersion,
                        client_version: clientVersion,
                        is_online: true,
                        last_seen: new Date()
                    })
                    .returning('*');
            } else {
                const crypto = await import('crypto');
                const secret = crypto.randomBytes(16).toString('hex');

                [client] = await fastify.knex('clients')
                    .insert({
                        ...insertData,
                        secret_key: secret,
                        is_online: true,
                        last_seen: new Date()
                    })
                    .returning('*');
            }

            fastify.io?.emit('client:online', { clientId: client.id, hostname: client.hostname });

            return client;
        } catch (error) {
            logger.error('[Clients] Registration error:', error);
            return reply.status(500).send({ error: 'Registration failed' });
        }
    });

    fastify.post('/:id/heartbeat', async (request, reply) => {
        const { id } = request.params as { id: string };

        let body: z.infer<typeof heartbeatSchema>;
        try {
            body = heartbeatSchema.parse(request.body);
        } catch (error) {
            if (error instanceof z.ZodError) {
                return reply.status(400).send({ error: 'Invalid heartbeat payload', details: error.errors });
            }
            throw error;
        }

        const { status, printers, jobs } = body;

        await fastify.knex('clients')
            .where({ id })
            .update({
                is_online: status === 'online',
                last_seen: new Date(),
                metadata: { printers, jobs }
            });

        // Sync printer list from agent heartbeat
        if (Array.isArray(printers)) {
            const BUILTIN_PATTERNS = [
                /^[\\/]{2}.*/i,
                /microsoft print to pdf/i,
                /microsoft xps document writer/i,
                /onenote/i,
                /^fax$/i,
                /nitro pdf creator/i
            ];

            const isFiltered = (name) => {
                if (!name || typeof name !== 'string') return true;
                return BUILTIN_PATTERNS.some(re => re.test(name.trim()));
            };

            const printerNames = printers
                .map((p: any) => (typeof p === 'string' ? p : p?.name))
                .filter((n: any) => typeof n === 'string' && !isFiltered(n))
                .map((n: string) => n.trim());

            const seen = new Set<string>();
            for (const name of printerNames) {
                const trimmed = name.trim();
                const key = trimmed.toLowerCase();
                if (seen.has(key)) continue;
                seen.add(key);

                const existing = await fastify.knex('printers')
                    .where({ client_id: id })
                    .whereRaw('LOWER(name) = ?', [key])
                    .first();

                if (existing) {
                    // Backfill slug if missing (older records before slug column was added)
                    const slug = existing.slug || await ensureUniquePrinterSlug(
                        fastify.knex,
                        generatePrinterSlug(trimmed),
                        existing.id
                    );

                    // If the printer was previously auto-hidden (15 min offline
                    // rule), restore it now that the node is reporting it again.
                    const wasRemoved = (existing.config as any)?.auto_removed === 'true';
                    const existingConfig = (existing.config as any) || {};
                    if (wasRemoved) {
                        delete existingConfig.auto_removed;
                        delete existingConfig.auto_removed_at;
                        existingConfig.restored_at = new Date().toISOString();
                    }

                    const updatePayload: any = {
                        status: status === 'online' ? 'online' : 'offline',
                        slug,
                        updated_at: new Date()
                    };
                    if (wasRemoved) {
                        updatePayload.config = Object.keys(existingConfig).length
                            ? existingConfig : null;
                    }

                    await fastify.knex('printers')
                        .where({ id: existing.id })
                        .update(updatePayload);

                    if (wasRemoved) {
                        logger.info(`[Heartbeat] Restored auto-removed printer "${trimmed}" (id=${existing.id}) — node back online`);
                    }
                } else {
                    // Auto-generate unique slug for new printer
                    const slug = await ensureUniquePrinterSlug(
                        fastify.knex,
                        generatePrinterSlug(trimmed)
                    );
                    await fastify.knex('printers')
                        .insert({
                            name: trimmed,
                            driver: 'Unknown',
                            port: 'NODE',
                            type: 'network',
                            is_shared: true,
                            status: status === 'online' ? 'online' : 'offline',
                            client_id: id,
                            slug,
                            created_at: new Date(),
                            updated_at: new Date()
                        });
                }
            }

            // Mark printers no longer reported as offline
            await fastify.knex('printers')
                .where({ client_id: id })
                .whereNotIn('name', printerNames.map((n: string) => n.trim()))
                .update({ status: 'offline', updated_at: new Date() });
        }

        if (status === 'online') {
            fastify.io?.emit('client:heartbeat', { clientId: parseInt(id), status, printers });
        }

        return { success: true };
    });

    fastify.delete('/:id', async (request, reply) => {
        const { id } = request.params as { id: string };

        await fastify.knex('clients')
            .where({ id })
            .delete();

        fastify.io?.emit('client:offline', { clientId: parseInt(id) });

        return { success: true };
    });

    fastify.get('/online/count', async (request, reply) => {
        const [{ count }] = await fastify.knex('clients')
            .where({ is_online: true })
            .count('* as count');

        return { count };
    });
}

import { logger } from '../utils/logger.js';