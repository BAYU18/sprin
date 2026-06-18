import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { cache } from '../utils/cache.js';

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

        // Build a cache key from all query params so different filters get separate cache entries
        const cacheKey = `jobs:list:${JSON.stringify({ page, limit, status, userId, clientId, printerId })}`;

        return await cache.getOrSet(cacheKey, 30, async () => {
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
    });

    fastify.get('/:jobId', async (request, reply) => {
        const { jobId } = request.params as { jobId: string };

        // ── Core job + join lookup (kept compatible with old payload) ──────
        const job = await fastify.knex('print_jobs')
            .leftJoin('users', 'print_jobs.user_id', 'users.id')
            .leftJoin('clients', 'print_jobs.client_id', 'clients.id')
            .leftJoin('printers', 'print_jobs.printer_id', 'printers.id')
            .select(
                'print_jobs.*',
                'users.username',
                'users.full_name',
                'users.department',
                'clients.hostname as client_hostname',
                'printers.name as printer_name',
                'printers.slug as printer_slug',
                'printers.status as printer_status',
                'printers.type as printer_type',
                'printers.driver_id as printer_driver_id'
            )
            .where({ 'print_jobs.job_id': jobId })
            .first();

        if (!job) {
            return reply.status(404).send({ error: 'Job not found' });
        }

        const queue = await fastify.knex('queues')
            .where({ print_job_id: job.id });

        // ── Attempts history with the printer snapshot used for each retry ──
        // Newest first (dashboard reads top-down), but we expose
        // attempts_history ASC by attempt_number for clean timeline rendering.
        const attemptsRaw = await fastify.knex('retries')
            .leftJoin('printers as rp', 'retries.printer_id', 'rp.id')
            .where({ 'retries.print_job_id': job.id })
            .select(
                'retries.id',
                'retries.print_job_id',
                'retries.printer_id',
                'retries.reason',
                'retries.status',
                'retries.attempt_number',
                'retries.error_message',
                'retries.started_at',
                'retries.completed_at',
                'retries.created_at',
                'retries.updated_at',
                'rp.name as printer_name',
                'rp.slug as printer_slug',
                'rp.status as printer_status',
                'rp.type as printer_type'
            )
            .orderBy('retries.attempt_number', 'asc');

        const attemptsHistory = attemptsRaw.map((a: any) => {
            let durationMs: number | null = null;
            if (a.started_at && a.completed_at) {
                durationMs = new Date(a.completed_at).getTime() - new Date(a.started_at).getTime();
            }
            return {
                id: a.id,
                attempt_number: a.attempt_number,
                status: a.status,
                reason: a.reason,
                error_message: a.error_message,
                started_at: a.started_at,
                completed_at: a.completed_at,
                created_at: a.created_at,
                updated_at: a.updated_at,
                duration_ms: durationMs,
                printer: a.printer_id ? {
                    id: a.printer_id,
                    name: a.printer_name,
                    slug: a.printer_slug,
                    status: a.printer_status,
                    type: a.printer_type,
                } : null,
            };
        });

        // `retries` field — legacy array of raw rows, newest first, for
        // any consumer still depending on the old shape.
        const retries = [...attemptsRaw].sort((a: any, b: any) => {
            const ta = a.created_at ? new Date(a.created_at).getTime() : 0;
            const tb = b.created_at ? new Date(b.created_at).getTime() : 0;
            return tb - ta;
        });

        // ── Synthesise a chronological event timeline from existing fields ──
        // We never had a dedicated job_events table; instead we derive one
        // from the canonical timestamps already on the job + each retry row.
        type Evt = { timestamp: string; type: string; message: string; meta?: Record<string, any> };
        const events: Evt[] = [];

        if (job.created_at) {
            events.push({
                timestamp: job.created_at,
                type: 'queued',
                message: `Job submitted to queue (${job.file_name || job.job_name || 'print job'})`,
                meta: { file_name: job.file_name, copies: job.copies, pages: job.pages },
            });
        }

        for (const a of attemptsHistory) {
            const ts = a.started_at || a.created_at;
            if (!ts) continue;
            const printerLabel = a.printer?.name || (a.printer_id ? `Printer #${a.printer_id}` : 'unknown printer');
            events.push({
                timestamp: ts,
                type: 'retry_attempt',
                message: `Retry attempt #${a.attempt_number ?? '?'} on ${printerLabel}`,
                meta: {
                    retry_id: a.id,
                    attempt_number: a.attempt_number,
                    reason: a.reason,
                    error_message: a.error_message,
                    printer_id: a.printer_id,
                    printer_name: a.printer?.name,
                },
            });
            if (a.completed_at && a.started_at) {
                events.push({
                    timestamp: a.completed_at,
                    type: a.status === 'failed' ? 'attempt_failed' : 'attempt_succeeded',
                    message: a.status === 'failed'
                        ? `Attempt #${a.attempt_number} failed: ${a.error_message || a.reason || 'unknown error'}`
                        : `Attempt #${a.attempt_number} completed on ${printerLabel}`,
                    meta: { retry_id: a.id, attempt_number: a.attempt_number, status: a.status },
                });
            }
        }

        if (job.started_at) {
            events.push({
                timestamp: job.started_at,
                type: 'processing',
                message: `Print job started on ${job.printer_name || 'printer'}`,
                meta: { printer_id: job.printer_id, printer_name: job.printer_name },
            });
        }
        if (job.completed_at && (job.status === 'completed' || job.status === 'cancelled' || job.status === 'failed')) {
            events.push({
                timestamp: job.completed_at,
                type: job.status,
                message: job.status === 'completed'
                    ? `Job completed on ${job.printer_name || 'printer'}`
                    : job.status === 'cancelled'
                        ? 'Job was cancelled by user'
                        : `Job failed: ${job.error_message || 'unknown error'}`,
                meta: { status: job.status, error_message: job.error_message },
            });
        }
        if (job.updated_at && job.status === 'failed' && !job.completed_at) {
            events.push({
                timestamp: job.updated_at,
                type: 'failed',
                message: `Job failed: ${job.error_message || 'unknown error'}`,
                meta: { status: job.status, error_message: job.error_message },
            });
        }

        // Sort the entire timeline chronologically. Nulls land at the end.
        events.sort((a, b) => {
            const ta = a.timestamp ? new Date(a.timestamp).getTime() : Number.POSITIVE_INFINITY;
            const tb = b.timestamp ? new Date(b.timestamp).getTime() : Number.POSITIVE_INFINITY;
            return ta - tb;
        });

        // ── Printer + user nested detail objects (richer than flat fields) ──
        const printerDetails = job.printer_id ? {
            id: job.printer_id,
            name: job.printer_name,
            slug: job.printer_slug,
            status: job.printer_status,
            type: job.printer_type,
            driver_id: job.printer_driver_id,
        } : null;

        const userDetails = job.user_id ? {
            id: job.user_id,
            username: job.username,
            full_name: job.full_name,
            department: job.department,
        } : null;

        // ── Final payload: keep every existing field for back-compat ──
        return {
            ...job,
            queue,
            retries,
            // New richer fields
            events,
            attempts_history: attemptsHistory,
            printer_details: printerDetails,
            user_details: userDetails,
        };
    });

    fastify.post('/submit', async (request, reply) => {
        try {
            const body = submitJobSchema.parse(request.body);
            const userId = (request as any).user?.id || 1;
            const clientId = body.options?.clientId || 1;
            const copies = body.copies || 1;

            // Quota enforcement: check user's monthly page quota before submitting
            const userRow = await fastify.knex('users')
                .select('quota_pages', 'quota_used', 'username', 'is_active')
                .where({ id: userId })
                .first();

            if (userRow) {
                if (userRow.is_active === false) {
                    return reply.status(403).send({
                        error: 'Account disabled',
                        message: `User "${userRow.username}" is inactive. Contact administrator.`
                    });
                }
                const quotaPages = userRow.quota_pages ?? 1000;
                const quotaUsed = userRow.quota_used ?? 0;
                if (quotaUsed + copies > quotaPages) {
                    return reply.status(429).send({
                        error: 'Quota exceeded',
                        message: `User "${userRow.username}" has used ${quotaUsed}/${quotaPages} pages. This job needs ${copies} more. Quota exceeded.`,
                        quota_pages: quotaPages,
                        quota_used: quotaUsed,
                        requested: copies
                    });
                }
            }

            const result = await fastify.printRouter.submitJob({
                userId,
                clientId,
                printerId: body.printerId,
                filePath: body.filePath,
                fileName: body.fileName,
                fileType: body.fileType,
                copies,
                options: body.options || {},
                sourceIp: request.ip || request.socket?.remoteAddress || '',
            });

            // Increment quota_used for this user
            if (userRow) {
                await fastify.knex('users')
                    .where({ id: userId })
                    .increment('quota_used', copies);
            }

            // Invalidate jobs list and stats caches
            await cache.invalidate('jobs:*');

            return result;
        } catch (error) {
            const message = (error as Error).message;
            return reply.status(400).send({ error: message });
        }
    });

    fastify.post('/:jobId/cancel', async (request, reply) => {
        const { jobId } = request.params as { jobId: string };

        try {
            // Look up job to refund quota if not yet completed
            const job = await fastify.knex('print_jobs')
                .where({ job_id: jobId })
                .select('id', 'user_id', 'status', 'copies')
                .first();
            const result = await fastify.printRouter.cancelJob(jobId);
            // Refund quota if job was cancelled before completion
            if (job && job.user_id && job.status !== 'completed') {
                await fastify.knex('users')
                    .where({ id: job.user_id })
                    .decrement('quota_used', job.copies || 1);
            }
            // Invalidate jobs list and stats caches
            await cache.invalidate('jobs:*');
            return result;
        } catch (error) {
            return reply.status(400).send({ error: (error as Error).message });
        }
    });

    fastify.post('/:jobId/hold', async (request, reply) => {
        const { jobId } = request.params as { jobId: string };
        try {
            const result = await fastify.printRouter.holdJob(jobId);
            // Invalidate jobs list cache
            await cache.invalidate('jobs:*');
            return result;
        } catch (error) {
            return reply.status(400).send({ error: (error as Error).message });
        }
    });

    fastify.post('/:jobId/release', async (request, reply) => {
        const { jobId } = request.params as { jobId: string };
        try {
            const result = await fastify.printRouter.releaseJob(jobId);
            // Invalidate jobs list cache
            await cache.invalidate('jobs:*');
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

        // Invalidate jobs list and stats caches
        await cache.invalidate('jobs:*');

        return { success: true };
    });

    // ─── Reprint ────────────────────────────────────────────────────────────
    // Creates a NEW job clone of an existing (completed/failed/cancelled) job.
    // Different from retry: retry re-queues the same row; reprint inserts a new one.
    fastify.post('/:jobId/reprint', async (request, reply) => {
        const { jobId } = request.params as { jobId: string };

        const job = await fastify.knex('print_jobs')
            .where({ job_id: jobId })
            .first();

        if (!job) {
            return reply.status(404).send({ error: 'Job not found' });
        }

        // Generate a new job_id for the clone
        const crypto = await import('crypto');
        const newJobId = crypto.randomUUID();

        const [cloned] = await fastify.knex('print_jobs')
            .insert({
                job_id: newJobId,
                user_id: job.user_id,
                client_id: job.client_id,
                printer_id: job.printer_id,
                file_path: job.file_path,
                file_name: job.file_name,
                file_type: job.file_type,
                copies: job.copies || 1,
                pages: job.pages || 0,
                job_name: job.job_name || job.file_name,
                status: 'queued',
                attempts: 0,
                source_app: 'reprint',
                source_ip: request.ip || request.socket?.remoteAddress || '',
                paper_size: job.paper_size || 'Default',
            })
            .returning('*');

        const { addPrintJob } = await import('../queues/index.js');
        await addPrintJob({
            jobId: cloned.id,
            printerId: cloned.printer_id,
            filePath: cloned.file_path,
            copies: cloned.copies,
            options: {}
        });

        fastify.io?.emit('job:new', { jobId: newJobId });
        await cache.invalidate('jobs:*');

        return { success: true, jobId: newJobId };
    });

    // ─── Dead-Letter Queue (DLQ) ──────────────────────────────────────────
    // Jobs that exhausted all auto-retries + failover end up status='failed'.
    // These endpoints give a central place to inspect, bulk-requeue, or discard
    // them so a stuck job never gets silently lost.

    // List permanently-failed jobs with their retry audit trail
    fastify.get('/dead-letter', async (request, reply) => {
        const q = z.object({
            page: z.coerce.number().default(1),
            limit: z.coerce.number().default(50),
        }).parse(request.query);
        const offset = (q.page - 1) * q.limit;

        const baseQuery = fastify.knex('print_jobs')
            .where('print_jobs.status', 'failed');

        const [{ count }] = await baseQuery.clone().count({ count: '*' });

        const jobs = await baseQuery.clone()
            .leftJoin('printers', 'print_jobs.printer_id', 'printers.id')
            .leftJoin('users', 'print_jobs.user_id', 'users.id')
            .select(
                'print_jobs.id',
                'print_jobs.job_id',
                'print_jobs.file_name',
                'print_jobs.status',
                'print_jobs.attempts',
                'print_jobs.error_message',
                'print_jobs.copies',
                'print_jobs.created_at',
                'print_jobs.updated_at',
                'printers.name as printer_name',
                'users.username as user_name'
            )
            .orderBy('print_jobs.updated_at', 'desc')
            .limit(q.limit)
            .offset(offset);

        // Attach the retry history for each job (best-effort — table may be empty)
        const ids = jobs.map((j: any) => j.id);
        let retriesByJob: Record<number, any[]> = {};
        if (ids.length > 0) {
            const retries = await fastify.knex('retries')
                .whereIn('print_job_id', ids)
                .select('print_job_id', 'attempt_number', 'status', 'error_message', 'created_at')
                .orderBy('attempt_number', 'asc')
                .catch(() => []);
            for (const r of retries) {
                (retriesByJob[r.print_job_id] ||= []).push(r);
            }
        }
        const jobsWithRetries = jobs.map((j: any) => ({ ...j, retries: retriesByJob[j.id] || [] }));

        return {
            jobs: jobsWithRetries,
            total: Number(count),
            page: q.page,
            limit: q.limit,
        };
    });

    // Bulk requeue: reset failed jobs back to 'queued' and re-add to the print queue.
    // Pass { jobIds: ["abc","def"] } to target specific jobs, or omit to requeue ALL failed.
    fastify.post('/dead-letter/requeue', async (request, reply) => {
        const body = z.object({
            jobIds: z.array(z.string()).optional(),
        }).parse(request.body || {});

        let query = fastify.knex('print_jobs').where({ status: 'failed' });
        if (body.jobIds && body.jobIds.length > 0) {
            query = query.whereIn('job_id', body.jobIds);
        }
        const failedJobs = await query.select(
            'id', 'job_id', 'printer_id', 'file_path', 'copies'
        );

        if (failedJobs.length === 0) {
            return { success: true, requeued: 0, message: 'No failed jobs to requeue' };
        }

        const { addPrintJob } = await import('../queues/index.js');
        let requeued = 0;
        for (const job of failedJobs) {
            await fastify.knex('print_jobs')
                .where({ id: job.id })
                .update({ status: 'queued', attempts: 0, error_message: null, updated_at: new Date() });

            await addPrintJob({
                jobId: job.id,
                printerId: job.printer_id,
                filePath: job.file_path,
                copies: job.copies,
                options: {}
            });
            fastify.io?.emit('job:retry', { jobId: job.job_id });
            requeued++;
        }

        await cache.invalidate('jobs:*');
        fastify.io?.emit('deadletter:changed', { requeued });

        return { success: true, requeued };
    });

    // Discard (purge) failed jobs from the dead-letter view by marking them cancelled.
    // Pass { jobIds: [...] } to target specific jobs, or omit to discard ALL failed.
    fastify.post('/dead-letter/discard', async (request, reply) => {
        const body = z.object({
            jobIds: z.array(z.string()).optional(),
        }).parse(request.body || {});

        let query = fastify.knex('print_jobs').where({ status: 'failed' });
        if (body.jobIds && body.jobIds.length > 0) {
            query = query.whereIn('job_id', body.jobIds);
        }

        const discarded = await query.update({
            status: 'cancelled',
            error_message: fastify.knex.raw("COALESCE(error_message, '') || ' [discarded from dead-letter]'"),
            updated_at: new Date()
        });

        await cache.invalidate('jobs:*');
        fastify.io?.emit('deadletter:changed', { discarded });

        return { success: true, discarded };
    });

    fastify.get('/stats/today', async (request, reply) => {
        return await cache.getOrSet('jobs:stats:today', 30, async () => {
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
    });

    fastify.get('/stats/week', async (request, reply) => {
        return await cache.getOrSet('jobs:stats:week', 30, async () => {
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
    });
}