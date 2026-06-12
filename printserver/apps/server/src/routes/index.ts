import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { setupAuth } from '../auth/index.js';
import { setupPrintersRoutes } from './printers.js';
import { setupJobsRoutes } from './jobs.js';
import { setupClientsRoutes } from './clients.js';
import { setupUsersRoutes } from './users.js';
import { setupAlertsRoutes } from './alerts.js';
import { setupAnalyticsRoutes } from './analytics.js';
import { setupSettingsRoutes } from './settings.js';
import { setupNodeInternalRoutes } from './node-internal.js';
import { setupNodesRoutes } from './nodes.js';
import { setupDiscoveryRoutes } from './discovery.js';
import { setupSetupRoutes } from './setup.js';
import { setupIPPRoutes } from './ipp.js';
import { setupDownloadsRoutes } from './downloads.js';
import { setupDriversRoutes } from './drivers.js';
import { setupPaperRoutes } from './paper.js';
import { setupBadgesRoutes } from './badges.js';
import { setupPrinterGroupsRoutes } from './printer-groups.js';
import { setupHealthRoutes } from './health.js';
import { setupQueueMgmtRoutes } from './queue-mgmt.js';
import { logger } from '../utils/logger.js';
import { cache } from '../utils/cache.js';

// Paths that do NOT require JWT authentication
const PUBLIC_PATHS = [
    '/api/auth/',                  // Auth routes are public (login/register/refresh/logout)
    '/api/health',                 // Health check endpoints
    '/api/health/db',
    '/api/health/cache',
    '/api/queues/stats',           // Queue stats are read-only monitoring info
];

// Regex patterns for path matching (used for routes with path params).
// Windows client agent endpoints — agents can't get a JWT before they
// register (catch-22), so they authenticate via X-Node-Secret header
// verified inside each handler. See clients.ts:register + heartbeat.
const PUBLIC_PATH_REGEX: RegExp[] = [
    /^\/api\/clients\/register\/?$/,
    /^\/api\/clients\/[^/]+\/heartbeat\/?$/,    // /api/clients/:id/heartbeat
];

function isPublicPath(path: string): boolean {
    // Strip query string for matching
    const pathname = path.split('?')[0];
    if (PUBLIC_PATHS.some(p => pathname.startsWith(p))) return true;
    if (PUBLIC_PATH_REGEX.some(re => re.test(pathname))) return true;
    return false;
}

// JWT verification hook — rejects unauthenticated requests to protected routes
async function jwtAuthHook(request: FastifyRequest, reply: FastifyReply) {
    try {
        await request.jwtVerify();
    } catch (err) {
        reply.status(401).send({ error: 'Unauthorized', message: 'Valid JWT required' });
    }
}

