import { logger } from '../utils/logger.js';

export async function autoHealScheduler(fastify: any) {
    const safeRun = async (name: string, fn: () => Promise<void>) => {
        try {
            await fn();
        } catch (err) {
            logger.error(`[AutoHeal] ${name} crashed: ${(err as Error)?.message || err}`);
        }
    };

    setInterval(async () => {
        await safeRun('checkStuckJobs', () => checkStuckJobs(fastify));
        await safeRun('checkOfflinePrinters', () => checkOfflinePrinters(fastify));
        await safeRun('checkFailedRetries', () => checkFailedRetries(fastify));
        await safeRun('checkQueueHealth', () => checkQueueHealth(fastify));
    }, 60000);

    // Run once at startup (after short delay) so offline printers get cleared
    // quickly on fresh boot instead of waiting for first interval tick
    setTimeout(() => {
        safeRun('initial-autoClearOffline', () => autoClearOfflinePrinters(fastify));
    }, 10000);

    // Unhandled rejection safety net: never let AutoHeal errors kill the process
    process.on('unhandledRejection', (reason) => {
        logger.error(`[AutoHeal] Unhandled rejection: ${(reason as Error)?.message || reason}`);
    });

    logger.info('[AutoHeal] Scheduler started');
}

/**
 * Auto-remove printers that have been offline for more than 15 minutes.
 * Runs every 5 minutes (separate from the main 60s loop).
 * Uses soft-delete (config.auto_removed = true) so the record stays around
 * for audit; IPP listing and dashboards filter on this flag.
 */
async function autoClearOfflinePrinters(fastify: any) {
    const cutoff = new Date(Date.now() - 15 * 60000);

    // Find printers whose DB status has been 'offline' for > 15 min
    // and that are NOT already auto-removed
    const stale = await fastify.knex('printers')
        .where({ status: 'offline' })
        .where('updated_at', '<', cutoff)
        .whereRaw("(config->>'auto_removed') IS DISTINCT FROM 'true'")
        .select('id', 'name', 'client_id', 'updated_at');

    if (stale.length === 0) return;

    for (const p of stale) {
        // Cancel any waiting jobs queued for this printer before removal
        const cancelledJobs = await fastify.knex('queues')
            .where({ printer_id: p.id, status: 'waiting' })
            .update({
                status: 'cancelled',
                updated_at: new Date()
            });

        // Mark print_jobs pointing at this printer as failed so they don't
        // hang in 'queued' forever
        await fastify.knex('print_jobs')
            .where({ printer_id: p.id, status: 'queued' })
            .update({
                status: 'failed',
                error_message: `Printer ${p.name} auto-removed after 15 minutes offline`,
                updated_at: new Date()
            });

        // Soft-remove: flip a config flag, don't hard-delete (preserves
        // print history; agent reconnect can re-register same printer).
        // COALESCE is required because config can be NULL — `NULL || {...}`
        // evaluates to NULL, silently losing the update.
        await fastify.knex('printers')
            .where({ id: p.id })
            .update({
                config: fastify.knex.raw(
                    "COALESCE(config, '{}'::jsonb) || jsonb_build_object('auto_removed', 'true', 'auto_removed_at', ?::text)",
                    [new Date().toISOString()]
                ),
                updated_at: new Date()
            });

        // Audit alert
        await fastify.knex('alerts').insert({
            printer_id: p.id,
            type: 'printer_auto_removed',
            severity: 'info',
            title: 'Printer Auto-Removed',
            message: `Printer ${p.name} auto-removed (offline > 15 min). ${cancelledJobs} queued job(s) cancelled.`
        });

        logger.warn(
            `[AutoHeal] Auto-removed printer ${p.name} (id=${p.id}) — offline since ${p.updated_at}, ${cancelledJobs} jobs cancelled`
        );

        fastify.io?.emit('printer:auto-removed', {
            id: p.id,
            name: p.name,
            reason: 'offline_15min',
            cancelledJobs
        });
    }
}

let autoClearStarted = false;
export function startAutoClearOffline(fastify: any) {
    if (autoClearStarted) return;
    autoClearStarted = true;
    // every 5 minutes
    setInterval(() => {
        (async () => {
            try {
                await autoClearOfflinePrinters(fastify);
            } catch (err) {
                logger.error(`[AutoHeal] autoClearOfflinePrinters crashed: ${(err as Error)?.message || err}`);
            }
        })();
    }, 5 * 60000);
    logger.info('[AutoHeal] autoClearOfflinePrinters scheduled (every 5 min, 15 min offline threshold)');
}

