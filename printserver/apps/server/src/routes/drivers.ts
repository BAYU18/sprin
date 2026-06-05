/**
 * PrintServer - Printer Driver Management API
 * CRUD for printer_drivers catalog + assignment to printers
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { logger } from '../utils/logger.js';

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
            usageMap.set(row.driver_id, parseInt(row.count as any));
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

    // ── Bulk assign drivers to printers by name match ───────────────────────
    fastify.post('/api/drivers/auto-assign', async (request: FastifyRequest, reply: FastifyReply) => {
        const body = z.object({
            match_strategy: z.enum(['name-contains', 'name-exact', 'manufacturer']).default('name-contains'),
        }).parse(request.body);

        const printers = await fastify.knex('printers')
            .select('id', 'name', 'driver_id')
            .whereNull('driver_id');

        const drivers = await fastify.knex('printer_drivers').select('*');

        let assigned = 0;
        for (const p of printers) {
            const pname = p.name.toLowerCase();
            let match = null;

            for (const d of drivers) {
                const dname = d.name.toLowerCase();
                if (body.match_strategy === 'name-exact' && pname === dname) {
                    match = d;
                    break;
                } else if (body.match_strategy === 'name-contains') {
                    // Match if printer name contains model number from driver
                    // e.g. "EPSON L3110 Series" contains "L3110"
                    const modelMatch = dname.match(/(l\d+|m\d+|pixma|laserjet|xpress|ecotank|lx-?\d+)/i);
                    if (modelMatch && pname.includes(modelMatch[0].toLowerCase())) {
                        match = d;
                        break;
                    }
                } else if (body.match_strategy === 'manufacturer') {
                    if (d.manufacturer && pname.includes(d.manufacturer.toLowerCase())) {
                        match = d;
                        break;
                    }
                }
            }

            if (match) {
                await fastify.knex('printers')
                    .where({ id: p.id })
                    .update({ driver_id: match.id, updated_at: new Date() });
                assigned++;
            }
        }

        logger.info(`[Drivers] Auto-assign: ${assigned}/${printers.length} printers matched`);
        return { assigned, total: printers.length, strategy: body.match_strategy };
    });
}
