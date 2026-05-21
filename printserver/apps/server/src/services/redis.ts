import Redis from 'ioredis';
import { logger } from '../utils/logger.js';

let redis: Redis | null = null;

export async function setupRedis(fastify: any) {
    redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
        maxRetriesPerRequest: 3,
        retryDelayOnFailover: 100,
        lazyConnect: true,
        enableReadyCheck: true,
        connectTimeout: 10000
    });

    redis.on('connect', () => {
        logger.info('Redis connected');
    });

    redis.on('error', (err) => {
        logger.error('Redis error:', err);
    });

    redis.on('ready', () => {
        logger.info('Redis ready');
    });

    await redis.connect();

    redis.subscribe('printserver:jobs', 'printserver:alerts', 'printserver:printers', (err) => {
        if (err) logger.error('Redis subscription error:', err);
    });

    redis.on('message', (channel, message) => {
        try {
            const data = JSON.parse(message);
            handleRedisMessage(channel, data, fastify);
        } catch (e) {
            logger.error('Failed to parse Redis message:', e);
        }
    });

    fastify.decorate('redis', redis);

    return redis;
}

function handleRedisMessage(channel: string, data: any, fastify: any) {
    const io = fastify.io;

    switch (channel) {
        case 'printserver:jobs':
            io?.emit('job:update', data);
            break;
        case 'printserver:alerts':
            io?.emit('alert:new', data);
            break;
        case 'printserver:printers':
            io?.emit('printer:update', data);
            break;
    }
}

export function getRedis() {
    return redis;
}

export { redis };