async function checkStuckJobs(fastify: any) {
    const stuckJobs = await fastify.knex('print_jobs')
        .whereIn('status', ['processing', 'queued'])
        .where('created_at', '<', new Date(Date.now() - 15 * 60000))
        .select('*');

    for (const job of stuckJobs) {
        logger.warn(`[AutoHeal] Found stuck job ${job.job_id}, status: ${job.status}`);

        if (job.status === 'processing' && job.attempts >= 3) {
            await fastify.knex('print_jobs')
                .where({ id: job.id })
                .update({ status: 'failed', error_message: 'Job stuck - auto-heal cancelled after max retries' });

            await fastify.knex('queues')
                .where({ print_job_id: job.id })
                .update({ status: 'cancelled' });

            fastify.io?.emit('job:cancelled', { jobId: job.job_id, reason: 'stuck' });
        }
    }
}

async function checkOfflinePrinters(fastify: any) {
    const offlinePrinters = await fastify.knex('printer_health')
        .where('metric_name', 'status')
        .where('metric_value', 'unhealthy')
        .where('recorded_at', '<', new Date(Date.now() - 5 * 60000))
        .distinct('printer_id');

    for (const { printer_id } of offlinePrinters) {
        const printer = await fastify.knex('printers').where({ id: printer_id }).first();

        // Check if unresolved alert already exists to prevent duplication
        const existingAlert = await fastify.knex('alerts')
            .where({
                printer_id,
                type: 'printer_offline',
                is_resolved: false
            })
            .first();

        if (existingAlert) {
            continue;
        }

        logger.warn(`[AutoHeal] Printer ${printer?.name} offline for > 5 minutes`);

        await fastify.knex('alerts')
            .insert({
                printer_id,
                type: 'printer_offline',
                severity: 'warning',
                title: 'Printer Offline',
                message: `Printer ${printer?.name} has been offline for more than 5 minutes`
            });

        const queuedJobs = await fastify.knex('queues')
            .where({ printer_id, status: 'waiting' })
            .select('print_job_id');

        for (const { print_job_id } of queuedJobs) {
            const failovers = await fastify.knex('printers')
                .where('group_id', printer.group_id)
                .where('id', '!=', printer_id)
                .orderBy('priority', 'desc')
                .first();

            if (failovers) {
                await fastify.knex('queues')
                    .where({ print_job_id })
                    .update({ printer_id: failovers.id });

                logger.info(`[AutoHeal] Moved job ${print_job_id} to printer ${failovers.name}`);

                fastify.io?.emit('job:moved', {
                    jobId: print_job_id,
                    fromPrinter: printer_id,
                    toPrinter: failovers.id
                });
            }
        }
    }
}

async function checkFailedRetries(fastify: any) {
    const pendingRetries = await fastify.knex('retries')
        .where({ status: 'pending' })
        .where('created_at', '<', new Date(Date.now() - 10 * 60000));

    for (const retry of pendingRetries) {
        await fastify.knex('retries')
            .where({ id: retry.id })
            .update({ status: 'expired' });

        logger.info(`[AutoHeal] Retry ${retry.id} marked as expired`);
    }
}

async function checkQueueHealth(fastify: any) {
    const queueStats = await fastify.knex('queues')
        .where('status', 'waiting')
        .groupBy('printer_id')
        .select('printer_id')
        .count('* as count');

    for (const stat of queueStats) {
        if (Number(stat.count) > 100) {
            const printer = await fastify.knex('printers').where({ id: stat.printer_id }).first();

            // Check if unresolved alert already exists to prevent duplication
            const existingAlert = await fastify.knex('alerts')
                .where({
                    printer_id: stat.printer_id,
                    type: 'queue_overload',
                    is_resolved: false
                })
                .first();

            if (existingAlert) {
                continue;
            }

            await fastify.knex('alerts')
                .insert({
                    printer_id: stat.printer_id,
                    type: 'queue_overload',
                    severity: 'warning',
                    title: 'Queue Overload',
                    message: `Printer ${printer?.name} has ${stat.count} jobs in queue`
                });

            logger.warn(`[AutoHeal] Queue overload on printer ${printer?.name}: ${stat.count} jobs`);
        }
    }
}