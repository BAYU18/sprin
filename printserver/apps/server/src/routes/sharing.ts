import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

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
            .whereRaw("(printers.config->>'auto_removed') IS DISTINCT FROM 'true'")
            .select(
                'printers.id',
                'printers.name',
                'printers.status',
                'printers.raw_port',
                'printers.client_id',
                'printers.driver',
                'printers.type',
                'printers.tags',
                'printers.updated_at as printer_updated_at',
                'clients.hostname as node_hostname',
                'clients.ip_address as node_ip',
                'clients.is_online as node_is_online',
                'clients.last_seen as node_last_seen'
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
            return {
                id: p.id,
                name: p.name,
                status: p.status || 'unknown',
                raw_port: p.raw_port,
                driver: p.driver,
                type: p.type,
                tags: p.tags || [],
                node_hostname: p.node_hostname || 'Unassigned',
                node_ip: p.node_ip,
                node_online: nodeOnline,
                node_last_seen: p.node_last_seen || null,
                printer_updated_at: p.printer_updated_at || null,
                has_bat: !!p.raw_port,
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
            },
            printers: printersWithStatus,
        };
    });
}
