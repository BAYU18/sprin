import { FastifyInstance } from 'fastify';

export async function setupSettingsRoutes(fastify: FastifyInstance) {
    fastify.get('/', async (request, reply) => {
        const settings = await fastify.knex('settings').select('*');

        const settingsObj: Record<string, string> = {};
        for (const s of settings) {
            settingsObj[s.key] = s.value;
        }

        return settingsObj;
    });

    fastify.put('/', async (request, reply) => {
        const settings = request.body as Record<string, string>;

        for (const [key, value] of Object.entries(settings)) {
            await fastify.knex('settings')
                .where({ key })
                .update({ value });
        }

        return { success: true };
    });

    fastify.get('/notifications/channels', async (request, reply) => {
        return {
            email: {
                enabled: process.env.SMTP_HOST ? true : false,
                configured: !!(process.env.SMTP_USER && process.env.SMTP_PASS)
            },
            telegram: {
                enabled: !!process.env.TELEGRAM_BOT_TOKEN,
                configured: !!process.env.TELEGRAM_CHAT_ID
            },
            discord: {
                enabled: !!process.env.DISCORD_WEBHOOK_URL,
                configured: false
            }
        };
    });
}