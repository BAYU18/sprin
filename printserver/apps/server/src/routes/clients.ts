import { FastifyInstance } from 'fastify';
import { z } from 'zod';

const clientSchema = z.object({
    hostname: z.string(),
    ip_address: z.string().optional(),
    mac_address: z.string().optional(),
    os_version: z.string().optional(),
    client_version: z.string().optional(),
    secret_key: z.string().optional()
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
            const body = clientSchema.parse(request.body);
            const { secret_key } = request.body as { secret_key?: string };

            if (secret_key && secret_key !== process.env.CLIENT_SECRET) {
                return reply.status(401).send({ error: 'Invalid secret key' });
            }

            const existing = await fastify.knex('clients')
                .where('hostname', body.hostname)
                .first();

            let client;
            if (existing) {
                [client] = await fastify.knex('clients')
                    .where({ id: existing.id })
                    .update({
                        ip_address: body.ip_address,
                        os_version: body.os_version,
                        client_version: body.client_version,
                        is_online: true,
                        last_seen: new Date()
                    })
                    .returning('*');
            } else {
                const crypto = await import('crypto');
                const secret = crypto.randomBytes(16).toString('hex');

                [client] = await fastify.knex('clients')
                    .insert({
                        ...body,
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
        const { status, printers, jobs } = request.body as any;

        await fastify.knex('clients')
            .where({ id })
            .update({
                is_online: status === 'online',
                last_seen: new Date(),
                metadata: JSON.stringify({ printers, jobs })
            });

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