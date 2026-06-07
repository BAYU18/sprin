import { FastifyInstance } from 'fastify';
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
import { logger } from '../utils/logger.js';
import { cache } from '../utils/cache.js';

export async function setupRoutes(fastify: FastifyInstance) {
    await fastify.register(setupAuth);

    await fastify.register(setupPrintersRoutes, { prefix: '/api/printers' });
    await fastify.register(setupJobsRoutes, { prefix: '/api/jobs' });
    await fastify.register(setupClientsRoutes, { prefix: '/api/clients' });
    await fastify.register(setupUsersRoutes, { prefix: '/api/users' });
    await fastify.register(setupAlertsRoutes, { prefix: '/api/alerts' });
    await fastify.register(setupAnalyticsRoutes, { prefix: '/api/analytics' });
    await fastify.register(setupSettingsRoutes, { prefix: '/api/settings' });

    const IS_NODE = process.env.IS_NODE === 'true';
    if (IS_NODE) {
        await fastify.register(setupNodeInternalRoutes);
        fastify.log.info('[Routes] Node internal routes registered');
    }

    const IS_CENTRAL = process.env.IS_CENTRAL !== 'false';
    if (IS_CENTRAL) {
        await fastify.register(setupDiscoveryRoutes, { prefix: '/api' });
        await fastify.register(setupNodesRoutes, { prefix: '/api/nodes' });
        fastify.log.info('[Routes] Discovery and Nodes routes registered');
    }

    await fastify.register(setupSetupRoutes);
    await fastify.register(setupIPPRoutes);
    await fastify.register(setupDownloadsRoutes);
    await fastify.register(setupDriversRoutes);
    await fastify.register(setupPaperRoutes, { prefix: '/api' });
    await fastify.register(setupBadgesRoutes, { prefix: '/api' });
    // TIER-1 #3: Printer grouping & tags
    await fastify.register(setupPrinterGroupsRoutes, { prefix: '/api/printer-groups' });
    fastify.log.info('[Routes] Setup, IPP, Downloads, Drivers, Paper and Badges routes registered');

    // ── TIER-1 #1: Manual cleanup trigger endpoint ─────────────────────────
    // POST /api/admin/cleanup-stuck-jobs
    //   body: { secret?: string } — optional simple shared-secret check
    //   effect: runs cleanupStuckJobs + archiveOldJobs synchronously, returns counts
    //   usage: external cron / cron-job.org / operator can trigger ad-hoc
    fastify.post('/api/admin/cleanup-stuck-jobs', async (request, reply) => {
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

    // ── TIER-2 #2: BullMQ queue stats + cleanup ───────────────────────────
    // GET  /api/queues/stats   — counts of all queues (waiting/active/failed/delayed/completed)
    // POST /api/queues/clean-failed — remove failed jobs older than N hours
    fastify.get('/api/queues/stats', async () => {
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

    fastify.post('/api/queues/clean-failed', async (request: any) => {
        const body = (request.body || {}) as { olderThanHours?: number };
        const hours = Math.max(0, Math.min(body.olderThanHours ?? 168, 24 * 30));
        const { printQueue, healQueue, cleanupQueue } = await import('../queues/index.js');
        const queues = [printQueue, healQueue, cleanupQueue].filter(Boolean) as any[];
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

    // ── TIER-2 #3 + #1: Health endpoints for ops monitoring ──────────────
    // GET /api/health      — overall liveness
    // GET /api/health/db   — DB pool stats
    // GET /api/health/cache — Redis cache stats
    fastify.get('/api/health', async (request, reply) => {
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

    fastify.get('/api/health/db', async (request, reply) => {
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

    fastify.get('/api/health/cache', async (request, reply) => {
        return {
            ...cache.stats(),
            ping: await cache.ping()
        };
    });
}