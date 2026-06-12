import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { cache, cacheKeys } from '../utils/cache.js';

const volumeQuerySchema = z.object({
    days: z.coerce.number().int().min(1).max(365).default(7)
});

const topUsersQuerySchema = z.object({
    limit: z.coerce.number().int().min(1).max(100).default(10)
});

export async function setupAnalyticsRoutes(fastify: FastifyInstance) {
    fastify.get('/overview', async (request, reply) => {
        return await cache.getOrSet(cacheKeys.analytics('overview'), 300, async () => {
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
    });

    fastify.get('/volume', async (request, reply) => {
        const { days } = volumeQuerySchema.parse(request.query);

        return await cache.getOrSet(cacheKeys.analytics(`volume:${days}`), 300, async () => {
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
    });

    fastify.get('/printers/usage', async (request, reply) => {
        return await cache.getOrSet(cacheKeys.analytics('printers-usage'), 300, async () => {
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
    });

    fastify.get('/users/top', async (request, reply) => {
        const { limit } = topUsersQuerySchema.parse(request.query);

        return await cache.getOrSet(cacheKeys.analytics(`users-top:${limit}`), 300, async () => {
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
    });

    fastify.get('/failures', async (request, reply) => {
        return await cache.getOrSet(cacheKeys.analytics('failures'), 300, async () => {
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
    });

    fastify.get('/departments', async (request, reply) => {
        return await cache.getOrSet(cacheKeys.analytics('departments'), 300, async () => {
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
    });

    fastify.get('/paper/usage', async (request, reply) => {
        return await cache.getOrSet(cacheKeys.analytics('paper-usage'), 300, async () => {
            try {
                const paperUsage = await fastify.knex('print_jobs')
                    .select(
                        fastify.knex.raw('COALESCE(paper_size, \'Unknown\') as paper_size'),
                        fastify.knex.raw('COUNT(id) as job_count'),
                        fastify.knex.raw('COALESCE(SUM(pages), 0) as total_pages')
                    )
                    .groupByRaw('COALESCE(paper_size, \'Unknown\')')
                    .orderBy('total_pages', 'desc');

                return paperUsage;
            } catch (error) {
                request.log.error('Failed to fetch paper usage analytics:', error);
                return reply.status(500).send({ error: 'Internal Server Error' });
            }
        });
    });

    // ── TIER-3 #9: Usage report export (CSV) ───────────────────────
    fastify.get<{
        Querystring: { from?: string; to?: string; format?: string; scope?: string };
    }>('/export', async (request, reply) => {
        const { from, to, format = 'csv', scope = 'all' } = request.query;
        const fromDate = from ? new Date(from) : new Date(Date.now() - 30 * 24 * 3600 * 1000);
        const toDate = to ? new Date(to) : new Date();

        let query = fastify.knex('print_jobs')
            .leftJoin('printers', 'print_jobs.printer_id', 'printers.id')
            .leftJoin('users', 'print_jobs.user_id', 'users.id')
            .leftJoin('clients', 'print_jobs.client_id', 'clients.id')
            .where('print_jobs.created_at', '>=', fromDate)
            .where('print_jobs.created_at', '<=', toDate)
            .select(
                'print_jobs.job_id',
                'print_jobs.status',
                'print_jobs.pages',
                'print_jobs.copies',
                fastify.knex.raw('(print_jobs.pages * print_jobs.copies) as total_pages'),
                'print_jobs.paper_size',
                'print_jobs.color_mode',
                'print_jobs.duplex',
                'print_jobs.file_name',
                'print_jobs.error_message',
                'print_jobs.created_at',
                'print_jobs.started_at',
                'print_jobs.completed_at',
                'printers.name as printer_name',
                'printers.type as printer_type',
                'users.username',
                'users.full_name',
                'users.department',
                'clients.hostname as client_hostname'
            )
            .orderBy('print_jobs.created_at', 'desc')
            .limit(50000);  // safety cap

        if (scope !== 'all') {
            if (scope === 'failed') query = query.where('print_jobs.status', 'failed');
            else if (scope === 'completed') query = query.where('print_jobs.status', 'completed');
            else if (scope === 'cancelled') query = query.where('print_jobs.status', 'cancelled');
        }

        const rows = await query;

        if (format === 'json') {
            return {
                meta: {
                    from: fromDate.toISOString(),
                    to: toDate.toISOString(),
                    scope,
                    count: rows.length,
                    generated_at: new Date().toISOString(),
                },
                data: rows,
            };
        }

        // CSV format
        const headers = [
            'job_id', 'status', 'pages', 'copies', 'total_pages',
            'paper_size', 'color_mode', 'duplex', 'file_name',
            'printer_name', 'printer_type', 'username', 'full_name', 'department',
            'client_hostname', 'error_message',
            'created_at', 'started_at', 'completed_at',
        ];

        const escapeCsv = (v: any) => {
            if (v === null || v === undefined) return '';
            const s = String(v);
            if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
                return '"' + s.replace(/"/g, '""') + '"';
            }
            return s;
        };

        const csvLines = [headers.join(',')];
        for (const r of rows) {
            csvLines.push(headers.map(h => escapeCsv((r as any)[h])).join(','));
        }

        const csv = csvLines.join('\n');
        const filename = `printserver-usage-${scope}-${fromDate.toISOString().slice(0, 10)}-${toDate.toISOString().slice(0, 10)}.csv`;

        reply.header('Content-Type', 'text/csv; charset=utf-8');
        reply.header('Content-Disposition', `attachment; filename="${filename}"`);
        return csv;
    });
}