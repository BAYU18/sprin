/**
 * PrintServer Pro — Printer Health Monitor (TIER-2 #6)
 * --------------------------------------------------------------
 * Centralised service for tracking printer health snapshots,
 * computing uptime, detecting anomalies, and firing alerts when
 * thresholds are breached.
 *
 * Data model (printer_health):
 *   - printer_id, metric_name, metric_value, recorded_at
 *   - one row per metric (status, response_time_ms, jobs_completed, etc.)
 *
 * The heartbeat handler in clients.ts calls recordHealthSnapshot() for
 * every reported printer on every heartbeat, populating the previously
 * orphaned table. The /api/health/* routes expose aggregated views.
 */

import type { FastifyInstance } from 'fastify';

export interface HealthSnapshotMetrics {
    status?: string;                   // 'online' | 'offline' | 'busy' | 'error'
    response_time_ms?: number;         // last driver round-trip
    jobs_completed?: number;           // delta since last snapshot
    jobs_failed?: number;              // delta since last snapshot
    [key: string]: any;
}

export interface UptimeResult {
    uptimePercent: number;
    downtimeMinutes: number;
    totalChecks: number;
    onlineChecks: number;
    offlineChecks: number;
}

export interface Anomaly {
    type:
        | 'offline_extended'
        | 'high_error_rate'
        | 'flapping'
        | 'no_heartbeat'
        | 'slow_response';
    severity: 'low' | 'medium' | 'high' | 'critical';
    message: string;
    detail?: Record<string, any>;
}

export interface PrinterHealthSummary {
    printer_id: number;
    printer_name: string;
    status: string;
    uptime_24h: number;
    uptime_7d: number;
    total_jobs_24h: number;
    error_rate_24h: number;
    last_offline_at: string | null;
}

// ────────────────────────────────────────────────────────────────────────────
// recordHealthSnapshot — write one row per metric for a printer
// ────────────────────────────────────────────────────────────────────────────
export async function recordHealthSnapshot(
    fastify: FastifyInstance,
    printerId: number,
    metrics: HealthSnapshotMetrics
): Promise<void> {
    const recordedAt = (metrics as any).recorded_at instanceof Date
        ? (metrics as any).recorded_at
        : new Date();

    const entries: Array<{ printer_id: number; metric_name: string; metric_value: string; recorded_at: Date }> = [];

    // Each named metric becomes its own row — schema is generic (metric_name/value)
    // so we just iterate the keys and stringify values. 'status' is the canonical
    // online/offline signal used by calculateUptime/detectAnomalies.
    for (const [name, raw] of Object.entries(metrics)) {
        if (raw === undefined || raw === null) continue;
        if (name === 'recorded_at') continue;
        entries.push({
            printer_id: printerId,
            metric_name: name,
            metric_value: String(raw),
            recorded_at: recordedAt,
        });
    }

    if (entries.length === 0) return;

    try {
        await fastify.knex('printer_health').insert(entries);
    } catch (err) {
        // Don't crash the heartbeat on a transient DB error — just log.
        fastify.log?.warn?.(
            `[Health] Failed to record snapshot for printer ${printerId}: ${(err as Error).message}`
        );
    }
}

// ────────────────────────────────────────────────────────────────────────────
// calculateUptime — % online over the last N days, based on 'status' rows
// ────────────────────────────────────────────────────────────────────────────
export async function calculateUptime(
    fastify: FastifyInstance,
    printerId: number,
    days: number = 7
): Promise<UptimeResult> {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const rows: Array<{ metric_value: string }> = await fastify.knex('printer_health')
        .where('printer_id', printerId)
        .where('metric_name', 'status')
        .where('recorded_at', '>=', since)
        .orderBy('recorded_at', 'desc')
        .select('metric_value');

    const totalChecks = rows.length;
    if (totalChecks === 0) {
        return {
            uptimePercent: 100,
            downtimeMinutes: 0,
            totalChecks: 0,
            onlineChecks: 0,
            offlineChecks: 0,
        };
    }

    const offlineChecks = rows.filter(
        r => r.metric_value.toLowerCase() === 'offline' || r.metric_value.toLowerCase() === 'unhealthy'
    ).length;
    const onlineChecks = totalChecks - offlineChecks;

    const uptimePercent = (onlineChecks / totalChecks) * 100;
    // Approximate downtime: each check represents the gap to the next,
    // total window = days * 24 * 60 minutes, distributed across checks.
    const totalMinutes = days * 24 * 60;
    const downtimeMinutes = Math.round((offlineChecks / totalChecks) * totalMinutes);

    return {
        uptimePercent: Math.round(uptimePercent * 100) / 100,
        downtimeMinutes,
        totalChecks,
        onlineChecks,
        offlineChecks,
    };
}

