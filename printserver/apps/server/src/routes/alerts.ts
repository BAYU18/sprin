import { FastifyInstance } from 'fastify';

export async function setupAlertsRoutes(fastify: FastifyInstance) {
    fastify.get('/', async (request, reply) => {
        const { page = 1, limit = 50, severity, type, resolved } = request.query as any;

        let query = fastify.knex('alerts')
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
            query = query.where('alerts.severity', severity);
        }
        if (type) {
            query = query.where('alerts.type', type);
        }
        if (resolved !== undefined) {
            query = query.where('alerts.is_resolved', resolved === 'true');
        }

        const alerts = await query;

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