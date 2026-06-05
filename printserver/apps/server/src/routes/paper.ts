import { FastifyInstance } from 'fastify';
import {
    listPaperSizes,
    getCustomPaperSizes,
    setCustomPaperSizes,
    getDefaultPaperName,
    setDefaultPaperName,
} from '../services/paper-service.js';
import { logger } from '../utils/logger.js';

export async function setupPaperRoutes(fastify: FastifyInstance) {
    // GET /api/paper — list built-in + custom paper sizes
    fastify.get('/paper', async (request, reply) => {
        const all = await listPaperSizes(fastify.knex);
        const defaultName = await getDefaultPaperName(fastify.knex);
        return { sizes: all, default: defaultName };
    });

    // GET /api/paper/custom — list only custom (user-defined) paper sizes
    fastify.get('/paper/custom', async (request, reply) => {
        return { custom: await getCustomPaperSizes(fastify.knex) };
    });

    // PUT /api/paper/custom — replace the whole custom list
    // body: { custom: [{ name, widthMm, heightMm }, ...] }
    fastify.put('/paper/custom', async (request: any, reply) => {
        const body = request.body as { custom: Array<{ name: string; widthMm: number; heightMm: number }> };
        if (!body || !Array.isArray(body.custom)) {
            return reply.status(400).send({ error: 'body.custom must be an array' });
        }
        // Validation
        const names = new Set<string>();
        for (const c of body.custom) {
            if (!c.name || typeof c.name !== 'string') {
                return reply.status(400).send({ error: 'each entry needs a string name' });
            }
            if (c.name.length > 40) {
                return reply.status(400).send({ error: `name too long (max 40 chars): ${c.name}` });
            }
            if (typeof c.widthMm !== 'number' || c.widthMm <= 0 || c.widthMm > 2000) {
                return reply.status(400).send({ error: `widthMm out of range for ${c.name} (1-2000)` });
            }
            if (typeof c.heightMm !== 'number' || c.heightMm <= 0 || c.heightMm > 2000) {
                return reply.status(400).send({ error: `heightMm out of range for ${c.name} (1-2000)` });
            }
            if (names.has(c.name.toLowerCase())) {
                return reply.status(400).send({ error: `duplicate name: ${c.name}` });
            }
            names.add(c.name.toLowerCase());
        }
        const saved = await setCustomPaperSizes(fastify.knex, body.custom);
        logger.info(`[Paper] Custom list updated, ${saved.length} entries`);
        return { custom: saved };
    });

    // POST /api/paper/custom — append a single custom size
    // body: { name, widthMm, heightMm }
    fastify.post('/paper/custom', async (request: any, reply) => {
        const body = request.body as { name: string; widthMm: number; heightMm: number };
        if (!body?.name || typeof body.widthMm !== 'number' || typeof body.heightMm !== 'number') {
            return reply.status(400).send({ error: 'name, widthMm, heightMm required' });
        }
        const existing = await getCustomPaperSizes(fastify.knex);
        if (existing.some((p) => p.name.toLowerCase() === body.name.toLowerCase())) {
            return reply.status(409).send({ error: `name already exists: ${body.name}` });
        }
        const next = [...existing, { name: body.name, widthMm: body.widthMm, heightMm: body.heightMm, builtin: false }];
        const saved = await setCustomPaperSizes(fastify.knex, next);
        logger.info(`[Paper] Added custom size ${body.name} (${body.widthMm}x${body.heightMm}mm)`);
        return { custom: saved };
    });

    // DELETE /api/paper/custom/:name — remove a single custom size
    fastify.delete('/paper/custom/:name', async (request: any, reply) => {
        const name = decodeURIComponent(request.params.name);
        const existing = await getCustomPaperSizes(fastify.knex);
        const next = existing.filter((p) => p.name !== name);
        if (next.length === existing.length) {
            return reply.status(404).send({ error: `not found: ${name}` });
        }
        const saved = await setCustomPaperSizes(fastify.knex, next);
        logger.info(`[Paper] Removed custom size ${name}`);
        return { custom: saved };
    });

    // GET /api/paper/default — get server-wide default paper size
    fastify.get('/paper/default', async (request, reply) => {
        return { default: await getDefaultPaperName(fastify.knex) };
    });

    // PUT /api/paper/default — set server-wide default paper size
    // body: { default: "A4" }
    fastify.put('/paper/default', async (request: any, reply) => {
        const body = request.body as { default: string };
        if (!body?.default) {
            return reply.status(400).send({ error: 'default (size name) required' });
        }
        try {
            const saved = await setDefaultPaperName(fastify.knex, body.default);
            logger.info(`[Paper] Default size set to ${saved}`);
            return { default: saved };
        } catch (e) {
            return reply.status(400).send({ error: (e as Error).message });
        }
    });
}
