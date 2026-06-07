import { FastifyInstance } from 'fastify';
import { z } from 'zod';

const alertQuerySchema = z.object({
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(100).default(50),
    severity: z.enum(['low', 'medium', 'high', 'critical']).optional(),
    type: z.string().optional(),
    resolved: z.enum(['true', 'false']).optional()
});

export async function setupAlertsRoutes(fastify: FastifyInstance) {
    fastify.get('/', async (request, reply) => {
        const query = alertQuerySchema.parse(request.query);
        const { page, limit, severity, type, resolved } = query;

        let alertQuery = fastify.knex('alerts')
            .leftJoin('clients', 'alerts.client_id', 'clients.id')
            .leftJoin('printers', 'alerts.printer_id', 'printers.id')
            .select(
                'alerts.*',
                'clients.hostname as client_name',
                'printers.name as printer_name'
            )
            .orderBy('alerts.created_at', 'desc')
            .limit(limit)
            .offset((page - 1) * limit);

        if (severity) {
            alertQuery = alertQuery.where('alerts.severity', severity);
        }
        if (type) {
            alertQuery = alertQuery.where('alerts.type', type);
        }
        if (resolved !== undefined) {
            alertQuery = alertQuery.where('alerts.is_resolved', resolved === 'true');
        }

        const alerts = await alertQuery;

        return alerts;
    });

    fastify.get('/unresolved', async (request, reply) => {
        const alerts = await fastify.knex('alerts')
            .where({ is_resolved: false })
            .orderBy('created_at', 'desc');

        return alerts;
    });

    fastify.put('/:id/resolve', async (request, reply) => {
        const { id } = request.params as { id: string };

        await fastify.knex('alerts')
            .where({ id })
            .update({
                is_resolved: true,
                resolved_at: new Date()
            });

        return { success: true };
    });

    fastify.put('/resolve-all', async (request, reply) => {
        await fastify.knex('alerts')
            .where({ is_resolved: false })
            .update({
                is_resolved: true,
                resolved_at: new Date()
            });

        return { success: true };
    });

    fastify.delete('/:id', async (request, reply) => {
        const { id } = request.params as { id: string };

        await fastify.knex('alerts')
            .where({ id })
            .delete();

        return { success: true };
    });
}