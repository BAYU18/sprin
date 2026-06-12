/**
 * PrintServer Pro - Queue Management Routes (TIER-2 #8)
 *
 * Adds queue-management endpoints on top of the existing BullMQ-backed
 * `queues` and `print_jobs` tables. We keep the existing
 * `GET /api/queues/stats` and `POST /api/queues/clean-failed` routes inside
 * `routes/index.ts` untouched; this module is mounted at the same
 * `/api/queues` prefix and Fastify dispatches by HTTP method+path, so they
 * don't conflict.
 *
 * All routes here are registered inside the JWT-protected `/api` instance
 * (see setupRoutes in routes/index.ts) so they require a valid token.
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { logger } from '../utils/logger.js';

// ── Zod schemas ──────────────────────────────────────────────────────────────

const listQuerySchema = z.object({
    printer_id: z.coerce.number().int().positive().optional(),
    status: z.enum(['waiting', 'processing', 'paused', 'held', 'queued', 'completed', 'failed', 'cancelled']).optional(),
    user_id: z.coerce.number().int().positive().optional(),
    limit: z.coerce.number().int().min(1).max(500).default(100),
    offset: z.coerce.number().int().min(0).default(0),
});

const reorderSchema = z.object({
    new_position: z.coerce.number().int().min(0),
});

// ── Helpers ──────────────────────────────────────────────────────────────────

interface QueueRow {
    id: number;
    print_job_id: number;
    printer_id: number;
    position: number;
    status: string;
    scheduled_at: string | null;
    started_at: string | null;
    completed_at: string | null;
    created_at: string;
    updated_at: string;
    job_id: string;
    file_name: string | null;
    job_name: string | null;
    pages: number | null;
    copies: number;
    job_status: string;
    user_id: number | null;
    username: string | null;
    full_name: string | null;
    printer_name: string | null;
}

/**
 * Map a queues-table row + joins into a single, predictable payload the
 * dashboard can render without a second round-trip.
 */
function shapeQueueRow(r: any): QueueRow {
    return {
        id: r.id,
        print_job_id: r.print_job_id,
        printer_id: r.printer_id,
        position: r.position,
        status: r.status,
        scheduled_at: r.scheduled_at,
        started_at: r.started_at,
        completed_at: r.completed_at,
        created_at: r.created_at,
        updated_at: r.updated_at,
        // joined from print_jobs
        job_id: r.job_id,
        file_name: r.file_name,
        job_name: r.job_name,
        pages: r.pages,
        copies: r.copies,
        job_status: r.job_status,
        // joined from users
        user_id: r.user_id,
        username: r.username,
        full_name: r.full_name,
        // joined from printers
        printer_name: r.printer_name,
    };
}

/**
 * Recompute the `position` field for every waiting/queued queue row of a
 * given printer, ordered by `created_at ASC`. Used after a reorder so the
 * column stays consistent and we don't end up with two jobs at the same
 * position or a hole.
 */
async function renumberQueue(fastify: FastifyInstance, printerId: number) {
    // Pull every "active" (i.e., not-yet-completed) queue row in order.
    const rows = await fastify.knex('queues')
        .leftJoin('print_jobs', 'queues.print_job_id', 'print_jobs.id')
        .where('queues.printer_id', printerId)
        .whereIn('queues.status', ['waiting', 'queued', 'held', 'paused'])
        .orderBy('queues.created_at', 'asc')
        .select('queues.id', 'queues.created_at');

    // Walk the rows in order, set position = index.
    for (let i = 0; i < rows.length; i++) {
        await fastify.knex('queues')
            .where({ id: rows[i].id })
            .update({ position: i, updated_at: fastify.knex.fn.now() });
    }
}

/**
 * Best-effort ETA in seconds. BullMQ gives us `getDelayed()` for scheduled
 * jobs but not per-job runtimes. We approximate by averaging the time
 * between started_at and completed_at for the last 20 completed jobs for
 * this printer, then multiply by `waiting + active`. If we have no history
 * we fall back to 30 seconds per queued job — a deliberately conservative
 * underestimate so the UI never claims a "0s" wait.
 */
async function computeEtaSeconds(fastify: FastifyInstance, printerId: number, waiting: number, active: number): Promise<number> {
    const stats = await fastify.knex('print_jobs')
        .where('printer_id', printerId)
        .where('status', 'completed')
        .whereNotNull('started_at')
        .whereNotNull('completed_at')
        .orderBy('completed_at', 'desc')
        .limit(20)
        .select('started_at', 'completed_at');

    let avgPerJob = 30; // conservative fallback
    if (stats.length > 0) {
        const total = stats.reduce((acc: number, s: any) => {
            const start = new Date(s.started_at).getTime();
            const end = new Date(s.completed_at).getTime();
            return acc + Math.max(0, end - start);
        }, 0);
        avgPerJob = Math.max(5, Math.round(total / stats.length / 1000));
    }

    return Math.round(avgPerJob * (waiting + active));
}