// ────────────────────────────────────────────────────────────────────────────
// detectAnomalies — return a list of detected issues for a single printer
// ────────────────────────────────────────────────────────────────────────────
export async function detectAnomalies(
    fastify: FastifyInstance,
    printerId: number
): Promise<Anomaly[]> {
    const anomalies: Anomaly[] = [];
    const printer = await fastify.knex('printers').where({ id: printerId }).first();
    if (!printer) return anomalies;

    const now = Date.now();

    // 1) Offline > 5 min (looking for a fresh 'offline' status record)
    const lastOffline = await fastify.knex('printer_health')
        .where({ printer_id: printerId, metric_name: 'status' })
        .whereIn('metric_value', ['offline', 'unhealthy'])
        .orderBy('recorded_at', 'desc')
        .first();

    if (lastOffline) {
        const offlineFor = now - new Date(lastOffline.recorded_at).getTime();
        if (offlineFor > 5 * 60 * 1000) {
            anomalies.push({
                type: 'offline_extended',
                severity: offlineFor > 30 * 60 * 1000 ? 'critical' : 'high',
                message: `Printer offline for ${Math.round(offlineFor / 60000)} minutes`,
                detail: { since: lastOffline.recorded_at, durationMs: offlineFor },
            });
        }
    }

    // 2) No heartbeat / no health record in last 15 min
    const lastAny = await fastify.knex('printer_health')
        .where({ printer_id: printerId })
        .orderBy('recorded_at', 'desc')
        .first();
    if (lastAny) {
        const silent = now - new Date(lastAny.recorded_at).getTime();
        if (silent > 15 * 60 * 1000) {
            anomalies.push({
                type: 'no_heartbeat',
                severity: 'medium',
                message: `No health data in ${Math.round(silent / 60000)} min`,
                detail: { last_seen: lastAny.recorded_at },
            });
        }
    } else if (printer.status === 'offline') {
        // Printer is offline and has never reported health — flag for visibility
        anomalies.push({
            type: 'no_heartbeat',
            severity: 'medium',
            message: 'No health snapshots recorded yet',
        });
    }

    // 3) Error rate > 50% in last 24h (from print_jobs)
    const dayAgo = new Date(now - 24 * 60 * 60 * 1000);
    const jobStats: Array<{ status: string; count: string }> = await fastify.knex('print_jobs')
        .where('printer_id', printerId)
        .where('created_at', '>=', dayAgo)
        .groupBy('status')
        .select('status')
        .count('* as count');

    const total = jobStats.reduce((s, r) => s + Number(r.count), 0);
    if (total > 0) {
        const failed = jobStats
            .filter(r => ['failed', 'cancelled'].includes(r.status))
            .reduce((s, r) => s + Number(r.count), 0);
        const errRate = (failed / total) * 100;
        if (errRate > 50) {
            anomalies.push({
                type: 'high_error_rate',
                severity: errRate > 80 ? 'critical' : 'high',
                message: `Error rate ${errRate.toFixed(1)}% in last 24h (${failed}/${total} jobs)`,
                detail: { errorRate, failed, total },
            });
        }
    }

    // 4) Flapping — many status transitions in a short window
    const recentStatuses: Array<{ metric_value: string; recorded_at: Date }> = await fastify.knex('printer_health')
        .where({ printer_id: printerId, metric_name: 'status' })
        .where('recorded_at', '>=', new Date(now - 60 * 60 * 1000))   // last 1h
        .orderBy('recorded_at', 'asc')
        .select('metric_value', 'recorded_at');
    if (recentStatuses.length >= 6) {
        let transitions = 0;
        for (let i = 1; i < recentStatuses.length; i++) {
            if (recentStatuses[i].metric_value !== recentStatuses[i - 1].metric_value) {
                transitions++;
            }
        }
        if (transitions >= 6) {
            anomalies.push({
                type: 'flapping',
                severity: 'medium',
                message: `Status flapped ${transitions} times in the last hour`,
                detail: { transitions, window: '1h' },
            });
        }
    }

    // 5) Slow response time — average > 5s in the last hour
    const slow: Array<{ avg_ms: string }> = await fastify.knex('printer_health')
        .where({ printer_id: printerId, metric_name: 'response_time_ms' })
        .where('recorded_at', '>=', new Date(now - 60 * 60 * 1000))
        .avg('CAST(metric_value AS INTEGER) as avg_ms');
    const avg = slow[0]?.avg_ms ? Number(slow[0].avg_ms) : null;
    if (avg !== null && avg > 5000) {
        anomalies.push({
            type: 'slow_response',
            severity: avg > 15000 ? 'high' : 'medium',
            message: `Average response time ${Math.round(avg)}ms in the last hour`,
            detail: { avgMs: avg },
        });
    }

    return anomalies;
}

