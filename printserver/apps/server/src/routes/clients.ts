import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { generatePrinterSlug, ensureUniquePrinterSlug } from '../utils/printer-slug.js';
import { cache, cacheKeys } from '../utils/cache.js';

const clientSchema = z.object({
    hostname: z.string().optional(),
    name: z.string().optional(),
    ip_address: z.string().optional(),
    mac_address: z.string().optional(),
    os_version: z.string().optional(),
    client_version: z.string().optional(),
    secret_key: z.string().optional(),
    secretKey: z.string().optional(),
    printers: z.array(z.string()).optional(),
    capabilities: z.object({}).passthrough().optional(),
    platform: z.string().optional(),
    arch: z.string().optional(),
    memory: z.number().optional(),
    cpus: z.number().optional(),
    version: z.string().optional()
}).refine(data => data.hostname || data.name, {
    message: "Either hostname or name is required"
});

const heartbeatSchema = z.object({
    status: z.enum(['online', 'offline']).optional(),
    printers: z.array(z.object({
        name: z.string(),
        port: z.string().optional(),  // Port name (USB001, LPT1, network share path)
        status: z.string().optional(),
        jobs_in_queue: z.number().int().nonnegative().optional()
    })).optional(),
    jobs: z.any().optional()
});

// Derive the real client IP from the TCP connection. Normalizes the
// IPv4-mapped IPv6 form (::ffff:192.168.1.5 → 192.168.1.5) that Node emits on
// dual-stack sockets. This is the server's source of truth — far more reliable
// than the address the agent self-reports (which can be a link-local fe80::,
// a virtual adapter, or null).
function getConnectionIp(request: any): string | null {
    let ip: string = request.ip || request.socket?.remoteAddress || '';
    if (!ip) return null;
    // Strip IPv4-mapped IPv6 prefix
    if (ip.startsWith('::ffff:')) ip = ip.slice(7);
    // Loopback isn't useful as a node address
    if (ip === '::1' || ip === '127.0.0.1') return null;
    return ip;
}

// A "good" address is a real routable LAN address, not a link-local IPv6,
// loopback, or empty value.
function isUsableIp(a: string | null | undefined): boolean {
    if (!a) return false;
    if (/^fe80:/i.test(a)) return false;        // IPv6 link-local
    if (a === '::1' || a === '127.0.0.1') return false;
    if (a === '0.0.0.0' || a === '::') return false;
    return true;
}

// Pick the best IP to store: trust the agent's reported address only when it's
// usable; otherwise fall back to the real connection IP the server observed.
function resolveClientIp(reported: string | null | undefined, request: any): string | null {
    if (isUsableIp(reported)) return reported as string;
    const conn = getConnectionIp(request);
    return isUsableIp(conn) ? conn : (reported || null);
}