export async function setupRoutes(fastify: FastifyInstance) {
    await fastify.register(setupAuth);

    // ── Protected /api routes (JWT auth) ────────────────────────────────────
    await fastify.register(async (instance) => {
        instance.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
            if (!isPublicPath(request.url)) {
                await jwtAuthHook(request, reply);
            }
        });

        await instance.register(setupPrintersRoutes,   { prefix: '/printers' });
        await instance.register(setupJobsRoutes,        { prefix: '/jobs' });
        await instance.register(setupClientsRoutes,      { prefix: '/clients' });
        await instance.register(setupUsersRoutes,        { prefix: '/users' });
        await instance.register(setupAlertsRoutes,       { prefix: '/alerts' });
        await instance.register(setupAnalyticsRoutes,    { prefix: '/analytics' });
        await instance.register(setupSettingsRoutes,      { prefix: '/settings' });
        await instance.register(setupHealthRoutes,         { prefix: '/health' });
        await instance.register(setupQueueMgmtRoutes);

        // POST /api/admin/cleanup-stuck-jobs — manual stuck-job cleanup trigger
        instance.post('/admin/cleanup-stuck-jobs', async (request, reply) => {
            const body = (request.body as any) || {};
            const expected = process.env.ADMIN_TRIGGER_SECRET || 'printserver-admin';
            if (body.secret && body.secret !== expected) {
                return reply.status(403).send({ error: 'Invalid secret' });
            }
            try {
                const { runCleanupPass } = await import('../services/autoheal-runner.js');
                const result = await runCleanupPass(fastify);
                return { success: true, ...result };
            } catch (err) {
                logger.error(`[Admin] cleanup-stuck-jobs failed: ${(err as Error).message}`);
                return reply.status(500).send({ error: (err as Error).message });
            }
        });

        // GET /api/queues/stats — BullMQ queue counts
        instance.get('/queues/stats', async () => {
            const { printQueue, healQueue, notificationQueue } = await import('../queues/index.js');
            const names = [printQueue, healQueue, notificationQueue].filter(Boolean) as any[];
            const out: any[] = [];
            for (const q of names) {
                const counts = await q.getJobCounts('wait', 'active', 'completed', 'failed', 'delayed', 'paused');
                const isPaused = await q.isPaused().catch(() => false);
                out.push({
                    name: q.name,
                    paused: isPaused,
                    counts: {
                        waiting: counts.wait || 0,
                        active: counts.active || 0,
                        completed: counts.completed || 0,
                        failed: counts.failed || 0,
                        delayed: counts.delayed || 0,
                        paused: counts.paused || 0,
                    },
                });
            }
            return { queues: out, timestamp: new Date().toISOString() };
        });

        // POST /api/queues/clean-failed — remove failed jobs older than N hours
        instance.post('/queues/clean-failed', async (request: any) => {
            const body = (request.body || {}) as { olderThanHours?: number };
            const hours = Math.max(0, Math.min(body.olderThanHours ?? 168, 24 * 30));
            const { printQueue, healQueue } = await import('../queues/index.js');
            const queues = [printQueue, healQueue].filter(Boolean) as any[];
            const removed: Record<string, number> = {};
            for (const q of queues) {
                const failed = await q.getFailed(0, 1000);
                const cutoff = Date.now() - hours * 3600 * 1000;
                let count = 0;
                for (const job of failed) {
                    if ((job.timestamp || 0) < cutoff) {
                        const ok = await job.remove().then(() => true).catch(() => false);
                        if (ok) count++;
                    }
                }
                removed[q.name] = count;
            }
            return { success: true, removed, olderThanHours: hours };
        });

        // GET /api/health — overall liveness
        instance.get('/health', async (request, reply) => {
            const dbOk = await fastify.knex.raw('SELECT 1').then(() => true).catch(() => false);
            const cacheOk = await cache.ping();
            const status = dbOk ? (cacheOk ? 'ok' : 'degraded') : 'unhealthy';
            return {
                status,
                timestamp: new Date().toISOString(),
                uptime_sec: Math.round(process.uptime()),
                db: dbOk ? 'ok' : 'down',
                cache: cacheOk ? 'ok' : 'down',
                pid: process.pid,
                memory_mb: Math.round(process.memoryUsage().rss / 1024 / 1024)
            };
        });

        // GET /api/health/db — DB pool stats
        instance.get('/health/db', async (request, reply) => {
            try {
                const start = Date.now();
                await fastify.knex.raw('SELECT 1');
                const latency = Date.now() - start;
                const pool = (fastify.knex.client as any).pool || {};
                return {
                    status: 'ok',
                    latency_ms: latency,
                    pool: {
                        numUsed: pool.numUsed?.() ?? null,
                        numFree: pool.numFree?.() ?? null,
                        numPendingAcquires: pool.numPendingAcquires?.() ?? null,
                        numPendingCreates: pool.numPendingCreates?.() ?? null
                    }
                };
            } catch (err) {
                return reply.status(503).send({ status: 'down', error: (err as Error).message });
            }
        });

        // GET /api/health/cache — Redis cache stats
        instance.get('/health/cache', async (request, reply) => {
            return {
                ...cache.stats(),
                ping: await cache.ping()
            };
        });

        // IS_CENTRAL routes
        const IS_CENTRAL = process.env.IS_CENTRAL !== 'false';
        if (IS_CENTRAL) {
            await instance.register(setupDiscoveryRoutes, { prefix: '/discovery' });
            await instance.register(setupNodesRoutes,      { prefix: '/nodes' });
            instance.log.info('[Routes] Discovery and Nodes routes registered');
        }
    }, { prefix: '/api' });

    // ── IS_NODE routes — internal node routes ───────────────────────────────
    const IS_NODE = process.env.IS_NODE === 'true';
    if (IS_NODE) {
        await fastify.register(setupNodeInternalRoutes);
        fastify.log.info('[Routes] Node internal routes registered');
    }

    // ── Non-/api routes ────────────────────────────────────────────────────
    await fastify.register(setupSetupRoutes);
    await fastify.register(setupIPPRoutes);
    await fastify.register(setupDownloadsRoutes);
    await fastify.register(setupDriversRoutes);
    await fastify.register(setupPaperRoutes,        { prefix: '/api' });
    await fastify.register(setupBadgesRoutes,       { prefix: '/api' });
    await fastify.register(setupPrinterGroupsRoutes, { prefix: '/api/printer-groups' });
    fastify.log.info('[Routes] Setup, IPP, Downloads, Drivers, Paper and Badges routes registered');
}