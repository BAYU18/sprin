import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { generatePrinterSlug, ensureUniquePrinterSlug } from '../utils/printer-slug.js';
import { resolvePaperForPrinter, listPaperSizes } from '../services/paper-service.js';
import { cache, cacheKeys } from '../utils/cache.js';

const paperConfigSchema = z.object({
    size: z.string().min(1),
    orientation: z.enum(['portrait', 'landscape']).optional(),
    tray: z.string().optional(),
    customWidthMm: z.number().min(1).max(2000).optional(),
    customHeightMm: z.number().min(1).max(2000).optional(),
}).strict();

const printerSchema = z.object({
    name: z.string(),
    driver: z.string().optional(),
    port: z.string().optional(),
    type: z.enum(['network', 'usb', 'thermal', 'pdf']).default('network'),
    is_shared: z.boolean().default(true),
    share_name: z.string().optional(),
    is_default: z.boolean().default(false),
    group_id: z.number().optional(),
    config: z.any().optional()
});

const updatePrinterSchema = printerSchema.partial();

export async function setupPrintersRoutes(fastify: FastifyInstance) {
    fastify.get('/', async (request, reply) => {
        // Filter out soft-removed printers by default (auto-removed after
        // 15 min offline). Admin can opt-in with ?include_removed=1 to see
        // the full list including hidden ones (e.g. for cleanup UI).
        const { include_removed, group, tag, status: statusFilter } = request.query as any;
        // TIER-2 #1: cache only the default (no-filter) call. Filtered calls
        // are rare and dynamic — caching them is a footgun.
        const cacheable = !include_removed && !group && !tag && !statusFilter;
        const cacheKey = cacheKeys.printersList('default');

        if (cacheable) {
            const data = await cache.getOrSet(cacheKey, 60, async () => {
                return await fastify.knex('printers')
                    .leftJoin('printer_groups', 'printers.group_id', 'printer_groups.id')
                    .leftJoin('clients', 'printers.client_id', 'clients.id')
                    .leftJoin('printer_drivers', 'printers.driver_id', 'printer_drivers.id')
                    .select(
                        'printers.*',
                        'printer_groups.name as group_name',
                        'clients.hostname as client_hostname',
                        'clients.ip_address as client_ip',
                        'printer_drivers.name as driver_name',
                        'printer_drivers.manufacturer as driver_manufacturer',
                        'printer_drivers.is_builtin as driver_is_builtin'
                    )
                    .whereRaw("(printers.config->>'auto_removed') IS DISTINCT FROM 'true'")
                    .orderBy('printers.name', 'asc');
            });
            return data;
        }

        // Filtered path — no cache
        let q = fastify.knex('printers')
            .leftJoin('printer_groups', 'printers.group_id', 'printer_groups.id')
            .leftJoin('clients', 'printers.client_id', 'clients.id')
            .leftJoin('printer_drivers', 'printers.driver_id', 'printer_drivers.id')
            .select(
                'printers.*',
                'printer_groups.name as group_name',
                'clients.hostname as client_hostname',
                'clients.ip_address as client_ip',
                'printer_drivers.name as driver_name',
                'printer_drivers.manufacturer as driver_manufacturer',
                'printer_drivers.is_builtin as driver_is_builtin'
            );
        if (!include_removed || include_removed === '0' || include_removed === 'false') {
            q = q.whereRaw("(printers.config->>'auto_removed') IS DISTINCT FROM 'true'");
        }
        // TIER-1 #3: Filter by group name or group ID
        if (group) {
            const isNumeric = /^\d+$/.test(group);
            if (isNumeric) {
                q = q.where('printers.group_id', parseInt(group));
            } else {
                q = q.where('printer_groups.name', group);
            }
        }
        // TIER-1 #3: Filter by tag (uses GIN index)
        if (tag) {
            q = q.whereRaw('? = ANY(printers.tags)', [String(tag).toLowerCase()]);
        }
        // Optional status filter (online/offline)
        if (statusFilter) {
            q = q.where('printers.status', statusFilter);
        }
        const printers = await q.orderBy('printers.name', 'asc');
        return printers;
    });

    fastify.get('/:id', async (request, reply) => {
        const { id } = request.params as { id: string };

        const printer = await fastify.knex('printers')
            .where({ id })
            .first();

        if (!printer) {
            return reply.status(404).send({ error: 'Printer not found' });
        }

        const recentJobs = await fastify.knex('print_jobs')
            .where({ printer_id: id })
            .orderBy('created_at', 'desc')
            .limit(10);

        const health = await fastify.knex('printer_health')
            .where({ printer_id: id })
            .orderBy('recorded_at', 'desc')
            .limit(20);

        return { ...printer, recentJobs, health };
    });

    // GET /api/printers/removed — list soft-hidden printers (admin view)
    // These are printers that were auto-removed after 15 min offline and
    // are not currently visible in the main /api/printers list.
    fastify.get('/removed', async (request, reply) => {
        const removed = await fastify.knex('printers')
            .leftJoin('clients', 'printers.client_id', 'clients.id')
            .whereRaw("(printers.config->>'auto_removed') = 'true'")
            .select(
                'printers.*',
                'clients.hostname as client_hostname',
                'clients.ip_address as client_ip'
            )
            .orderBy('printers.updated_at', 'desc');
        return { count: removed.length, printers: removed };
    });

    // POST /api/printers/:id/restore — manually un-hide a printer
    // (e.g. admin wants to keep a printer visible even if it's offline)
    fastify.post('/:id/restore', async (request, reply) => {
        const { id } = request.params as { id: string };
        const printerId = parseInt(id);
        const printer = await fastify.knex('printers').where({ id: printerId }).first();
        if (!printer) return reply.status(404).send({ error: 'Printer not found' });

        const currentConfig = (printer.config as any) || {};
        delete currentConfig.auto_removed;
        delete currentConfig.auto_removed_at;

        await fastify.knex('printers')
            .where({ id: printerId })
            .update({
                config: Object.keys(currentConfig).length ? currentConfig : null,
                status: 'offline',  // explicitly offline until next heartbeat
                updated_at: new Date()
            });

        // TIER-2 #4: granular event for restored printer
        fastify.io?.emit('printer:patch', {
            id: printerId,
            status: 'offline',
            updated_at: new Date()
        });

        // Invalidate printers list cache
        await cache.invalidate(cacheKeys.printersList('default'));

        return { success: true, id: printerId };
    });

    fastify.post('/', async (request, reply) => {
        const body = printerSchema.parse(request.body);

        if (body.is_default) {
            await fastify.knex('printers').update({ is_default: false });
        }

        // Auto-generate unique slug if not provided
        const slug = await ensureUniquePrinterSlug(fastify.knex, generatePrinterSlug(body.name));

        const [printer] = await fastify.knex('printers')
            .insert({ ...body, slug })
            .returning('*');

        fastify.io?.emit('printer:created', printer);

        // Invalidate printers list cache
        await cache.invalidate(cacheKeys.printersList('default'));

        return printer;
    });

    fastify.put('/:id', async (request, reply) => {
        const { id } = request.params as { id: string };
        const body = updatePrinterSchema.parse(request.body);

        if (body.is_default) {
            await fastify.knex('printers').update({ is_default: false });
        }

        const [printer] = await fastify.knex('printers')
            .where({ id })
            .update(body)
            .returning('*');

        if (!printer) {
            return reply.status(404).send({ error: 'Printer not found' });
        }

        fastify.io?.emit('printer:patch', printer);

        // Invalidate printers list cache
        await cache.invalidate(cacheKeys.printersList('default'));

        return printer;
    });

    fastify.delete('/:id', async (request, reply) => {
        const { id } = request.params as { id: string };

        const deleted = await fastify.knex('printers')
            .where({ id })
            .delete();

        if (!deleted) {
            return reply.status(404).send({ error: 'Printer not found' });
        }

        // TIER-2 #4: granular event for deleted printer
        fastify.io?.emit('printer:removed', { id: parseInt(id) });

        // Invalidate printers list cache
        await cache.invalidate(cacheKeys.printersList('default'));

        return { success: true };
    });

    fastify.get('/:id/status', async (request, reply) => {
        const { id } = request.params as { id: string };
        const { printRouter } = fastify;

        const driver = printRouter.getDriver(parseInt(id));
        if (!driver) {
            return reply.status(404).send({ error: 'Printer driver not found' });
        }

        const status = await driver.getStatus();
        return status;
    });

    fastify.get('/:id/jobs', async (request, reply) => {
        const { id } = request.params as { id: string };
        const { page = 1, limit = 50, status } = request.query as any;

        let query = fastify.knex('print_jobs')
            .where({ printer_id: id })
            .orderBy('created_at', 'desc')
            .limit(limit)
            .offset((page - 1) * limit);

        if (status) {
            query = query.where({ status });
        }

        const jobs = await query;
        const [{ count }] = await fastify.knex('print_jobs')
            .where({ printer_id: id })
            .count('* as count');

        return { jobs, total: count, page, limit };
    });

    // GET /api/printers/:id/paper — get resolved effective paper config
    fastify.get('/:id/paper', async (request, reply) => {
        const { id } = request.params as { id: string };
        const printerId = parseInt(id);
        const printer = await fastify.knex('printers').where({ id: printerId }).first();
        if (!printer) return reply.status(404).send({ error: 'Printer not found' });

        const effective = await resolvePaperForPrinter(fastify.knex, printerId);
        const allSizes = await listPaperSizes(fastify.knex);
        const override = (printer.config as any)?.paper as any | undefined;

        return {
            override: override || null,
            effective,
            availableSizes: allSizes,
        };
    });

    // PUT /api/printers/:id/paper — set per-printer paper override
    // body: PaperConfig (see paper-service.ts)
    fastify.put('/:id/paper', async (request: any, reply) => {
        const { id } = request.params as { id: string };
        const printerId = parseInt(id);
        const paper = paperConfigSchema.parse(request.body);

        const printer = await fastify.knex('printers').where({ id: printerId }).first();
        if (!printer) return reply.status(404).send({ error: 'Printer not found' });

        // Validate the size name exists in the merged list
        const all = await listPaperSizes(fastify.knex);
        if (!all.find((p) => p.name === paper.size)) {
            return reply.status(400).send({ error: `Unknown paper size: ${paper.size}` });
        }

        // Merge into config (preserve other config keys)
        const currentConfig = (printer.config as any) || {};
        const newConfig = { ...currentConfig, paper };

    await fastify.knex('printers')
        .where({ id: printerId })
        .update({
            config: newConfig,
            updated_at: new Date()
        });

        // Invalidate printers list cache + emit event
        await cache.invalidate(cacheKeys.printersList('default'));
        fastify.io?.emit('printer:patch', {
            id: printerId,
            config: newConfig,
            updated_at: new Date()
        });

        // Return effective resolved config (so caller can see what will actually be used)
        const effective = await resolvePaperForPrinter(fastify.knex, printerId);

        return { override: paper, effective };
    });

    // DELETE /api/printers/:id/paper — clear per-printer paper override
    fastify.delete('/:id/paper', async (request, reply) => {
        const { id } = request.params as { id: string };
        const printerId = parseInt(id);
        const printer = await fastify.knex('printers').where({ id: printerId }).first();
        if (!printer) return reply.status(404).send({ error: 'Printer not found' });

        const currentConfig = (printer.config as any) || {};
        delete currentConfig.paper;

        await fastify.knex('printers')
            .where({ id: printerId })
            .update({
                config: Object.keys(currentConfig).length ? currentConfig : null,
                updated_at: new Date()
            });

        // Invalidate printers list cache + emit event
        await cache.invalidate(cacheKeys.printersList('default'));
        fastify.io?.emit('printer:patch', {
            id: printerId,
            config: Object.keys(currentConfig).length ? currentConfig : null,
            updated_at: new Date()
        });

        const effective = await resolvePaperForPrinter(fastify.knex, printerId);
        return { override: null, effective };
    });

    // POST /api/printers/:id/test-print — submit a dummy test print job
    fastify.post('/:id/test-print', async (request, reply) => {
        const { id } = request.params as { id: string };
        const printerId = parseInt(id);
        const printer = await fastify.knex('printers').where({ id: printerId }).first();
        if (!printer) return reply.status(404).send({ error: 'Printer not found' });

        if (!fastify.ippServer) {
            return reply.status(503).send({ error: 'IPP service not available' });
        }

        try {
            // Direct Socket.IO dispatch to the node (same path as live printing),
            // not the BullMQ queue — so we actually verify server → node → printer.
            const result = await fastify.ippServer.sendTestPrint(printerId);
            if (!result.success) {
                return reply.status(502).send(result);
            }
            return { success: true, ...result };
        } catch (error) {
            return reply.status(400).send({ error: (error as Error).message });
        }
    });

    // POST /api/printers/:id/clear-queue — cancel all active jobs for this printer
    fastify.post('/:id/clear-queue', async (request, reply) => {
        const { id } = request.params as { id: string };
        const printerId = parseInt(id);
        const printer = await fastify.knex('printers').where({ id: printerId }).first();
        if (!printer) return reply.status(404).send({ error: 'Printer not found' });

        const activeJobs = await fastify.knex('print_jobs')
            .where({ printer_id: printerId })
            .whereIn('status', ['waiting', 'queued', 'processing', 'printing']);

        let cancelledCount = 0;
        for (const job of activeJobs) {
            try {
                await fastify.printRouter.cancelJob(job.job_id);
                cancelledCount++;
            } catch (err) {
                await fastify.knex('print_jobs').where({ id: job.id }).update({ status: 'cancelled' });
                await fastify.knex('queues').where({ print_job_id: job.id }).delete();
                cancelledCount++;
            }
        }

        fastify.io?.emit('printer:queue-cleared', { printerId });
        return { success: true, cancelledCount };
    });
}