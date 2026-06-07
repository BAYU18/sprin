import { FastifyInstance } from 'fastify';
import { z } from 'zod';

const groupSchema = z.object({
    name: z.string().min(1).max(100),
    description: z.string().optional(),
    settings: z.object({}).passthrough().optional()
});

const updateGroupSchema = groupSchema.partial();

export async function setupPrinterGroupsRoutes(fastify: FastifyInstance) {
    // ── LIST all groups (with printer count per group) ─────────────────────
    fastify.get('/', async (request, reply) => {
        const groups = await fastify.knex('printer_groups')
            .select(
                'printer_groups.*',
                fastify.knex.raw('(SELECT COUNT(*) FROM printers WHERE printers.group_id = printer_groups.id) AS printer_count')
            )
            .orderBy('printer_groups.name');

        return groups;
    });

    // ── GET single group with its printers ─────────────────────────────────
    fastify.get('/:id', async (request, reply) => {
        const { id } = request.params as { id: string };

        const group = await fastify.knex('printer_groups').where({ id }).first();
        if (!group) return reply.status(404).send({ error: 'Group not found' });

        const printers = await fastify.knex('printers')
            .where({ group_id: id })
            .select('id', 'name', 'slug', 'status', 'tags', 'driver', 'client_id', 'updated_at')
            .orderBy('name');

        return { ...group, printers };
    });

    // ── CREATE group ───────────────────────────────────────────────────────
    fastify.post('/', async (request, reply) => {
        const body = groupSchema.parse(request.body);

        try {
            const [group] = await fastify.knex('printer_groups')
                .insert({
                    name: body.name,
                    description: body.description || null,
                    settings: body.settings || {}
                })
                .returning('*');

            fastify.io?.emit('printer-group:created', { group });
            return group;
        } catch (err: any) {
            if (err.code === '23505') { // unique violation
                return reply.status(409).send({ error: 'A group with this name already exists' });
            }
            return reply.status(500).send({ error: err.message });
        }
    });

    // ── UPDATE group ───────────────────────────────────────────────────────
    fastify.put('/:id', async (request, reply) => {
        const { id } = request.params as { id: string };
        const body = updateGroupSchema.parse(request.body);

        const existing = await fastify.knex('printer_groups').where({ id }).first();
        if (!existing) return reply.status(404).send({ error: 'Group not found' });

        const updateData: any = {};
        if (body.name !== undefined) updateData.name = body.name;
        if (body.description !== undefined) updateData.description = body.description;
        if (body.settings !== undefined) updateData.settings = body.settings;
        updateData.updated_at = new Date();

        try {
            const [group] = await fastify.knex('printer_groups')
                .where({ id })
                .update(updateData)
                .returning('*');

            fastify.io?.emit('printer-group:updated', { group });
            return group;
        } catch (err: any) {
            if (err.code === '23505') {
                return reply.status(409).send({ error: 'A group with this name already exists' });
            }
            return reply.status(500).send({ error: err.message });
        }
    });

    // ── DELETE group (unassign printers first) ─────────────────────────────
    fastify.delete('/:id', async (request, reply) => {
        const { id } = request.params as { id: string };

        const printerCount = await fastify.knex('printers')
            .where({ group_id: id })
            .count('* as count')
            .first();

        if (parseInt(String(printerCount?.count || 0)) > 0) {
            // Unassign printers first
            await fastify.knex('printers')
                .where({ group_id: id })
                .update({ group_id: null });
        }

        const deleted = await fastify.knex('printer_groups')
            .where({ id })
            .del();

        if (!deleted) return reply.status(404).send({ error: 'Group not found' });

        fastify.io?.emit('printer-group:deleted', { id: parseInt(id) });
        return { success: true, printersUnassigned: parseInt(String(printerCount?.count || 0)) };
    });

    // ── ASSIGN printer to group + tags ─────────────────────────────────────
    // PATCH /api/printers/:id — also used for tag-only updates
    fastify.patch('/printers/:id/assign', async (request, reply) => {
        const { id } = request.params as { id: string };
        const body = z.object({
            group_id: z.number().int().nullable().optional(),
            tags: z.array(z.string()).optional()
        }).parse(request.body);

        const printer = await fastify.knex('printers').where({ id }).first();
        if (!printer) return reply.status(404).send({ error: 'Printer not found' });

        const updateData: any = { updated_at: new Date() };
        if (body.group_id !== undefined) updateData.group_id = body.group_id;
        if (body.tags !== undefined) {
            // Normalise tags: trim, dedupe, lowercase
            const cleaned = Array.from(new Set(
                body.tags
                    .map((t: string) => String(t).trim().toLowerCase())
                    .filter((t: string) => t.length > 0 && t.length <= 32)
            ));
            updateData.tags = cleaned;
        }

        await fastify.knex('printers').where({ id }).update(updateData);

        const updated = await fastify.knex('printers').where({ id }).first();
        fastify.io?.emit('printer:updated', { printer: updated });
        return updated;
    });

    // ── LIST all unique tags (for autocomplete) ────────────────────────────
    fastify.get('/tags/all', async (request, reply) => {
        const rows = await fastify.knex('printers')
            .select('tags')
            .whereNotNull('tags');

        const tagSet = new Set<string>();
        for (const r of rows) {
            if (Array.isArray(r.tags)) {
                for (const t of r.tags) tagSet.add(t);
            }
        }
        return Array.from(tagSet).sort();
    });
}
