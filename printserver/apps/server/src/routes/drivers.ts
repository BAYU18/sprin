/**
 * PrintServer - Printer Driver Management API
 * CRUD for printer_drivers catalog + assignment to printers
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { logger } from '../utils/logger.js';
import { findBestDriver, scoreDriver, type DriverLike } from '../utils/driver-matcher.js';

const driverSchema = z.object({
    name: z.string().min(1).max(255),
    manufacturer: z.string().max(255).optional(),
    description: z.string().optional(),
    is_builtin: z.boolean().default(false),
    install_instructions: z.string().optional(),
    download_url: z.string().url().optional().or(z.literal('')),
});

const updateDriverSchema = driverSchema.partial();

const assignSchema = z.object({
    driver_id: z.number().int().nullable(),  // null to unassign
});

export async function setupDriversRoutes(fastify: FastifyInstance) {
    // ── List all drivers ────────────────────────────────────────────────────
    fastify.get('/api/drivers', async (request: FastifyRequest, reply: FastifyReply) => {
        const drivers = await fastify.knex('printer_drivers')
            .select('*')
            .orderBy('is_builtin', 'desc')  // built-in first
            .orderBy('name', 'asc');

        // Annotate with usage count
        const usage = await fastify.knex('printers')
            .select('driver_id')
            .count('* as count')
            .whereNotNull('driver_id')
            .groupBy('driver_id');

        const usageMap = new Map<number, number>();
        for (const row of usage) {
            usageMap.set(Number(row.driver_id), parseInt(row.count as any));
        }

        return drivers.map((d: any) => ({
            ...d,
            usage_count: usageMap.get(d.id) || 0,
        }));
    });

    // ── Get single driver ───────────────────────────────────────────────────
    fastify.get('/api/drivers/:id', async (request: FastifyRequest, reply: FastifyReply) => {
        const { id } = request.params as { id: string };
        const driver = await fastify.knex('printer_drivers').where({ id }).first();
        if (!driver) {
            return reply.status(404).send({ error: 'Driver not found' });
        }

        // Get printers using this driver
        const printers = await fastify.knex('printers')
            .select('id', 'name', 'slug', 'status', 'client_id')
            .where({ driver_id: id })
            .orderBy('name');

        return { ...driver, printers };
    });

    // ── Create new driver entry ─────────────────────────────────────────────
    fastify.post('/api/drivers', async (request: FastifyRequest, reply: FastifyReply) => {
        const body = driverSchema.parse(request.body);

        const existing = await fastify.knex('printer_drivers').where({ name: body.name }).first();
        if (existing) {
            return reply.status(409).send({ error: 'Driver with this name already exists', id: existing.id });
        }

        const [driver] = await fastify.knex('printer_drivers')
            .insert({
                ...body,
                download_url: body.download_url || null,
                updated_at: new Date(),
            })
            .returning('*');

        fastify.io?.emit('driver:created', driver);
        logger.info(`[Drivers] Created driver: ${driver.name}`);
        return driver;
    });

    // ── Upload new driver ZIP ────────────────────────────────────────────────
    fastify.post('/api/drivers/upload', async (request: FastifyRequest, reply: FastifyReply) => {
        const uploadSchema = z.object({
            name: z.string().min(1).max(255),
            manufacturer: z.string().max(255).optional(),
            description: z.string().optional(),
            install_instructions: z.string().optional(),
            filename: z.string().min(1),
            fileData: z.string() // base64 string
        });

        const body = uploadSchema.parse(request.body);

        const existing = await fastify.knex('printer_drivers').where({ name: body.name }).first();
        if (existing) {
            return reply.status(409).send({ error: 'Driver with this name already exists', id: existing.id });
        }

        // Simpan file ke disk
        const fs = await import('fs');
        const path = await import('path');
        const fileBuffer = Buffer.from(body.fileData, 'base64');
        
        // Buat nama file aman
        const safeFilename = `${Date.now()}_${body.filename.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
        // Path absolut ke public/drivers
        const uploadDir = path.resolve('/root/serverbot/print/printserver/apps/server/public/drivers');
        const fullPath = path.join(uploadDir, safeFilename);

        // Tulis file
        fs.writeFileSync(fullPath, fileBuffer);

        // Buat download url relative
        const downloadUrl = `/drivers/${safeFilename}`;

        const [driver] = await fastify.knex('printer_drivers')
            .insert({
                name: body.name,
                manufacturer: body.manufacturer || null,
                description: body.description || null,
                install_instructions: body.install_instructions || null,
                download_url: downloadUrl,
                is_builtin: false,
                updated_at: new Date(),
            })
            .returning('*');

        fastify.io?.emit('driver:created', driver);
        logger.info(`[Drivers] Uploaded and created driver: ${driver.name} -> ${downloadUrl}`);
        return driver;
    });

    // ── Update driver ───────────────────────────────────────────────────────
    fastify.put('/api/drivers/:id', async (request: FastifyRequest, reply: FastifyReply) => {
        const { id } = request.params as { id: string };
        const body = updateDriverSchema.parse(request.body);

        const [driver] = await fastify.knex('printer_drivers')
            .where({ id })
            .update({
                ...body,
                updated_at: new Date(),
            })
            .returning('*');

        if (!driver) {
            return reply.status(404).send({ error: 'Driver not found' });
        }

        fastify.io?.emit('driver:updated', driver);
        logger.info(`[Drivers] Updated driver: ${driver.name}`);
        return driver;
    });

    // ── Delete driver (only if not assigned to any printer) ─────────────────
    fastify.delete('/api/drivers/:id', async (request: FastifyRequest, reply: FastifyReply) => {
        const { id } = request.params as { id: string };

        const inUse = await fastify.knex('printers').where({ driver_id: id }).first();
        if (inUse) {
            return reply.status(409).send({
                error: 'Driver is in use by one or more printers. Unassign first.',
                printer_name: inUse.name,
            });
        }

        const deleted = await fastify.knex('printer_drivers').where({ id }).delete();
        if (deleted === 0) {
            return reply.status(404).send({ error: 'Driver not found' });
        }

        fastify.io?.emit('driver:deleted', { id: parseInt(id) });
        logger.info(`[Drivers] Deleted driver id=${id}`);
        return { success: true };
    });

    // ── Assign driver to printer ────────────────────────────────────────────
    fastify.put('/api/printers/:id/driver', async (request: FastifyRequest, reply: FastifyReply) => {
        const { id } = request.params as { id: string };
        const body = assignSchema.parse(request.body);

        // Verify printer exists
        const printer = await fastify.knex('printers').where({ id }).first();
        if (!printer) {
            return reply.status(404).send({ error: 'Printer not found' });
        }

        // Verify driver exists (if assigning)
        if (body.driver_id !== null) {
            const driver = await fastify.knex('printer_drivers').where({ id: body.driver_id }).first();
            if (!driver) {
                return reply.status(404).send({ error: 'Driver not found' });
            }
        }

        // Update printer's driver_id
        await fastify.knex('printers')
            .where({ id })
            .update({
                driver_id: body.driver_id,
                updated_at: new Date(),
            });

        // Return updated printer with joined driver
        const updated = await fastify.knex('printers')
            .leftJoin('printer_drivers', 'printers.driver_id', 'printer_drivers.id')
            .select(
                'printers.*',
                'printer_drivers.name as driver_name',
                'printer_drivers.manufacturer as driver_manufacturer',
                'printer_drivers.is_builtin as driver_is_builtin',
                'printer_drivers.install_instructions as driver_install_instructions'
            )
            .where('printers.id', id)
            .first();

        fastify.io?.emit('printer:driver-assigned', {
            printerId: parseInt(id),
            driverId: body.driver_id,
        });

        logger.info(`[Drivers] Assigned driver ${body.driver_id} to printer ${printer.name}`);
        return updated;
    });

    // ── Smart auto-assign: match printers to catalog drivers by name ────────
    // Uses the intelligent scoring matcher (model token + brand + overlap).
    // body.dry_run=true previews matches without writing.
    // body.reassign=true also re-evaluates printers that already have a driver.
    fastify.post('/api/drivers/auto-assign', async (request: FastifyRequest, reply: FastifyReply) => {
        const body = z.object({
            dry_run: z.boolean().default(false),
            reassign: z.boolean().default(false),
            min_score: z.number().min(0).max(1).default(0.5),
        }).parse(request.body ?? {});

        let pq = fastify.knex('printers')
            .select('id', 'name', 'driver_id')
            .whereRaw("(config->>'auto_removed') IS DISTINCT FROM 'true'");
        if (!body.reassign) {
            pq = pq.whereNull('driver_id');
        }
        const printers = await pq;
        const drivers: DriverLike[] = await fastify.knex('printer_drivers')
            .select('id', 'name', 'manufacturer');

        const results: any[] = [];
        let assigned = 0;
        let skipped = 0;

        for (const p of printers) {
            const match = findBestDriver(p.name, drivers, body.min_score);
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
            if (!body.dry_run && willChange) {
                await fastify.knex('printers')
                    .where({ id: p.id })
                    .update({ driver_id: match.driver.id, updated_at: new Date() });
                assigned++;
                fastify.io?.emit('printer:driver-assigned', {
                    printerId: p.id,
                    driverId: match.driver.id,
                });
            }
        }

        logger.info(`[Drivers] Auto-assign (${body.dry_run ? 'dry-run' : 'applied'}): ${assigned} assigned, ${skipped} unmatched of ${printers.length}`);
        return {
            dry_run: body.dry_run,
            total: printers.length,
            assigned,
            matched: results.filter((r) => r.matched).length,
            unmatched: skipped,
            results,
        };
    });

    // ── Suggest the best driver for ONE printer (preview, no write) ─────────
    fastify.get('/api/printers/:id/driver/suggest', async (request: FastifyRequest, reply: FastifyReply) => {
        const { id } = request.params as { id: string };
        const printer = await fastify.knex('printers').where({ id }).first();
        if (!printer) {
            return reply.status(404).send({ error: 'Printer not found' });
        }
        const drivers: DriverLike[] = await fastify.knex('printer_drivers')
            .select('id', 'name', 'manufacturer');

        // Rank all drivers so the UI can show top candidates.
        const ranked = drivers
            .map((d) => {
                const { score, reasons } = scoreDriver(printer.name, d);
                return { driver_id: d.id, driver_name: d.name, manufacturer: d.manufacturer, score: Number(score.toFixed(2)), reasons };
            })
            .filter((r) => r.score > 0)
            .sort((a, b) => b.score - a.score)
            .slice(0, 5);

        const best = ranked[0] && ranked[0].score >= 0.5 ? ranked[0] : null;
        return {
            printer_id: printer.id,
            printer_name: printer.name,
            current_driver_id: printer.driver_id,
            best_match: best,
            candidates: ranked,
        };
    });
}