// ────────────────────────────────────────────────────────────────────────────
// checkAlertThresholds — create alert rows when thresholds are breached.
// Threshold rule implemented here:
//   3+ consecutive 'offline' health records → 'printer_offline' alert
// (de-duped against an existing unresolved alert of the same type)
// ────────────────────────────────────────────────────────────────────────────
export async function checkAlertThresholds(
    fastify: FastifyInstance,
    printerId: number,
    currentStatus?: string
): Promise<{ alertCreated: boolean; reason?: string }> {
    const printer = await fastify.knex('printers').where({ id: printerId }).first();
    if (!printer) return { alertCreated: false, reason: 'printer_not_found' };

    // Pull the last 5 status records (newest first)
    const recent: Array<{ metric_value: string; recorded_at: Date }> = await fastify.knex('printer_health')
        .where({ printer_id: printerId, metric_name: 'status' })
        .orderBy('recorded_at', 'desc')
        .limit(5);

    const consecutiveOffline = recent.length >= 3 && recent.every(
        r => r.metric_value.toLowerCase() === 'offline' || r.metric_value.toLowerCase() === 'unhealthy'
    );

    if (consecutiveOffline) {
        // De-dupe: don't create a new alert if one is already open
        const existing = await fastify.knex('alerts')
            .where({ printer_id: printerId, type: 'printer_offline', is_resolved: false })
            .first();
        if (existing) return { alertCreated: false, reason: 'already_open' };

        await fastify.knex('alerts').insert({
            printer_id: printerId,
            client_id: printer.client_id || null,
            type: 'printer_offline',
            severity: 'critical',
            title: `Printer offline: ${printer.name}`,
            message: `Printer "${printer.name}" has reported 3+ consecutive offline health checks.`,
        });

        fastify.io?.emit('alert:created', {
            printer_id: printerId,
            type: 'printer_offline',
            severity: 'critical',
            title: `Printer offline: ${printer.name}`,
        });
        return { alertCreated: true };
    }

    // If the printer is back online, auto-resolve any open offline alert
    if (currentStatus && currentStatus.toLowerCase() === 'online') {
        await fastify.knex('alerts')
            .where({ printer_id: printerId, type: 'printer_offline', is_resolved: false })
            .update({ is_resolved: true, resolved_at: new Date() });
    }

    return { alertCreated: false };
}

// ────────────────────────────────────────────────────────────────────────────
// getHealthSummary — array summary for ALL printers (used by /api/health/printers)
// ────────────────────────────────────────────────────────────────────────────
export async function getHealthSummary(fastify: FastifyInstance): Promise<PrinterHealthSummary[]> {
    const printers: Array<{ id: number; name: string; status: string }> = await fastify.knex('printers')
        .whereRaw("(config->>'auto_removed') IS DISTINCT FROM 'true'")
        .select('id', 'name', 'status')
        .orderBy('name', 'asc');

    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const summaries: PrinterHealthSummary[] = [];
    for (const p of printers) {
        const [up24, up7, lastOfflineRow, jobAgg] = await Promise.all([
            calculateUptime(fastify, p.id, 1),
            calculateUptime(fastify, p.id, 7),
            fastify.knex('printer_health')
                .where({ printer_id: p.id, metric_name: 'status' })
                .whereIn('metric_value', ['offline', 'unhealthy'])
                .orderBy('recorded_at', 'desc')
                .first(),
            fastify.knex('print_jobs')
                .where('printer_id', p.id)
                .where('created_at', '>=', dayAgo)
                .groupBy('status')
                .select('status')
                .count('* as count'),
        ]);

        const total = jobAgg.reduce((s, r) => s + Number(r.count), 0);
        const failed = jobAgg
            .filter(r => ['failed', 'cancelled'].includes(r.status))
            .reduce((s, r) => s + Number(r.count), 0);
        const errorRate = total > 0 ? Math.round((failed / total) * 10000) / 100 : 0;

        summaries.push({
            printer_id: p.id,
            printer_name: p.name,
            status: p.status || 'offline',
            uptime_24h: up24.uptimePercent,
            uptime_7d: up7.uptimePercent,
            total_jobs_24h: total,
            error_rate_24h: errorRate,
            last_offline_at: lastOfflineRow?.recorded_at
                ? new Date(lastOfflineRow.recorded_at).toISOString()
                : null,
        });
    }
    return summaries;
}
