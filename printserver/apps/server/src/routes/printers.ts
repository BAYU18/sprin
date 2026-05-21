import { FastifyInstance } from 'fastify';
import { z } from 'zod';

const printerSchema = z.object({
    name: z.string(),
    driver: z.string().optional(),
    port: z.string().optional(),
    type: z.enum(['network', 'usb', 'thermal', 'pdf']).default('network'),
    is_shared: z.boolean().default(true),
    share_name: z.string().optional(),
    is_default: z.boolean().default(false),
    group_id: z.number().optional(),
    config: z.any().optional()
});

const updatePrinterSchema = printerSchema.partial();

export async function setupPrintersRoutes(fastify: FastifyInstance) {
    fastify.get('/', async (request, reply) => {
        const printers = await fastify.knex('printers')
            .leftJoin('printer_groups', 'printers.group_id', 'printer_groups.id')
            .select(
                'printers.*',
                'printer_groups.name as group_name'
            );

        return printers;
    });

    fastify.get('/:id', async (request, reply) => {
        const { id } = request.params as { id: string };

        const printer = await fastify.knex('printers')
            .where({ id })
            .first();

        if (!printer) {
            return reply.status(404).send({ error: 'Printer not found' });
        }

        const recentJobs = await fastify.knex('print_jobs')
            .where({ printer_id: id })
            .orderBy('created_at', 'desc')
            .limit(10);

        const health = await fastify.knex('printer_health')
            .where({ printer_id: id })
            .orderBy('recorded_at', 'desc')
            .limit(20);

        return { ...printer, recentJobs, health };
    });

    fastify.post('/', async (request, reply) => {
        const body = printerSchema.parse(request.body);

        if (body.is_default) {
            await fastify.knex('printers').update({ is_default: false });
        }

        const [printer] = await fastify.knex('printers')
            .insert(body)
            .returning('*');

        fastify.io?.emit('printer:created', printer);

        return printer;
    });

    fastify.put('/:id', async (request, reply) => {
        const { id } = request.params as { id: string };
        const body = updatePrinterSchema.parse(request.body);

        if (body.is_default) {
            await fastify.knex('printers').update({ is_default: false });
        }

        const [printer] = await fastify.knex('printers')
            .where({ id })
            .update(body)
            .returning('*');

        if (!printer) {
            return reply.status(404).send({ error: 'Printer not found' });
        }

        fastify.io?.emit('printer:updated', printer);

        return printer;
    });

    fastify.delete('/:id', async (request, reply) => {
        const { id } = request.params as { id: string };

        const deleted = await fastify.knex('printers')
            .where({ id })
            .delete();

        if (!deleted) {
            return reply.status(404).send({ error: 'Printer not found' });
        }

        fastify.io?.emit('printer:deleted', { id });

        return { success: true };
    });

    fastify.get('/:id/status', async (request, reply) => {
        const { id } = request.params as { id: string };
        const { printRouter } = fastify;

        const driver = printRouter.getDriver(parseInt(id));
        if (!driver) {
            return reply.status(404).send({ error: 'Printer driver not found' });
        }

        const status = await driver.getStatus();
        return status;
    });

    fastify.get('/:id/jobs', async (request, reply) => {
        const { id } = request.params as { id: string };
        const { page = 1, limit = 50, status } = request.query as any;

        let query = fastify.knex('print_jobs')
            .where({ printer_id: id })
            .orderBy('created_at', 'desc')
            .limit(limit)
            .offset((page - 1) * limit);

        if (status) {
            query = query.where({ status });
        }

        const jobs = await query;
        const [{ count }] = await fastify.knex('print_jobs')
            .where({ printer_id: id })
            .count('* as count');

        return { jobs, total: count, page, limit };
    });
}