import 'dotenv/config';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import websocket from '@fastify/websocket';
import staticFiles from '@fastify/static';
import path from 'path';
import { fileURLToPath } from 'url';
import { setupDatabase } from './db/knex.js';
import { setupRedis } from './services/redis.js';
import { setupBullMQ } from './queues/index.js';
import { setupSocketIO } from './services/socketio.js';
import { setupRoutes } from './routes/index.js';
import { setupMetrics } from './services/metrics.js';
import { logger } from './utils/logger.js';
import { PrintRouter } from './printer-engine/router.js';
import { CentralPrintRouter } from './services/centralRouter.js';
import { autoHealScheduler, startAutoClearOffline } from './services/autoheal.js';
import { NodeHeartbeatService } from './services/node-heartbeat.js';
import { IPPServer } from './services/ipp-server.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const IS_NODE = process.env.IS_NODE === 'true';
const IS_CENTRAL = process.env.IS_CENTRAL !== 'false';

async function buildServer() {
    const fastify = Fastify({
        logger: logger,
        trustProxy: true,
        bodyLimit: parseInt(process.env.BODY_LIMIT || '104857600')
    });

    await fastify.register(cors, {
        origin: true,
        credentials: true,
        methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS']
    });

    await fastify.register(helmet, {
        contentSecurityPolicy: false,
        crossOriginEmbedderPolicy: false
    });

    await fastify.register(jwt, {
        secret: process.env.JWT_SECRET || 'default-secret-change-me'
    });

    await fastify.register(rateLimit, {
        max: parseInt(process.env.RATE_LIMIT_MAX || '100'),
        timeWindow: parseInt(process.env.RATE_LIMIT_TTL || '60000')
    });

    await fastify.register(websocket);

    await fastify.register(staticFiles, {
        root: path.join(__dirname, '../../dashboard'),
        prefix: '/',
        decorateReply: false
    });

    await fastify.register(staticFiles, {
        root: path.join(__dirname, '../../client'),
        prefix: '/client',
        decorateReply: false
    });

    await setupDatabase(fastify);
    await setupRedis(fastify);
    await setupBullMQ(fastify);
    await setupSocketIO(fastify);
    await setupMetrics(fastify);

    // Initialize IPP server (port 631) for Windows printer sharing
    const ippServer = new IPPServer({
        getKnex: () => fastify.knex,
        getIO: () => fastify.io
    });
    await ippServer.start();
    fastify.decorate('ippServer', ippServer);

    // Wire socket.io to receive print:result from agents
    if (fastify.io) {
        fastify.io.on('connection', (socket: any) => {
            socket.on('print:result', (data: any) => {
                ippServer.handleAgentResult(data);
            });
        });
    }

    const printRouter = new PrintRouter(fastify);
    logger.info('About to initialize PrintRouter...');
    await printRouter.initialize();
    logger.info('PrintRouter initialized');
    fastify.decorate('printRouter', printRouter);

    if (IS_CENTRAL) {
        const centralRouter = new CentralPrintRouter(fastify);
        await centralRouter.initialize();
        fastify.decorate('centralRouter', centralRouter);
        logger.info('[Server] CentralPrintRouter initialized');
    }

    await setupRoutes(fastify);

    fastify.get('/health', async () => ({ status: 'ok', timestamp: new Date().toISOString() }));
    fastify.get('/ready', async (request, reply) => {
        const db = fastify.knex;
        const redis = fastify.redis;
        try {
            await db.raw('SELECT 1');
            await redis.ping();
            return { status: 'ready' };
        } catch (error) {
            reply.code(503);
            return { status: 'not ready', error: (error as Error).message };
        }
    });

    return fastify;
}

async function start() {
    // Global safety net: never let async errors crash the server silently
    process.on('unhandledRejection', (reason) => {
        logger.error(`[unhandledRejection] ${(reason as Error)?.message || reason}`);
        if (reason instanceof Error && reason.stack) {
            logger.error(reason.stack);
        }
    });
    process.on('uncaughtException', (err) => {
        logger.error(`[uncaughtException] ${err.message}`);
        if (err.stack) logger.error(err.stack);
    });

    try {
        const fastify = await buildServer();

        if (IS_CENTRAL) {
            await autoHealScheduler(fastify);
            startAutoClearOffline(fastify);
        }

        if (IS_NODE) {
            const heartbeatService = new NodeHeartbeatService(fastify);
            await heartbeatService.start();
            fastify.decorate('heartbeatService', heartbeatService);
        }

        const port = parseInt(process.env.PORT || '3000');
        const host = process.env.HOST || '0.0.0.0';

        await fastify.listen({ port, host });
        logger.info(`PrintServer running on http://${host}:${port}`);
        logger.info(`Mode: ${IS_NODE ? 'Windows Node' : 'Central Hub'}`);
        logger.info(`Dashboard: http://localhost:${port}`);
        logger.info(`WebSocket: ws://localhost:${port}`);

        const shutdown = async (signal: string) => {
            logger.info(`Received ${signal}, shutting down gracefully...`);

            if (IS_NODE && fastify.heartbeatService) {
                await fastify.heartbeatService.stop();
            }

            await fastify.close();
            process.exit(0);
        };

        process.on('SIGTERM', () => shutdown('SIGTERM'));
        process.on('SIGINT', () => shutdown('SIGINT'));

    } catch (error) {
        console.error('RAW ERROR:', error);
        console.error('Type:', typeof error);
        console.error('Keys:', Object.keys(error));
        console.error('Constructor:', error?.constructor?.name);
        
        logger.error('Failed to start server:', error);
        if (error instanceof Error) {
            logger.error('Stack:', error.stack);
            if (error.cause) {
                logger.error('Cause:', error.cause);
            }
        }
        if (typeof error === 'string') {
            logger.error('Error string:', error);
        }
        if (error && typeof error === 'object') {
            logger.error('Error object:', JSON.stringify(error, Object.getOwnPropertyNames(error)));
        }
        process.exit(1);
    }
}

start();