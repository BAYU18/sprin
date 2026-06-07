import { Queue, Worker, Job } from 'bullmq';
import Redis from 'ioredis';
import { logger } from '../utils/logger.js';
import { PrintRouter } from '../printer-engine/router.js';
import { cache } from '../utils/cache.js';

let connection: Redis;
let printQueue: Queue;
let notificationQueue: Queue;
let healQueue: Queue;

export async function setupBullMQ(fastify: any) {
    connection = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
        maxRetriesPerRequest: null
    });

    printQueue = new Queue('print-jobs', { connection });
    notificationQueue = new Queue('notifications', { connection });
    healQueue = new Queue('heal-jobs', { connection });

    const printWorker = new Worker('print-jobs', async (job: Job) => {
        logger.info(`[Queue] Processing print job ${job.id}`);
        const printRouter: PrintRouter = fastify.printRouter;
        try {
            // TIER-2 #2: progress reporting — first tick at 10%
            await job.updateProgress(10);
            const result = await printRouter.processJob(job.data);
            await job.updateProgress(100);
            return result;
        } catch (err) {
            const msg = (err as Error)?.message || String(err);
            logger.warn(`[Queue] Print job ${job.id} attempt ${job.attemptsMade + 1} failed: ${msg}`);
            throw err;  // let BullMQ handle retry logic
        }
    }, { connection, concurrency: parseInt(process.env.QUEUE_CONCURRENCY || '5') });

    printWorker.on('completed', (job, result) => {
        logger.info(`[Queue] Job ${job.id} completed:`, result);
        // TIER-2 #1: invalidate job stats cache
        cache.invalidate('jobs:stats:today').catch(() => {});
        fastify.io?.emit('job:complete', { jobId: job.id, result });
    });

    printWorker.on('failed', (job, err) => {
        logger.error(`[Queue] Job ${job?.id} failed:`, err);
        cache.invalidate('jobs:stats:today').catch(() => {});
        fastify.io?.emit('job:error', { jobId: job?.id, error: err.message });
    });

    printWorker.on('progress', (job, progress) => {
        fastify.io?.emit('job:progress', { jobId: job.id, progress });
    });

    // TIER-2 #2: graceful worker shutdown so in-flight jobs aren't lost
    const gracefulShutdown = async (signal: string) => {
        logger.info(`[Queue] ${signal} received, draining workers...`);
        try {
            await Promise.all([
                printWorker.close(),
                notificationWorker.close(),
                healWorker.close()
            ]);
            logger.info('[Queue] Workers drained cleanly');
        } catch (err) {
            logger.warn(`[Queue] Error draining workers: ${(err as Error).message}`);
        }
    };
    process.once('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.once('SIGINT', () => gracefulShutdown('SIGINT'));

    const notificationWorker = new Worker('notifications', async (job: Job) => {
        logger.info(`[Queue] Processing notification ${job.id}`);
    }, { connection });

    const healWorker = new Worker('heal-jobs', async (job: Job) => {
        logger.info(`[Queue] Processing heal job ${job.id}`);
    }, { connection });

    fastify.decorate('printQueue', printQueue);
    fastify.decorate('notificationQueue', notificationQueue);
    fastify.decorate('healQueue', healQueue);

    // TIER-2 #2: daily cleanup of old completed/failed jobs (keeps BullMQ lean)
    const cleanupInterval = setInterval(async () => {
        try {
            const [completed, failed] = await Promise.all([
                printQueue.getCompleted(0, 1000),
                printQueue.getFailed(0, 1000)
            ]);
            const now = Date.now();
            const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
            for (const job of [...completed, ...failed]) {
                if (job.finishedOn && (now - job.finishedOn) > MAX_AGE_MS) {
                    await job.remove().catch(() => {});
                }
            }
        } catch (err) {
            logger.warn(`[Queue] cleanup tick failed: ${(err as Error).message}`);
        }
    }, 60 * 60 * 1000); // every hour

    // Unref so the interval doesn't keep the process alive
    cleanupInterval.unref();

    return { printQueue, notificationQueue, healQueue };
}

export async function addPrintJob(data: any) {
    return printQueue.add('print', data, {
        attempts: parseInt(process.env.JOB_RETRY_ATTEMPTS || '3'),
        backoff: {
            type: 'exponential',
            delay: parseInt(process.env.JOB_RETRY_DELAY || '5000')
        },
        removeOnComplete: { count: 1000 },
        removeOnFail: { count: 5000 }
    });
}

export async function addNotification(data: any) {
    return notificationQueue.add('notify', data, {
        removeOnComplete: true,
        removeOnFail: false
    });
}

export async function addHealJob(data: any) {
    return healQueue.add('heal', data, {
        attempts: 3,
        backoff: { type: 'fixed', delay: 30000 },
        removeOnComplete: true
    });
}

export { printQueue, notificationQueue, healQueue };