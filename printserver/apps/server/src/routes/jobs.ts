import { FastifyInstance } from 'fastify';
import { z } from 'zod';

const submitJobSchema = z.object({
    printerId: z.number(),
    filePath: z.string(),
    fileName: z.string(),
    fileType: z.string(),
    copies: z.number().default(1),
    options: z.any().optional()
});

const jobQuerySchema = z.object({
    page: z.coerce.number().default(1),
    limit: z.coerce.number().default(50),
    status: z.enum(['queued', 'processing', 'completed', 'failed', 'cancelled']).optional(),
    userId: z.coerce.number().optional(),
    clientId: z.coerce.number().optional(),
    printerId: z.coerce.number().optional()
});

export async function setupJobsRoutes(fastify: FastifyInstance) {
    fastify.get('/', async (request, reply) => {
        const query = jobQuerySchema.parse(request.query);
        const { page, limit, status, userId, clientId, printerId } = query;

        let whereClause: any = {};
        if (status) whereClause['print_jobs.status'] = status;
        if (userId) whereClause['print_jobs.user_id'] = userId;
        if (clientId) whereClause['print_jobs.client_id'] = clientId;
        if (printerId) whereClause['print_jobs.printer_id'] = printerId;

        const jobs = await fastify.knex('print_jobs')
            .leftJoin('users', 'print_jobs.user_id', 'users.id')
            .leftJoin('clients', 'print_jobs.client_id', 'clients.id')
            .leftJoin('printers as target_printer', 'print_jobs.printer_id', 'target_printer.id')
            .leftJoin('printers as queued_printer', 'print_jobs.queued_printer_id', 'queued_printer.id')
            .select(
                'print_jobs.*',
                'users.username',
                'users.full_name',
                'clients.hostname as client_hostname',
                'target_printer.name as printer_name',
                'queued_printer.name as queued_printer_name'
            )
            .where(whereClause)
            .orderBy('print_jobs.created_at', 'desc')
            .limit(limit)
            .offset((page - 1) * limit);

        const [{ count }] = await fastify.knex('print_jobs')
            .where(whereClause)
            .count('* as count');

        return { jobs, total: count, page, limit };
    });

    fastify.get('/:jobId', async (request, reply) => {
        const { jobId } = request.params as { jobId: string };

        const job = await fastify.knex('print_jobs')
            .leftJoin('users', 'print_jobs.user_id', 'users.id')
            .leftJoin('clients', 'print_jobs.client_id', 'clients.id')
            .leftJoin('printers', 'print_jobs.printer_id', 'printers.id')
            .select(
                'print_jobs.*',
                'users.username',
                'users.full_name',
                'clients.hostname as client_hostname',
                'printers.name as printer_name'
            )
            .where({ 'print_jobs.job_id': jobId })
            .first();

        if (!job) {
            return reply.status(404).send({ error: 'Job not found' });
        }

        const queue = await fastify.knex('queues')
            .where({ print_job_id: job.id });

        const retries = await fastify.knex('retries')
            .where({ print_job_id: job.id })
            .orderBy('created_at', 'desc');

        return { ...job, queue, retries };
    });

    fastify.post('/submit', async (request, reply) => {
        try {
            const body = submitJobSchema.parse(request.body);
            const userId = (request as any).user?.id || 1;
            const clientId = body.options?.clientId || 1;

            const result = await fastify.printRouter.submitJob({
                userId,
                clientId,
                printerId: body.printerId,
                filePath: body.filePath,
                fileName: body.fileName,
                fileType: body.fileType,
                copies: body.copies,
                options: body.options || {}
            });

            return result;
        } catch (error) {
            const message = (error as Error).message;
            return reply.status(400).send({ error: message });
        }
    });

    fastify.post('/:jobId/cancel', async (request, reply) => {
        const { jobId } = request.params as { jobId: string };

        try {
            const result = await fastify.printRouter.cancelJob(jobId);
            return result;
        } catch (error) {
            return reply.status(400).send({ error: (error as Error).message });
        }
    });

    fastify.post('/:jobId/hold', async (request, reply) => {
        const { jobId } = request.params as { jobId: string };
        try {
            const result = await fastify.printRouter.holdJob(jobId);
            return result;
        } catch (error) {
            return reply.status(400).send({ error: (error as Error).message });
        }
    });

    fastify.post('/:jobId/release', async (request, reply) => {
        const { jobId } = request.params as { jobId: string };
        try {
            const result = await fastify.printRouter.releaseJob(jobId);
            return result;
        } catch (error) {
            return reply.status(400).send({ error: (error as Error).message });
        }
    });

    fastify.post('/:jobId/retry', async (request, reply) => {
        const { jobId } = request.params as { jobId: string };

        const job = await fastify.knex('print_jobs')
            .where({ job_id: jobId })
            .first();

        if (!job) {
            return reply.status(404).send({ error: 'Job not found' });
        }

        if (job.status !== 'failed') {
            return reply.status(400).send({ error: 'Can only retry failed jobs' });
        }

        await fastify.knex('print_jobs')
            .where({ id: job.id })
            .update({ status: 'queued', attempts: 0, error_message: null });

        const { addPrintJob } = await import('../queues/index.js');
        await addPrintJob({
            jobId: job.id,
            printerId: job.printer_id,
            filePath: job.file_path,
            copies: job.copies,
            options: {}
        });

        fastify.io?.emit('job:retry', { jobId: job.job_id });

        return { success: true };
    });

    fastify.get('/stats/today', async (request, reply) => {
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const stats = await fastify.knex('print_jobs')
            .where('created_at', '>=', today)
            .select(
                fastify.knex.raw('COUNT(*) as total'),
                fastify.knex.raw("SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed"),
                fastify.knex.raw("SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed"),
                fastify.knex.raw("SUM(CASE WHEN status = 'processing' THEN 1 ELSE 0 END) as processing"),
                fastify.knex.raw('SUM(pages * copies) as total_pages')
            )
            .first();

        return stats;
    });

    fastify.get('/stats/week', async (request, reply) => {
        const weekAgo = new Date();
        weekAgo.setDate(weekAgo.getDate() - 7);

        const dailyStats = await fastify.knex('print_jobs')
            .where('created_at', '>=', weekAgo)
            .select(
                fastify.knex.raw('DATE(created_at) as date'),
                fastify.knex.raw('COUNT(*) as count'),
                fastify.knex.raw("SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed"),
                fastify.knex.raw("SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed"),
                fastify.knex.raw('SUM(pages * copies) as pages')
            )
            .groupBy(fastify.knex.raw('DATE(created_at)'))
            .orderBy('date', 'asc');

        return dailyStats;
    });
}