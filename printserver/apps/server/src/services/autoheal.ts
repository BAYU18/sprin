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

    // ── TIER-1 #1: Tier-1 cleanup runs every 5 minutes ─────────────────────
    // - Cleanup stuck processing/queued jobs
    // - Archive old jobs (> 7 days) to keep print_jobs table lean
    setInterval(async () => {
        await safeRun('cleanupStuckJobs', () => cleanupStuckJobs(fastify));
        await safeRun('archiveOldJobs', () => archiveOldJobs(fastify));
    }, 5 * 60000);

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
            try {
                await clearStaleNodes(fastify);
            } catch (err) {
                logger.error(`[AutoHeal] clearStaleNodes crashed: ${(err as Error)?.message || err}`);
            }
        })();
    }, 5 * 60000);
    logger.info('[AutoHeal] autoClearOfflinePrinters scheduled (every 5 min, 15 min offline threshold)');
}

// Node stale-offline sweep. The agent heartbeat sets is_online=true but nothing
// ever flips it back to false when a node goes quiet (crash, network drop,
// killed agent), so dead nodes lingered as "online" for days. This flips any
// client whose last heartbeat is older than the stale window to is_online=false
// and notifies dashboards in real time. Runs every 5 min (piggybacks the
// existing auto-clear timer); the window is short enough that the dashboard
// self-corrects quickly without fighting healthy 30s heartbeats.
const NODE_STALE_MINUTES = 2;
async function clearStaleNodes(fastify: any) {
    const cutoff = new Date(Date.now() - NODE_STALE_MINUTES * 60000);
    const stale = await fastify.knex('clients')
        .where('is_online', true)
        .where(function (this: any) {
            this.where('last_seen', '<', cutoff).orWhereNull('last_seen');
        })
        .select('id', 'hostname', 'last_seen');

    for (const node of stale) {
        await fastify.knex('clients')
            .where({ id: node.id })
            .update({ is_online: false, updated_at: new Date() });

        // Node mati = semua printernya tidak mungkin online. Turunkan status
        // printer yang masih 'online'/'busy' jadi 'offline' biar dashboard konsisten.
        const printersOff = await fastify.knex('printers')
            .where({ client_id: node.id })
            .whereIn('status', ['online', 'busy'])
            .update({ status: 'offline', updated_at: new Date() });

        fastify.io?.emit('client:offline', { clientId: node.id });
        if (printersOff > 0) {
            // Beri tahu dashboard agar daftar printer ikut ter-update real-time.
            fastify.io?.emit('printer:patch', { client_id: node.id, status: 'offline' });
        }
        logger.warn(
            `[AutoHeal] Node ${node.hostname} (id=${node.id}) marked offline — no heartbeat since ${node.last_seen || 'never'}${printersOff ? ` (+${printersOff} printer→offline)` : ''}`
        );
    }
    if (stale.length) {
        logger.info(`[AutoHeal] clearStaleNodes flipped ${stale.length} stale node(s) offline`);
    }
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

            // Create alert record for stuck job
            await fastify.knex('alerts')
                .insert({
                    printer_id: job.printer_id,
                    type: 'job_failed',
                    severity: 'warning',
                    title: 'Job Stuck Cancelled',
                    message: `Print job "${job.job_name || job.file_name}" cancelled automatically after 3 failed attempts (stuck in queue).`
                });

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
        if (!printer) continue;
        
        // Lookup the Node Agent (Client) hosting this printer
        const client = printer.client_id
            ? await fastify.knex('clients').where({ id: printer.client_id }).first()
            : null;

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
                client_id: printer.client_id,
                type: 'printer_offline',
                severity: 'warning',
                title: 'Printer Offline',
                message: `Printer ${printer?.name} has been offline for more than 5 minutes`,
                metadata: JSON.stringify({
                    printer_name: printer?.name,
                    node_hostname: client?.hostname || 'Unknown',
                    node_ip: client?.ip_address || 'Unknown',
                    node_os: client?.os_version || 'Unknown',
                    agent_version: client?.client_version || 'Unknown'
                })
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

// ────────────────────────────────────────────────────────────────────────────
// TIER-1 #1: Auto-cleanup stuck jobs & archive old jobs
// ────────────────────────────────────────────────────────────────────────────

/**
 * Cancel jobs that have been stuck in 'processing' or 'queued' state for too
 * long. The existing `checkStuckJobs` only fails jobs after 3 attempts; this
 * complements it by proactively cancelling anything that exceeds the time
 * budget for its current state.
 *
 *  - 'processing'  > 10 min → cancel (print engine should've reported by now)
 *  - 'queued'      > 30 min → cancel (printer unreachable or node agent down)
 */
async function cleanupStuckJobs(fastify: any) {
    const now = new Date();
    const tenMinAgo = new Date(now.getTime() - 10 * 60000);
    const thirtyMinAgo = new Date(now.getTime() - 30 * 60000);

    // 1. Find processing jobs older than 10 min
    const stuckProcessing = await fastify.knex('print_jobs')
        .where('status', 'processing')
        .where('updated_at', '<', tenMinAgo)
        .select('id', 'job_id', 'printer_id', 'job_name', 'file_name', 'attempts', 'updated_at');

    for (const job of stuckProcessing) {
        logger.warn(`[AutoHeal] Canceling stuck 'processing' job ${job.job_id} (no progress for >10 min, attempts=${job.attempts})`);

        await fastify.knex('print_jobs')
            .where({ id: job.id })
            .update({
                status: 'cancelled',
                error_message: `Auto-cancelled: stuck in 'processing' for >10 min`,
                completed_at: now
            });

        // Also clear any active queue entry
        await fastify.knex('queues')
            .where({ print_job_id: job.id })
            .whereIn('status', ['pending', 'active'])
            .update({ status: 'cancelled', updated_at: now });

        // Create alert (with node context if available)
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

        fastify.io?.emit('job:cancelled', { jobId: job.job_id, reason: 'stuck-processing' });
    }

    // 2. Find queued jobs older than 30 min
    const stuckQueued = await fastify.knex('print_jobs')
        .where('status', 'queued')
        .where('created_at', '<', thirtyMinAgo)
        .select('id', 'job_id', 'printer_id', 'job_name', 'file_name', 'created_at');

    for (const job of stuckQueued) {
        logger.warn(`[AutoHeal] Canceling stuck 'queued' job ${job.job_id} (queued for >30 min, printer likely offline)`);

        await fastify.knex('print_jobs')
            .where({ id: job.id })
            .update({
                status: 'cancelled',
                error_message: `Auto-cancelled: queued for >30 min (printer unreachable)`,
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
            message: `Print job "${job.job_name || job.file_name}" cancelled after being queued for >30 min (printer unreachable).`,
            metadata: JSON.stringify({
                job_id: job.job_id,
                queued_since: job.created_at,
                auto_cleanup: true
            })
        });

        fastify.io?.emit('job:cancelled', { jobId: job.job_id, reason: 'stuck-queued' });
    }

    if (stuckProcessing.length || stuckQueued.length) {
        logger.info(`[AutoHeal] Cleanup pass: ${stuckProcessing.length} processing + ${stuckQueued.length} queued jobs cancelled`);
        await sendTelegramNotification(fastify,
            `🧹 *Auto-Cleanup Jobs*\n` +
            `• Processing dibatalkan: *${stuckProcessing.length}* job\n` +
            `• Queued dibatalkan: *${stuckQueued.length}* job\n` +
            `Waktu: ${now.toISOString()}`);
    }
}

/**
 * Move old completed/failed/cancelled jobs (>= 7 days) to print_jobs_archive
 * (or delete them if the archive table doesn't exist). Keeps the main table
 * fast for real-time queries.
 */
async function archiveOldJobs(fastify: any) {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    // Check if archive table exists
    const hasArchive = await fastify.knex.schema.hasTable('print_jobs_archive').catch(() => false);

    if (hasArchive) {
        // Move old jobs to archive in a single transaction
        const oldJobs = await fastify.knex('print_jobs')
            .whereIn('status', ['completed', 'failed', 'cancelled'])
            .where('created_at', '<', sevenDaysAgo)
            .select('*');

        if (oldJobs.length === 0) return;

        await fastify.knex.transaction(async (trx: any) => {
            await trx('print_jobs_archive').insert(oldJobs);
            await trx('print_jobs')
                .whereIn('id', oldJobs.map((j: any) => j.id))
                .del();
        });

        logger.info(`[AutoHeal] Archived ${oldJobs.length} jobs older than 7 days to print_jobs_archive`);
        await sendTelegramNotification(fastify,
            `📦 *Job Archive Pass*\n• Dipindahkan ke arsip: *${oldJobs.length}* job (>7 hari)`);
    } else {
        // No archive table — just hard-delete old jobs
        const deleted = await fastify.knex('print_jobs')
            .whereIn('status', ['completed', 'failed', 'cancelled'])
            .where('created_at', '<', sevenDaysAgo)
            .del();

        if (deleted > 0) {
            logger.info(`[AutoHeal] Hard-deleted ${deleted} jobs older than 7 days (no archive table configured)`);
        }
    }
}

/**
 * Best-effort Telegram notifier. No-op when TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID
 * aren't set in env, so production deployments that don't use Telegram still
 * run cleanly.
 */
async function sendTelegramNotification(fastify: any, text: string) {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;
    if (!token || !chatId) return;

    try {
        const url = `https://api.telegram.org/bot${token}/sendMessage`;
        await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: chatId,
                text,
                parse_mode: 'Markdown',
                disable_web_page_preview: true
            })
        });
    } catch (err) {
        // Never let notifier failure break the cleanup loop
        logger.warn(`[AutoHeal] Telegram notify failed: ${(err as Error)?.message}`);
    }
}