// ── Route registration ──────────────────────────────────────────────────────

export async function setupQueueMgmtRoutes(fastify: FastifyInstance) {

    // ── GET /api/queues — global queue listing with filters ──────────────────
    fastify.get('/queues', async (request: FastifyRequest, reply: FastifyReply) => {
        try {
            const q = listQuerySchema.parse(request.query || {});

            const cacheKey = `queues:list:${JSON.stringify(q)}`;
            const { cache } = await import('../utils/cache.js');
            return await cache.getOrSet(cacheKey, 10, async () => {
                const base = fastify.knex('queues')
                    .leftJoin('print_jobs', 'queues.print_job_id', 'print_jobs.id')
                    .leftJoin('users', 'print_jobs.user_id', 'users.id')
                    .leftJoin('printers', 'queues.printer_id', 'printers.id');

                if (q.printer_id) base.where('queues.printer_id', q.printer_id);
                if (q.status) base.where('queues.status', q.status);
                if (q.user_id) base.where('print_jobs.user_id', q.user_id);

                const [{ count }] = await base.clone().count({ count: '*' });

                const rows = await base
                    .select(
                        'queues.*',
                        'print_jobs.job_id',
                        'print_jobs.file_name',
                        'print_jobs.job_name',
                        'print_jobs.pages',
                        'print_jobs.copies',
                        'print_jobs.status as job_status',
                        'print_jobs.user_id',
                        'users.username',
                        'users.full_name',
                        'printers.name as printer_name'
                    )
                    // Show waiting/queued first, then by position, then by age.
                    .orderBy([
                        { column: 'queues.position', order: 'asc' },
                        { column: 'queues.created_at', order: 'asc' },
                    ])
                    .limit(q.limit)
                    .offset(q.offset);

                return {
                    queues: rows.map(shapeQueueRow),
                    total: Number(count),
                    limit: q.limit,
                    offset: q.offset,
                };
            });
        } catch (err) {
            logger.error(`[queue-mgmt] GET /queues failed: ${(err as Error).message}`);
            return reply.status(400).send({ error: (err as Error).message });
        }
    });

    // ── GET /api/queues/printer/:printerId — printer-specific queue ─────────
    fastify.get<{ Params: { printerId: string } }>('/queues/printer/:printerId', async (request, reply) => {
        const printerId = Number(request.params.printerId);
        if (!Number.isFinite(printerId) || printerId <= 0) {
            return reply.status(400).send({ error: 'Invalid printerId' });
        }
        try {
            const printer = await fastify.knex('printers').where({ id: printerId }).first('id', 'name', 'is_paused', 'status');
            if (!printer) {
                return reply.status(404).send({ error: 'Printer not found' });
            }

            const rows = await fastify.knex('queues')
                .leftJoin('print_jobs', 'queues.print_job_id', 'print_jobs.id')
                .leftJoin('users', 'print_jobs.user_id', 'users.id')
                .where('queues.printer_id', printerId)
                .whereIn('queues.status', ['waiting', 'queued', 'paused', 'held', 'processing'])
                .select(
                    'queues.*',
                    'print_jobs.job_id',
                    'print_jobs.file_name',
                    'print_jobs.job_name',
                    'print_jobs.pages',
                    'print_jobs.copies',
                    'print_jobs.status as job_status',
                    'print_jobs.user_id',
                    'users.username',
                    'users.full_name'
                )
                .orderBy([
                    { column: 'queues.position', order: 'asc' },
                    { column: 'queues.created_at', order: 'asc' },
                ]);

            return {
                printer: {
                    id: printer.id,
                    name: printer.name,
                    status: printer.status,
                    is_paused: !!printer.is_paused,
                },
                queue: rows.map(shapeQueueRow),
                count: rows.length,
            };
        } catch (err) {
            logger.error(`[queue-mgmt] GET /queues/printer/:id failed: ${(err as Error).message}`);
            return reply.status(500).send({ error: (err as Error).message });
        }
    });

    // ── POST /api/queues/:queueId/reorder — change a single queue row's slot
    // Body: { new_position: number }
    // Strategy: clamp new_position, swap the affected rows, then renumber
    // the whole printer's queue so positions stay contiguous. ───────────────
    fastify.post<{ Params: { queueId: string } }>('/queues/:queueId/reorder', async (request, reply) => {
        const queueId = Number(request.params.queueId);
        if (!Number.isFinite(queueId) || queueId <= 0) {
            return reply.status(400).send({ error: 'Invalid queueId' });
        }
        try {
            const body = reorderSchema.parse(request.body || {});
            const row = await fastify.knex('queues').where({ id: queueId }).first();
            if (!row) {
                return reply.status(404).send({ error: 'Queue row not found' });
            }
            if (['completed', 'failed', 'cancelled'].includes(row.status)) {
                return reply.status(400).send({ error: `Cannot reorder a ${row.status} job` });
            }

            // Get siblings, then re-sort and renumber.
            const siblings = await fastify.knex('queues')
                .where('printer_id', row.printer_id)
                .whereIn('status', ['waiting', 'queued', 'paused', 'held'])
                .orderBy('position', 'asc')
                .orderBy('created_at', 'asc')
                .select('id');

            // Remove the target from its current slot and re-insert at new_position.
            const ids = siblings.map((s: any) => s.id);
            const filtered = ids.filter((id: number) => id !== queueId);
            const newPos = Math.max(0, Math.min(body.new_position, filtered.length));
            filtered.splice(newPos, 0, queueId);

            // Apply positions one row at a time (small N, low contention).
            for (let i = 0; i < filtered.length; i++) {
                await fastify.knex('queues')
                    .where({ id: filtered[i] })
                    .update({ position: i, updated_at: fastify.knex.fn.now() });
            }

            // Best-effort: also try to reorder within BullMQ (job priority).
            // We do this by re-adding with priority. It's not always possible
            // (a job in the middle of `active` state cannot be moved), so we
            // catch and log rather than fail the whole request.
            try {
                const { printQueue } = await import('../queues/index.js');
                const job = await fastify.knex('print_jobs').where({ id: row.print_job_id }).first();
                if (job) {
                    // BullMQ doesn't have a stable "move to position" API, so we
                    // change priority — higher priority value = earlier in the
                    // queue. We invert the position so position 0 = highest.
                    const maxPrio = filtered.length;
                    const newPrio = maxPrio - newPos;
                    const bullJob = await printQueue.getJob(job.job_id).catch(() => null);
                    if (bullJob) {
                        await bullJob.changePriority(newPrio).catch((e: any) => {
                            logger.warn(`[queue-mgmt] changePriority failed: ${e.message}`);
                        });
                    }
                }
            } catch (e: any) {
                logger.warn(`[queue-mgmt] BullMQ reorder best-effort failed: ${e.message}`);
            }

            // Notify the world. Dashboard subscribers can refresh.
            fastify.io?.emit('queue:updated', {
                printerId: row.printer_id,
                queueId,
                newPosition: newPos,
            });

            return { success: true, queueId, newPosition: newPos };
        } catch (err) {
            const msg = (err as Error).message;
            logger.error(`[queue-mgmt] POST /queues/:id/reorder failed: ${msg}`);
            return reply.status(400).send({ error: msg });
        }
    });

    // ── POST /api/queues/printer/:printerId/pause — pause this printer ────
    fastify.post<{ Params: { printerId: string } }>('/queues/printer/:printerId/pause', async (request, reply) => {
        const printerId = Number(request.params.printerId);
        if (!Number.isFinite(printerId) || printerId <= 0) {
            return reply.status(400).send({ error: 'Invalid printerId' });
        }
        try {
            const printer = await fastify.knex('printers').where({ id: printerId }).first();
            if (!printer) {
                return reply.status(404).send({ error: 'Printer not found' });
            }

            // 1. Flip the durable DB flag so the printer-engine and any
            //    cross-restart logic can see it.
            await fastify.knex('printers')
                .where({ id: printerId })
                .update({ is_paused: true, updated_at: fastify.knex.fn.now() });

            // 2. Pause BullMQ at the queue level so no new jobs are picked up.
            //    Per-printer filtering isn't possible with a single global
            //    printQueue, so we mark *every* still-pending queue row for
            //    this printer as "paused" — the worker checks this and will
            //    bail out before dispatching. New jobs in the same queue are
            //    also stuck because the global queue is paused; we resume
            //    both when /resume is called.
            try {
                const { printQueue } = await import('../queues/index.js');
                await printQueue.pause().catch((e: any) => {
                    logger.warn(`[queue-mgmt] BullMQ pause failed: ${e.message}`);
                });
            } catch (e: any) {
                logger.warn(`[queue-mgmt] Could not access printQueue: ${e.message}`);
            }

            // 3. Mark every queued/waiting queue row for this printer as paused
            //    so the UI sees a consistent "paused" state for every job.
            await fastify.knex('queues')
                .where('printer_id', printerId)
                .whereIn('status', ['waiting', 'queued'])
                .update({ status: 'paused', updated_at: fastify.knex.fn.now() });

            // 4. Notify all connected clients.
            fastify.io?.emit('queue:paused', { printerId });
            fastify.io?.emit('queue:updated', { printerId, paused: true });

            logger.info(`[queue-mgmt] Printer ${printerId} (${printer.name}) queue paused`);
            return { success: true, printerId, isPaused: true };
        } catch (err) {
            logger.error(`[queue-mgmt] pause failed: ${(err as Error).message}`);
            return reply.status(500).send({ error: (err as Error).message });
        }
    });

    // ── POST /api/queues/printer/:printerId/resume ────────────────────────
    fastify.post<{ Params: { printerId: string } }>('/queues/printer/:printerId/resume', async (request, reply) => {
        const printerId = Number(request.params.printerId);
        if (!Number.isFinite(printerId) || printerId <= 0) {
            return reply.status(400).send({ error: 'Invalid printerId' });
        }
        try {
            const printer = await fastify.knex('printers').where({ id: printerId }).first();
            if (!printer) {
                return reply.status(404).send({ error: 'Printer not found' });
            }

            await fastify.knex('printers')
                .where({ id: printerId })
                .update({ is_paused: false, updated_at: fastify.knex.fn.now() });

            try {
                const { printQueue } = await import('../queues/index.js');
                await printQueue.resume().catch((e: any) => {
                    logger.warn(`[queue-mgmt] BullMQ resume failed: ${e.message}`);
                });
            } catch (e: any) {
                logger.warn(`[queue-mgmt] Could not access printQueue: ${e.message}`);
            }

            // Move paused rows back to waiting so the worker picks them up.
            await fastify.knex('queues')
                .where('printer_id', printerId)
                .where('status', 'paused')
                .update({ status: 'waiting', updated_at: fastify.knex.fn.now() });

            fastify.io?.emit('queue:resumed', { printerId });
            fastify.io?.emit('queue:updated', { printerId, paused: false });

            logger.info(`[queue-mgmt] Printer ${printerId} (${printer.name}) queue resumed`);
            return { success: true, printerId, isPaused: false };
        } catch (err) {
            logger.error(`[queue-mgmt] resume failed: ${(err as Error).message}`);
            return reply.status(500).send({ error: (err as Error).message });
        }
    });

    // ── GET /api/queues/printer/:printerId/status — health/status snapshot ─
    fastify.get<{ Params: { printerId: string } }>('/queues/printer/:printerId/status', async (request, reply) => {
        const printerId = Number(request.params.printerId);
        if (!Number.isFinite(printerId) || printerId <= 0) {
            return reply.status(400).send({ error: 'Invalid printerId' });
        }
        try {
            const printer = await fastify.knex('printers')
                .where({ id: printerId })
                .first('id', 'name', 'status', 'is_paused');
            if (!printer) {
                return reply.status(404).send({ error: 'Printer not found' });
            }

            // Aggregate counts straight from the queues table.
            const rows = await fastify.knex('queues')
                .where('printer_id', printerId)
                .select('status')
                .count('* as count')
                .groupBy('status');

            const counts: Record<string, number> = { waiting: 0, active: 0, scheduled: 0, paused: 0, held: 0, completed: 0, failed: 0, cancelled: 0 };
            for (const r of rows) {
                const k = (r.status || 'unknown') as string;
                if (k === 'queued') counts.waiting += Number(r.count);
                else if (k === 'processing') counts.active += Number(r.count);
                else if (k === 'paused') counts.paused += Number(r.count);
                else if (k === 'held') counts.held += Number(r.count);
                else if (k === 'scheduled' || k === 'delayed') counts.scheduled += Number(r.count);
                else counts[k] = (counts[k] || 0) + Number(r.count);
            }

            // Pull top-of-queue position (the lowest position across waiting).
            const head = await fastify.knex('queues')
                .where('printer_id', printerId)
                .whereIn('status', ['waiting', 'queued'])
                .orderBy('position', 'asc')
                .first('position');
            const position = head ? Number(head.position) : 0;

            // Pull BullMQ's global paused state (single shared queue).
            let bullPaused = false;
            try {
                const { printQueue } = await import('../queues/index.js');
                bullPaused = await printQueue.isPaused().catch(() => false);
            } catch { /* not fatal */ }

            const eta_seconds = await computeEtaSeconds(fastify, printerId, counts.waiting, counts.active);

            return {
                printerId,
                printerName: printer.name,
                status: printer.status,
                isPaused: !!printer.is_paused,
                bullPaused,
                position,
                waiting: counts.waiting,
                active: counts.active,
                scheduled: counts.scheduled,
                paused: counts.paused,
                held: counts.held,
                eta_seconds,
                timestamp: new Date().toISOString(),
            };
        } catch (err) {
            logger.error(`[queue-mgmt] status failed: ${(err as Error).message}`);
            return reply.status(500).send({ error: (err as Error).message });
        }
    });
}
