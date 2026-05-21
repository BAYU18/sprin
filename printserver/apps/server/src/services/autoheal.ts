import { logger } from '../utils/logger.js';

export async function autoHealScheduler(fastify: any) {
    setInterval(async () => {
        await checkStuckJobs(fastify);
        await checkOfflinePrinters(fastify);
        await checkFailedRetries(fastify);
        await checkQueueHealth(fastify);
    }, 60000);

    logger.info('[AutoHeal] Scheduler started');
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
        if (stat.count > 100) {
            const printer = await fastify.knex('printers').where({ id: stat.printer_id }).first();

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