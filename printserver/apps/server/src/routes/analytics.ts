import { FastifyInstance } from 'fastify';

export async function setupAnalyticsRoutes(fastify: FastifyInstance) {
    fastify.get('/overview', async (request, reply) => {
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const [
            totalPrinters,
            onlinePrinters,
            totalClients,
            onlineClients,
            todayJobs,
            pendingJobs
        ] = await Promise.all([
            fastify.knex('printers').count('* as count').first(),
            fastify.knex('printers').where('status', 'online').count('* as count').first(),
            fastify.knex('clients').count('* as count').first(),
            fastify.knex('clients').where('is_online', true).count('* as count').first(),
            fastify.knex('print_jobs').where('created_at', '>=', today).count('* as count').first(),
            fastify.knex('queues').where('status', 'waiting').count('* as count').first()
        ]);

        return {
            printers: {
                total: totalPrinters?.count || 0,
                online: onlinePrinters?.count || 0
            },
            clients: {
                total: totalClients?.count || 0,
                online: onlineClients?.count || 0
            },
            jobs: {
                today: todayJobs?.count || 0,
                pending: pendingJobs?.count || 0
            }
        };
    });

    fastify.get('/volume', async (request, reply) => {
        const { days = 7 } = request.query as { days?: number };

        const startDate = new Date();
        startDate.setDate(startDate.getDate() - days);

        const volumeData = await fastify.knex('print_jobs')
            .where('created_at', '>=', startDate)
            .select(
                fastify.knex.raw('DATE(created_at) as date'),
                fastify.knex.raw('COUNT(*) as jobs'),
                fastify.knex.raw('SUM(pages * copies) as pages')
            )
            .groupBy(fastify.knex.raw('DATE(created_at)'))
            .orderBy('date', 'asc');

        return volumeData;
    });

    fastfix.get('/printers/usage', async (request, reply) => {
        const topPrinters = await fastify.knex('print_jobs')
            .join('printers', 'print_jobs.printer_id', 'printers.id')
            .where('print_jobs.created_at', '>=', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000))
            .select(
                'printers.id',
                'printers.name',
                fastify.knex.raw('COUNT(*) as jobs'),
                fastify.knex.raw('SUM(print_jobs.pages * print_jobs.copies) as pages')
            )
            .groupBy('printers.id', 'printers.name')
            .orderBy('pages', 'desc')
            .limit(10);

        return topPrinters;
    });

    fastify.get('/users/top', async (request, reply) => {
        const { limit = 10 } = request.query as { limit?: number };

        const topUsers = await fastify.knex('print_jobs')
            .join('users', 'print_jobs.user_id', 'users.id')
            .where('print_jobs.created_at', '>=', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000))
            .select(
                'users.id',
                'users.username',
                'users.full_name',
                'users.department',
                fastify.knex.raw('COUNT(*) as jobs'),
                fastify.knex.raw('SUM(print_jobs.pages * print_jobs.copies) as pages')
            )
            .groupBy('users.id', 'users.username', 'users.full_name', 'users.department')
            .orderBy('pages', 'desc')
            .limit(limit);

        return topUsers;
    });

    fastify.get('/failures', async (request, reply) => {
        const failures = await fastify.knex('print_jobs')
            .where('status', 'failed')
            .where('created_at', '>=', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000))
            .select(
                fastify.knex.raw('error_message'),
                fastify.knex.raw('COUNT(*) as count')
            )
            .groupBy('error_message')
            .orderBy('count', 'desc')
            .limit(10);

        return failures;
    });

    fastify.get('/departments', async (request, reply) => {
        const deptStats = await fastify.knex('print_jobs')
            .join('users', 'print_jobs.user_id', 'users.id')
            .whereNotNull('users.department')
            .where('print_jobs.created_at', '>=', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000))
            .select(
                'users.department',
                fastify.knex.raw('COUNT(*) as jobs'),
                fastify.knex.raw('SUM(print_jobs.pages * print_jobs.copies) as pages')
            )
            .groupBy('users.department')
            .orderBy('pages', 'desc');

        return deptStats;
    });
}