import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { findBestDriver, DriverLike } from '../utils/driver-matcher.js';

/**
 * Public sharing endpoint — no auth required.
 * Returns printer list with node info and aggregate stats
 * for the /sharing public page.
 */
export async function setupSharingRoutes(fastify: FastifyInstance) {

    /**
     * GET /api/sharing/data
     * Public endpoint returning printers, nodes, and stats.
     */
    fastify.get('/data', async (request: FastifyRequest, reply: FastifyReply) => {
        const knex = fastify.knex;

        // ── Driver catalog (cached at request-time; small table) ─────────
        // We need this to compute which driver SHOULD be assigned to each
        // printer so the public page can show a ✅ match / ❌ mismatch badge.
        const drivers: DriverLike[] = await knex('printer_drivers')
            .select('id', 'name', 'manufacturer');

        // ── Nodes ──────────────────────────────────────────────────────
        const nodes = await knex('clients')
            .select(
                'clients.id',
                'clients.hostname',
                'clients.ip_address',
                'clients.is_online',
                'clients.last_seen',
                'clients.client_version'
            )
            .orderBy('clients.hostname');

        const now = Date.now();
        const STALE_MS = 5 * 60 * 1000; // 5 minutes

        const nodesWithStatus = nodes.map((n: any) => ({
            id: n.id,
            hostname: n.hostname || `node-${n.id}`,
            ip_address: n.ip_address,
            is_online: n.is_online && n.last_seen && (now - new Date(n.last_seen).getTime()) < STALE_MS,
            version: n.client_version,
            last_seen: n.last_seen,
        }));

        const activeNodes = nodesWithStatus.filter((n: any) => n.is_online).length;
        const inactiveNodes = nodesWithStatus.length - activeNodes;

        // ── Printers ───────────────────────────────────────────────────
        const printers = await knex('printers')
            .leftJoin('clients', 'printers.client_id', 'clients.id')
            .leftJoin('printer_drivers', 'printers.driver_id', 'printer_drivers.id')
            .whereRaw("(printers.config->>'auto_removed') IS DISTINCT FROM 'true'")
            .select(
                'printers.id',
                'printers.name',
                'printers.status',
                'printers.raw_port',
                'printers.client_id',
                'printers.driver',
                'printers.driver_id',
                'printers.type',
                'printers.tags',
                'printers.slug',
                'printers.updated_at as printer_updated_at',
                'clients.hostname as node_hostname',
                'clients.ip_address as node_ip',
                'clients.is_online as node_is_online',
                'clients.last_seen as node_last_seen',
                'printer_drivers.name as driver_name',
                'printer_drivers.manufacturer as driver_manufacturer'
            )
            .orderBy('clients.hostname')
            .orderBy('printers.name');

        // ── Nodes without printers (orphan nodes) ──────────────────────
        const printerClientIds = printers.map((p: any) => p.client_id).filter(Boolean);
        const orphanNodesQuery = knex('clients')
            .select(
                'clients.id as client_id',
                'clients.hostname as node_hostname',
                'clients.ip_address as node_ip',
                'clients.is_online as node_is_online',
                'clients.last_seen as node_last_seen'
            )
            .orderBy('clients.hostname');

        if (printerClientIds.length > 0) {
            orphanNodesQuery.whereNotIn('clients.id', printerClientIds);
        }
        const orphanNodes = await orphanNodesQuery;

        const orphanPrinters = orphanNodes.map((n: any) => ({
            id: -(n.client_id),
            name: `${n.node_hostname} (tanpa printer)`,
            status: 'no_printer',
            raw_port: null,
            driver: null,
            type: 'placeholder',
            tags: [],
            node_hostname: n.node_hostname || 'Unknown',
            node_ip: n.node_ip,
            node_online: n.node_is_online && n.node_last_seen && (now - new Date(n.node_last_seen).getTime()) < STALE_MS,
            node_last_seen: n.node_last_seen || null,
            printer_updated_at: null,
            has_bat: false,
        }));

        const allPrinters = [...printers, ...orphanPrinters];

        const printersWithStatus = allPrinters.map((p: any) => {
            const nodeOnline = p.node_online !== undefined
                ? p.node_online
                : (p.node_is_online && p.node_last_seen && (now - new Date(p.node_last_seen).getTime()) < STALE_MS);

            // ── Driver match computation ──────────────────────────────
            // For real printers (not orphan/placeholder), compute whether
            // the currently assigned driver matches the best-match driver.
            let driver_match: any = null;
            if (p.id > 0 && drivers.length > 0) {
                const best = findBestDriver(p.name, drivers, 0.5);
                if (best) {
                    const currentDriverId = p.driver_id || null;
                    driver_match = {
                        expected_driver: best.driver.name,
                        expected_driver_id: best.driver.id,
                        score: Number(best.score.toFixed(2)),
                        confidence: best.confidence,
                        matched: currentDriverId === best.driver.id,
                        reasons: best.reasons,
                    };
                } else {
                    driver_match = { expected_driver: null, matched: false, score: 0, confidence: null, reasons: [] };
                }
            }

            return {
                id: p.id,
                name: p.name,
                slug: p.slug || p.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').substring(0, 200) || 'printer',
                status: p.status || 'unknown',
                raw_port: p.raw_port,
                driver: p.driver,
                driver_name: p.driver_name || null,
                type: p.type,
                tags: p.tags || [],
                node_hostname: p.node_hostname || 'Unassigned',
                node_ip: p.node_ip,
                node_online: nodeOnline,
                node_last_seen: p.node_last_seen || null,
                printer_updated_at: p.printer_updated_at || null,
                has_bat: !!p.raw_port,
                driver_match,
            };
        });

        const activePrinters = printersWithStatus.filter((p: any) => p.status === 'online').length;
        const inactivePrinters = printersWithStatus.length - activePrinters;

        // ── Stats: total pages printed ─────────────────────────────────
        const pagesResult = await knex('print_jobs')
            .where('status', 'completed')
            .sum('pages as total_pages')
            .first();
        const totalPages = Number(pagesResult?.total_pages) || 0;

        const nowDate = new Date();
        const nowMs = nowDate.getTime();
        const dayStart = new Date(nowMs - (nowDate.getHours() * 3600000 + nowDate.getMinutes() * 60000 + nowDate.getSeconds() * 1000));
        const weekStart = new Date(nowMs - ((nowDate.getDay()) * 86400000 + nowDate.getHours() * 3600000 + nowDate.getMinutes() * 60000 + nowDate.getSeconds() * 1000));
        const monthStart = new Date(nowDate.getFullYear(), nowDate.getMonth(), 1);

        const [dailyResult, weeklyResult, monthlyResult] = await Promise.all([
            knex('print_jobs').where('status', 'completed').where('created_at', '>=', dayStart.toISOString()).sum('pages as p').first(),
            knex('print_jobs').where('status', 'completed').where('created_at', '>=', weekStart.toISOString()).sum('pages as p').first(),
            knex('print_jobs').where('status', 'completed').where('created_at', '>=', monthStart.toISOString()).sum('pages as p').first(),
        ]);

        // ── Response ───────────────────────────────────────────────────
        return {
            nodes: nodesWithStatus,
            stats: {
                total_nodes: nodesWithStatus.length,
                active_nodes: activeNodes,
                inactive_nodes: inactiveNodes,
                total_printers: printersWithStatus.length,
                active_printers: activePrinters,
                inactive_printers: inactivePrinters,
                total_pages: totalPages,
                daily_pages: Number(dailyResult?.p) || 0,
                weekly_pages: Number(weeklyResult?.p) || 0,
                monthly_pages: Number(monthlyResult?.p) || 0,
            },
            printers: printersWithStatus,
        };
    });

    /**
     * POST /api/sharing/auto-detect
     * Public endpoint that matches each printer against the driver catalog
     * and assigns the best match when the current driver is different.
     * Mirrors the protected /api/drivers/auto-assign endpoint but is exposed
     * on the public sharing page (no JWT required).
     *
     * Body (all optional):
     *   - dry_run:  boolean (default false) — preview without writing
     *   - reassign: boolean (default true)   — also re-evaluate already-assigned printers
     *   - min_score: number 0..1 (default 0.5) — minimum confidence threshold
     *
     * Returns: { dry_run, total, assigned, matched, unmatched, results: [...] }
     */
    fastify.post('/auto-detect', async (request: FastifyRequest, reply: FastifyReply) => {
        const body = (request.body as any) || {};
        const dryRun = body.dry_run === true;
        const reassign = body.reassign !== false;   // default true
        const minScore = typeof body.min_score === 'number'
            ? Math.max(0, Math.min(1, body.min_score))
            : 0.5;

        const knex = fastify.knex;

        // Driver catalog (small table)
        const drivers: DriverLike[] = await knex('printer_drivers')
            .select('id', 'name', 'manufacturer');

        // Candidate printers
        let pq = knex('printers')
            .select('id', 'name', 'driver_id')
            .whereRaw("(config->>'auto_removed') IS DISTINCT FROM 'true'");
        if (!reassign) {
            pq = pq.whereNull('driver_id');
        }
        const printers = await pq;

        const results: any[] = [];
        let assigned = 0;
        let skipped = 0;

        for (const p of printers) {
            const match = findBestDriver(p.name, drivers, minScore);
            if (!match) {
                skipped++;
                results.push({ printer_id: p.id, printer_name: p.name, matched: false });
                continue;
            }
            const willChange = match.driver.id !== p.driver_id;
            results.push({
                printer_id: p.id,
                printer_name: p.name,
                matched: true,
                driver_id: match.driver.id,
                driver_name: match.driver.name,
                score: Number(match.score.toFixed(2)),
                confidence: match.confidence,
                reasons: match.reasons,
                changed: willChange,
            });
            if (!dryRun && willChange) {
                await knex('printers')
                    .where({ id: p.id })
                    .update({ driver_id: match.driver.id, updated_at: new Date() });
                assigned++;
                fastify.io?.emit('printer:driver-assigned', {
                    printerId: p.id,
                    driverId: match.driver.id,
                });
            }
        }

        return {
            dry_run: dryRun,
            total: printers.length,
            assigned,
            matched: results.filter((r) => r.matched).length,
            unmatched: skipped,
            results,
        };
    });
}
