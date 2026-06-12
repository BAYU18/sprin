/**
 * PrintServer Pro — /api/health/* routes (TIER-2 #6)
 * --------------------------------------------------------------
 * Aggregated printer-health endpoints backed by the health-monitor
 * service. The summary endpoint is cached (60s) since it scans
 * every printer's history table on each call.
 */

import { FastifyInstance } from 'fastify';
import { cache } from '../utils/cache.js';
import * as healthMonitor from '../services/health-monitor.js';

const HEALTH_SUMMARY_CACHE_KEY = 'health:summary:all';
const HEALTH_SUMMARY_TTL = 60;

export async function setupHealthRoutes(fastify: FastifyInstance) {
    /**
     * GET /api/health/printers
     * Cached summary of all printers (60s TTL).
     */
    fastify.get('/printers', async (request, reply) => {
        const data = await cache.getOrSet(HEALTH_SUMMARY_CACHE_KEY, HEALTH_SUMMARY_TTL, async () => {
            return await healthMonitor.getHealthSummary(fastify);
        });
        return data;
    });

    /**
     * GET /api/health/printers/:id
     * Detailed health for a single printer — uptime windows, error rate,
     * response time, recent events, full history, and detected anomalies.
     */
    fastify.get('/printers/:id', async (request, reply) => {
        const { id } = request.params as { id: string };
        const printerId = parseInt(id, 10);
        if (!Number.isFinite(printerId)) {
            return reply.status(400).send({ error: 'Invalid printer id' });
        }

        const printer = await fastify.knex('printers').where({ id: printerId }).first();
        if (!printer) return reply.status(404).send({ error: 'Printer not found' });

        const [up24, up7, recentEvents, history, anomalies, lastOfflineRow, jobAgg, rtRows] = await Promise.all([
            healthMonitor.calculateUptime(fastify, printerId, 1),
            healthMonitor.calculateUptime(fastify, printerId, 7),
            fastify.knex('printer_health')
                .where({ printer_id: printerId })
                .orderBy('recorded_at', 'desc')
                .limit(50),
            fastify.knex('printer_health')
                .where({ printer_id: printerId })
                .orderBy('recorded_at', 'desc')
                .limit(500),
            healthMonitor.detectAnomalies(fastify, printerId),
            fastify.knex('printer_health')
                .where({ printer_id: printerId, metric_name: 'status' })
                .whereIn('metric_value', ['offline', 'unhealthy'])
                .orderBy('recorded_at', 'desc')
                .first(),
            fastify.knex('print_jobs')
                .where('printer_id', printerId)
                .where('created_at', '>=', new Date(Date.now() - 24 * 60 * 60 * 1000))
                .groupBy('status')
                .select('status')
                .count('* as count'),
            fastify.knex('printer_health')
                .where({ printer_id: printerId, metric_name: 'response_time_ms' })
                .where('recorded_at', '>=', new Date(Date.now() - 24 * 60 * 60 * 1000))
                .select('metric_value'),
        ]);

        const totalJobs = jobAgg.reduce((s, r) => s + Number(r.count), 0);
        const failedJobs = jobAgg
            .filter(r => ['failed', 'cancelled'].includes(r.status))
            .reduce((s, r) => s + Number(r.count), 0);
        const errorRate = totalJobs > 0 ? Math.round((failedJobs / totalJobs) * 10000) / 100 : 0;
        const successRate = totalJobs > 0 ? Math.round(((totalJobs - failedJobs) / totalJobs) * 10000) / 100 : 100;

        // Average response time (string values cast to int)
        const rtValues = rtRows
            .map(r => Number(r.metric_value))
            .filter(n => Number.isFinite(n));
        const avgResponseTimeMs = rtValues.length
            ? Math.round(rtValues.reduce((s, n) => s + n, 0) / rtValues.length)
            : null;

        return {
            printer_id: printerId,
            printer_name: printer.name,
            status: printer.status || 'offline',
            uptime_24h: up24.uptimePercent,
            uptime_7d: up7.uptimePercent,
            error_rate_24h: errorRate,
            success_rate_24h: successRate,
            avg_response_time_ms: avgResponseTimeMs,
            total_jobs_24h: totalJobs,
            failed_jobs_24h: failedJobs,
            last_offline_at: lastOfflineRow?.recorded_at
                ? new Date(lastOfflineRow.recorded_at).toISOString()
                : null,
            recent_events: recentEvents,
            history: history,
            anomalies: anomalies,
        };
    });

    /**
     * GET /api/health/printers/:id/history?metric=status&days=7
     * Time-series slice of a single metric for a printer.
     */
    fastify.get('/printers/:id/history', async (request, reply) => {
        const { id } = request.params as { id: string };
        const printerId = parseInt(id, 10);
        if (!Number.isFinite(printerId)) {
            return reply.status(400).send({ error: 'Invalid printer id' });
        }
        const { metric = 'status', days = 7 } = request.query as { metric?: string; days?: number };
        const daysNum = Math.max(1, Math.min(90, Number(days) || 7));

        const rows = await fastify.knex('printer_health')
            .where({ printer_id: printerId, metric_name: String(metric) })
            .where('recorded_at', '>=', new Date(Date.now() - daysNum * 24 * 60 * 60 * 1000))
            .orderBy('recorded_at', 'asc')
            .select('metric_value', 'recorded_at');

        return {
            printer_id: printerId,
            metric,
            days: daysNum,
            points: rows.map(r => ({
                value: r.metric_value,
                timestamp: r.recorded_at,
            })),
        };
    });

    /**
     * POST /api/health/printers/:id/snapshot
     * Manual snapshot trigger — records current status into printer_health.
     * Useful for "refresh now" buttons and integration tests.
     */
    fastify.post('/printers/:id/snapshot', async (request, reply) => {
        const { id } = request.params as { id: string };
        const printerId = parseInt(id, 10);
        if (!Number.isFinite(printerId)) {
            return reply.status(400).send({ error: 'Invalid printer id' });
        }
        const printer = await fastify.knex('printers').where({ id: printerId }).first();
        if (!printer) return reply.status(404).send({ error: 'Printer not found' });

        const body = (request.body as any) || {};
        const status = body.status || printer.status || 'offline';

        await healthMonitor.recordHealthSnapshot(fastify, printerId, {
            status,
            response_time_ms: typeof body.response_time_ms === 'number' ? body.response_time_ms : undefined,
            recorded_at: new Date(),
        });
        await healthMonitor.checkAlertThresholds(fastify, printerId, status);
        await cache.invalidate(HEALTH_SUMMARY_CACHE_KEY);

        return { success: true, printer_id: printerId, status };
    });

    /**
     * POST /api/health/check-all
     * Run anomaly detection across every printer. Returns aggregated issues.
     * Intended for periodic cron or on-demand "Check now" UI button.
     */
    fastify.post('/check-all', async (request, reply) => {
        const printers: Array<{ id: number; name: string }> = await fastify.knex('printers')
            .whereRaw("(config->>'auto_removed') IS DISTINCT FROM 'true'")
            .select('id', 'name');

        const results: Array<{
            printer_id: number;
            printer_name: string;
            anomalies: healthMonitor.Anomaly[];
        }> = [];

        let alertsCreated = 0;
        for (const p of printers) {
            const anomalies = await healthMonitor.detectAnomalies(fastify, p.id);
            // Also check the offline threshold — may create an alert
            const lastStatus = await fastify.knex('printer_health')
                .where({ printer_id: p.id, metric_name: 'status' })
                .orderBy('recorded_at', 'desc')
                .first();
            const threshold = await healthMonitor.checkAlertThresholds(
                fastify,
                p.id,
                lastStatus?.metric_value
            );
            if (threshold.alertCreated) alertsCreated++;
            if (anomalies.length > 0) {
                results.push({ printer_id: p.id, printer_name: p.name, anomalies });
            }
        }

        await cache.invalidate(HEALTH_SUMMARY_CACHE_KEY);

        return {
            checked: printers.length,
            with_issues: results.length,
            alerts_created: alertsCreated,
            issues: results,
            timestamp: new Date().toISOString(),
        };
    });
}
