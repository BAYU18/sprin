import { Queue, Worker, Job } from 'bullmq';
import Redis from 'ioredis';
import { logger } from '../utils/logger.js';
import { PrintRouter } from '../printer-engine/router.js';

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
        await printRouter.processJob(job.data);
    }, { connection, concurrency: parseInt(process.env.QUEUE_CONCURRENCY || '5') });

    printWorker.on('completed', (job, result) => {
        logger.info(`[Queue] Job ${job.id} completed:`, result);
        fastify.io?.emit('job:complete', { jobId: job.id, result });
    });

    printWorker.on('failed', (job, err) => {
        logger.error(`[Queue] Job ${job?.id} failed:`, err);
        fastify.io?.emit('job:error', { jobId: job?.id, error: err.message });
    });

    printWorker.on('progress', (job, progress) => {
        fastify.io?.emit('job:progress', { jobId: job.id, progress });
    });

    const notificationWorker = new Worker('notifications', async (job: Job) => {
        logger.info(`[Queue] Processing notification ${job.id}`);
    }, { connection });

    const healWorker = new Worker('heal-jobs', async (job: Job) => {
        logger.info(`[Queue] Processing heal job ${job.id}`);
    }, { connection });

    fastify.decorate('printQueue', printQueue);
    fastify.decorate('notificationQueue', notificationQueue);
    fastify.decorate('healQueue', healQueue);

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