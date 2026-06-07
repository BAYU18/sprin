// ────────────────────────────────────────────────────────────────────────────
// TIER-1 #1: Public exports for the cleanup/archive logic so they can be
// triggered from external admin endpoints (e.g. POST /api/admin/cleanup-stuck-jobs)
// or from `node` REPL for ad-hoc operator runs.
//
// The internal scheduler in autoheal.ts still calls the same functions every
// 5 minutes automatically — this module is the "manual override" path.
// ────────────────────────────────────────────────────────────────────────────

import { logger } from '../utils/logger.js';

interface CleanupResult {
    processingCancelled: number;
    queuedCancelled: number;
    archived: number;
    alertsCreated: number;
    dryRun: boolean;
}

const STUCK_PROCESSING_MS = 10 * 60 * 1000;  // 10 min
const STUCK_QUEUED_MS     = 30 * 60 * 1000;  // 30 min
const ARCHIVE_AGE_MS      = 7 * 24 * 60 * 60 * 1000;  // 7 days

export async function runCleanupPass(fastify: any, opts: { dryRun?: boolean } = {}): Promise<CleanupResult> {
    const dryRun = !!opts.dryRun;
    const now = new Date();
    const tenMinAgo = new Date(now.getTime() - STUCK_PROCESSING_MS);
    const thirtyMinAgo = new Date(now.getTime() - STUCK_QUEUED_MS);
    const sevenDaysAgo = new Date(now.getTime() - ARCHIVE_AGE_MS);

    let processingCancelled = 0;
    let queuedCancelled = 0;
    let alertsCreated = 0;

    // 1) Stuck 'processing' jobs
    const stuckProcessing = await fastify.knex('print_jobs')
        .where('status', 'processing')
        .where('updated_at', '<', tenMinAgo)
        .select('id', 'job_id', 'printer_id', 'job_name', 'file_name', 'attempts', 'updated_at');

    for (const job of stuckProcessing) {
        if (!dryRun) {
            await fastify.knex('print_jobs')
                .where({ id: job.id })
                .update({
                    status: 'cancelled',
                    error_message: 'Auto-cancelled: stuck in processing for >10 min',
                    completed_at: now
                });
            await fastify.knex('queues')
                .where({ print_job_id: job.id })
                .whereIn('status', ['pending', 'active'])
                .update({ status: 'cancelled', updated_at: now });

            const printer = await fastify.knex('printers').where({ id: job.printer_id }).first();
            const client = printer?.client_id
                ? await fastify.knex('clients').where({ id: printer.client_id }).first()
                : null;
            await fastify.knex('alerts').insert({
                printer_id: job.printer_id,
                client_id: printer?.client_id || null,
                type: 'job_failed',
                severity: 'warning',
                title: 'Stuck Job Auto-Cancelled',
                message: `Print job "${job.job_name || job.file_name}" cancelled after being stuck in 'processing' for >10 minutes.`,
                metadata: JSON.stringify({
                    job_id: job.job_id,
                    attempts: job.attempts,
                    stuck_since: job.updated_at,
                    auto_cleanup: true,
                    node_hostname: client?.hostname || null,
                    node_ip: client?.ip_address || null
                })
            });
            alertsCreated++;
            fastify.io?.emit('job:cancelled', { jobId: job.job_id, reason: 'stuck-processing' });
        }
        processingCancelled++;
    }

    // 2) Stuck 'queued' jobs
    const stuckQueued = await fastify.knex('print_jobs')
        .where('status', 'queued')
        .where('created_at', '<', thirtyMinAgo)
        .select('id', 'job_id', 'printer_id', 'job_name', 'file_name', 'created_at');

    for (const job of stuckQueued) {
        if (!dryRun) {
            await fastify.knex('print_jobs')
                .where({ id: job.id })
                .update({
                    status: 'cancelled',
                    error_message: 'Auto-cancelled: queued for >30 min (printer unreachable)',
                    completed_at: now
                });
            await fastify.knex('queues')
                .where({ print_job_id: job.id })
                .whereIn('status', ['pending', 'active'])
                .update({ status: 'cancelled', updated_at: now });

            const printer = await fastify.knex('printers').where({ id: job.printer_id }).first();
            await fastify.knex('alerts').insert({
                printer_id: job.printer_id,
                client_id: printer?.client_id || null,
                type: 'job_failed',
                severity: 'warning',
                title: 'Queued Job Auto-Cancelled',
                message: `Print job "${job.job_name || job.file_name}" cancelled after being queued for >30 min.`,
                metadata: JSON.stringify({
                    job_id: job.job_id,
                    queued_since: job.created_at,
                    auto_cleanup: true
                })
            });
            alertsCreated++;
            fastify.io?.emit('job:cancelled', { jobId: job.job_id, reason: 'stuck-queued' });
        }
        queuedCancelled++;
    }

    // 3) Archive old jobs
    const oldJobs = await fastify.knex('print_jobs')
        .whereIn('status', ['completed', 'failed', 'cancelled'])
        .where('created_at', '<', sevenDaysAgo)
        .select('*');

    let archived = 0;
    if (oldJobs.length > 0 && !dryRun) {
        const hasArchive = await fastify.knex.schema.hasTable('print_jobs_archive').catch(() => false);
        if (hasArchive) {
            await fastify.knex.transaction(async (trx: any) => {
                await trx('print_jobs_archive').insert(oldJobs);
                await trx('print_jobs')
                    .whereIn('id', oldJobs.map((j: any) => j.id))
                    .del();
            });
            archived = oldJobs.length;
        } else {
            archived = await fastify.knex('print_jobs')
                .whereIn('id', oldJobs.map((j: any) => j.id))
                .del();
        }
    } else if (oldJobs.length > 0 && dryRun) {
        archived = oldJobs.length;
    }

    logger.info(
        `[AutoHeal] cleanupStuckJobs: ${processingCancelled} processing + ${queuedCancelled} queued cancelled, ` +
        `archiveOldJobs: ${archived} jobs (dryRun=${dryRun})`
    );

    return {
        processingCancelled,
        queuedCancelled,
        archived,
        alertsCreated,
        dryRun
    };
}