export async function setupClientsRoutes(fastify: FastifyInstance) {
    fastify.get('/', async (request, reply) => {
        const clients = await fastify.knex('clients')
            .select('*')
            .orderBy('hostname');

        return clients;
    });

    fastify.get('/:id', async (request, reply) => {
        const { id } = request.params as { id: string };

        const client = await fastify.knex('clients')
            .where({ id })
            .first();

        if (!client) {
            return reply.status(404).send({ error: 'Client not found' });
        }

        const printers = await fastify.knex('printers')
            .where({ client_id: id });

        const recentJobs = await fastify.knex('print_jobs')
            .where({ client_id: id })
            .orderBy('created_at', 'desc')
            .limit(10);

        // Aggregate job statistics for this node (all-time + today).
        const statusRows = await fastify.knex('print_jobs')
            .where({ client_id: id })
            .select('status')
            .count('* as count')
            .groupBy('status');

        const jobStats: Record<string, number> = {
            total: 0, completed: 0, failed: 0, printing: 0, pending: 0, cancelled: 0,
        };
        for (const row of statusRows as any[]) {
            const cnt = parseInt(row.count, 10) || 0;
            jobStats.total += cnt;
            const s = (row.status || '').toLowerCase();
            if (s in jobStats) jobStats[s] += cnt;
        }

        const [pagesAgg] = await fastify.knex('print_jobs')
            .where({ client_id: id })
            .sum({ pages: 'pages' })
            .sum({ pagesPrinted: 'pages_printed' });
        jobStats.totalPages = parseInt(pagesAgg?.pages as any, 10) || 0;
        jobStats.pagesPrinted = parseInt(pagesAgg?.pagesPrinted as any, 10) || 0;

        // Jobs submitted today (local server time).
        const startOfDay = new Date();
        startOfDay.setHours(0, 0, 0, 0);
        const [{ count: todayCount } = { count: 0 }] = await fastify.knex('print_jobs')
            .where({ client_id: id })
            .where('created_at', '>=', startOfDay)
            .count('* as count') as any[];
        jobStats.today = parseInt(todayCount as any, 10) || 0;

        return { ...client, printers, recentJobs, jobStats };
    });

    fastify.post('/register', async (request, reply) => {
        try {
            const raw = request.body as any;
            // Normalize field names (support both old and new agent formats)
            const hostname = raw.hostname || raw.name || 'unknown';
            const clientVersion = raw.client_version || raw.version || '1.0.0';
            const secretKey = raw.secret_key || raw.secretKey;
            const ipAddress = resolveClientIp(raw.ip_address, request);
            const osVersion = raw.os_version || raw.platform || null;

            const insertData = {
                hostname,
                ip_address: ipAddress,
                mac_address: raw.mac_address || null,
                os_version: osVersion,
                client_version: clientVersion,
            };

            // Shared-secret auth: only accept requests with the configured
            // CLIENT_SECRET (or NODE_SECRET as a fallback). This replaces JWT
            // for agent endpoints because agents can't get a JWT before they
            // register (catch-22). Set CLIENT_SECRET in .env — the same value
            // must be configured in the Windows agent installer.
            const expectedSecret = process.env.CLIENT_SECRET || process.env.NODE_SECRET;
            const providedSecret = secretKey || request.headers['x-node-secret'];
            if (expectedSecret && providedSecret && providedSecret !== expectedSecret) {
                return reply.status(401).send({ error: 'Invalid secret key' });
            }

            const existing = await fastify.knex('clients')
                .where('hostname', hostname)
                .first();

            let client;
            if (existing) {
                [client] = await fastify.knex('clients')
                    .where({ id: existing.id })
                    .update({
                        ip_address: ipAddress,
                        os_version: osVersion,
                        client_version: clientVersion,
                        is_online: true,
                        last_seen: new Date()
                    })
                    .returning('*');
            } else {
                const crypto = await import('crypto');
                const secret = crypto.randomBytes(16).toString('hex');

                [client] = await fastify.knex('clients')
                    .insert({
                        ...insertData,
                        secret_key: secret,
                        is_online: true,
                        last_seen: new Date()
                    })
                    .returning('*');
            }

            fastify.io?.emit('client:online', { clientId: client.id, hostname: client.hostname });

            // Return the per-client secret too so the agent can use it for
            // subsequent calls (X-Node-Secret header). Aliases both `nodeSecret`
            // (what the agent already reads) and `secret_key` (DB column name).
            return {
                ...client,
                nodeSecret: client.secret_key
            };
        } catch (error) {
            logger.error('[Clients] Registration error:', error);
            return reply.status(500).send({ error: 'Registration failed' });
        }
    });

    fastify.post('/:id/heartbeat', async (request, reply) => {
        const { id } = request.params as { id: string };

        // Shared-secret check: only accept the per-client secret OR the global
        // CLIENT_SECRET. Agents use their own nodeSecret (returned from /register)
        // so the server can attribute heartbeats to a specific client.
        const expectedGlobal = process.env.CLIENT_SECRET || process.env.NODE_SECRET;
        const providedSecret = request.headers['x-node-secret'];
        if (expectedGlobal && providedSecret && providedSecret !== expectedGlobal) {
            // Not the global secret — try to match against the per-client one.
            const clientRow = await fastify.knex('clients').where({ id }).first();
            if (!clientRow || clientRow.secret_key !== providedSecret) {
                return reply.status(401).send({ error: 'Invalid X-Node-Secret' });
            }
        }

        let body: z.infer<typeof heartbeatSchema>;
        try {
            body = heartbeatSchema.parse(request.body);
        } catch (error) {
            if (error instanceof z.ZodError) {
                return reply.status(400).send({ error: 'Invalid heartbeat payload', details: error.errors });
            }
            throw error;
        }

        const { status, printers, jobs } = body;

        // Refresh the stored IP from the live connection so nodes that
        // registered with a bad address (link-local fe80::, virtual adapter,
        // or null) get self-healed on their next heartbeat — no re-install or
        // re-register needed on the client.
        const connIp = getConnectionIp(request);
        const updateFields: any = {
            is_online: status === 'online',
            last_seen: new Date(),
            metadata: { printers, jobs }
        };
        if (isUsableIp(connIp)) {
            updateFields.ip_address = connIp;
        }

        await fastify.knex('clients')
            .where({ id })
            .update(updateFields);

        // Sync printer list from agent heartbeat
        if (Array.isArray(printers)) {
            // Network-share printer names look like:
            //   \\HOST\Printer Name
            //   //HOST/Printer Name
            //   smb://host/...
            // The Windows agent used to send these as "physical" printers when
            // it skipped the USB-only filter, which polluted the dashboard
            // with ghost network shares. Filter them out server-side as a
            // safety net — defense in depth.
            const BUILTIN_PATTERNS = [
                /^[\\/]{2}[^\\/].*/i,            // \\HOST\share or //HOST/share
                /^smb:/i,                         // smb://...
                /^http(s)?:\/\/[^/]+\/printers/i, // IPP/HTTP URL
                /microsoft print to pdf/i,
                /microsoft xps document writer/i,
                /onenote/i,
                /^fax$/i,
                /nitro pdf creator/i,
                /oneoff|redirected/i,             // "Redirected" pseudo-printer
            ];

            const isFiltered = (printer: any) => {
                if (typeof printer === 'string') {
                    // Legacy format: just a string name
                    return BUILTIN_PATTERNS.some(re => re.test(printer));
                }
                if (!printer || typeof printer !== 'object') return true;
                
                const name = printer.name || '';
                const port = printer.port || '';
                
                // Check both name and port against network-share patterns
                return BUILTIN_PATTERNS.some(re => 
                    re.test(name.trim()) || re.test(port.trim())
                );
            };

            // Normalize printers to objects and filter network shares
            const filteredPrinters = printers
                .map((p: any) => {
                    if (typeof p === 'string') return { name: p, port: 'UNKNOWN' };
                    return { name: p?.name || 'UNKNOWN', port: p?.port || 'UNKNOWN' };
                })
                .filter((p: any) => !isFiltered(p));

            const seen = new Set<string>();
            const processedNames: string[] = [];

            // Fetch this node's hostname once — used to build self-describing
            // slugs for NEW printers (e.g. epson-l3210-series-it99) so identical
            // printer models on different nodes get distinct, readable IPP URLs.
            // Existing printers keep their current slug (no rename — avoids
            // breaking already-installed client printer ports).
            const nodeRow = await fastify.knex('clients').where({ id }).first();
            const hostToken = generatePrinterSlug(nodeRow?.hostname || `node-${id}`)
                .replace(/-/g, '')      // collapse to compact token: "it-99" → "it99"
                .slice(0, 24) || `node${id}`;

            for (const printer of filteredPrinters) {
                const trimmedName = printer.name.trim();
                const key = trimmedName.toLowerCase();
                if (seen.has(key)) continue;
                seen.add(key);
                processedNames.push(trimmedName);

                const existing = await fastify.knex('printers')
                    .where({ client_id: id })
                    .whereRaw('LOWER(name) = ?', [key])
                    .first();

                if (existing) {
                    // Backfill slug if missing (older records before slug column was added)
                    const slug = existing.slug || await ensureUniquePrinterSlug(
                        fastify.knex,
                        generatePrinterSlug(trimmedName),
                        existing.id
                    );

                    // If the printer was previously auto-hidden (15 min offline
                    // rule), restore it now that the node is reporting it again.
                    const wasRemoved = (existing.config as any)?.auto_removed === 'true';
                    const existingConfig = (existing.config as any) || {};
                    if (wasRemoved) {
                        delete existingConfig.auto_removed;
                        delete existingConfig.auto_removed_at;
                        existingConfig.restored_at = new Date().toISOString();
                    }

                    const updatePayload: any = {
                        port: printer.port,
                        status: status === 'online' ? 'online' : 'offline',
                        slug,
                        updated_at: new Date()
                    };
                    if (wasRemoved) {
                        updatePayload.config = Object.keys(existingConfig).length
                            ? existingConfig : null;
                    }

                    await fastify.knex('printers')
                        .where({ id: existing.id })
                        .update(updatePayload);

                    if (wasRemoved) {
                        logger.info(`[Heartbeat] Restored auto-removed printer "${trimmedName}" (id=${existing.id}) — node back online`);
                    }
                } else {
                    // Auto-generate a self-describing unique slug for NEW printers:
                    // "<printer-name>-<host-token>" → epson-l3210-series-it99.
                    // ensureUniquePrinterSlug still appends -2/-3 in the rare case
                    // the same model exists twice on the SAME node.
                    const slug = await ensureUniquePrinterSlug(
                        fastify.knex,
                        `${generatePrinterSlug(trimmedName)}-${hostToken}`
                    );
                    await fastify.knex('printers')
                        .insert({
                            name: trimmedName,
                            driver: 'Unknown',
                            port: printer.port || 'NODE',
                            type: 'network',
                            is_shared: true,
                            status: status === 'online' ? 'online' : 'offline',
                            client_id: id,
                            slug,
                            created_at: new Date(),
                            updated_at: new Date()
                        });
                }
            }

            const printerNames = processedNames;

            // Mark printers no longer reported as offline
            await fastify.knex('printers')
                .where({ client_id: id })
                .whereNotIn('name', printerNames.map((n: string) => n.trim()))
                .update({ status: 'offline', updated_at: new Date() });

            // TIER-2 #1 FIX: heartbeat just mutated printer status/slug rows, so the
            // cached printers list (printers:list:default, 60s TTL) is now stale.
            // Without this, the dashboard shows offline (red) for up to 60s even
            // though the node is online — the exact "node RUNNING but printer red"
            // bug. Invalidate so the next GET /api/printers reloads fresh from DB.
            await cache.invalidate(cacheKeys.printersList('default'));
        }

        if (status === 'online') {
            fastify.io?.emit('client:heartbeat', { clientId: parseInt(id), status, printers });
        }

        return { success: true };
    });

    fastify.delete('/:id', async (request, reply) => {
        const { id } = request.params as { id: string };

        await fastify.knex('clients')
            .where({ id })
            .delete();

        fastify.io?.emit('client:offline', { clientId: parseInt(id) });

        return { success: true };
    });

    fastify.get('/online/count', async (request, reply) => {
        const [{ count }] = await fastify.knex('clients')
            .where({ is_online: true })
            .count('* as count');

        return { count };
    });
}

import { logger } from '../utils/logger.js';