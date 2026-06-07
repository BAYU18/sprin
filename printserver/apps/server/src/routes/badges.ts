import { FastifyInstance } from 'fastify';
import { cache } from '../utils/cache.js';

const BADGES_CACHE_KEY = 'badges:dashboard';
const BADGES_CACHE_TTL = 30;

/**
 * Aggregated badge counts for the dashboard sidebar.
 * Returns a single lightweight payload so the Sidebar doesn't have to fan
 * out to 4-5 separate endpoints every 30s.
 */
export async function setupBadgesRoutes(fastify: FastifyInstance) {
    fastify.get('/badges', async (request, reply) => {
        return await cache.getOrSet(BADGES_CACHE_KEY, BADGES_CACHE_TTL, async () => {
            const [
                alertsUnresolvedRow,
                jobsPendingRow,
                printersOfflineRow,
                clientsOnlineRow,
                clientsTotalRow,
            ] = await Promise.all([
                fastify.knex('alerts').where({ is_resolved: false }).count<{ count: string }[]>('id as count').first(),
                fastify.knex('print_jobs').where({ status: 'pending' }).count<{ count: string }[]>('id as count').first(),
                fastify.knex('printers')
                    .where({ status: 'offline' })
                    .whereRaw("(printers.config->>'auto_removed') IS DISTINCT FROM 'true'")
                    .count<{ count: string }[]>('id as count').first(),
                fastify.knex('clients').where({ is_online: true }).count<{ count: string }[]>('id as count').first(),
                fastify.knex('clients').count<{ count: string }[]>('id as count').first(),
            ]);

            const toNum = (row: any) => parseInt(row?.count ?? '0', 10) || 0;

            return {
                alerts_unresolved: toNum(alertsUnresolvedRow),
                jobs_pending: toNum(jobsPendingRow),
                printers_offline: toNum(printersOfflineRow),
                clients_online: toNum(clientsOnlineRow),
                clients_total: toNum(clientsTotalRow),
                ts: Date.now(),
            };
        });
    });
}
