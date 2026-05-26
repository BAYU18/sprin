import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import fs from 'fs';
import path from 'path';

const CLIENT_AGENT_PATH = '/root/serverbot/print/printserver/apps/client-agent/dist/printserver-agent.exe';

export async function setupDownloadsRoutes(fastify: FastifyInstance) {
    fastify.get('/downloads/agent', async (request: FastifyRequest, reply: FastifyReply) => {
        if (!fs.existsSync(CLIENT_AGENT_PATH)) {
            fastify.log.error(`Agent not found at: ${CLIENT_AGENT_PATH}`);
            return reply.status(404).send({ error: 'Agent not found', path: CLIENT_AGENT_PATH });
        }

        const stat = fs.statSync(CLIENT_AGENT_PATH);
        fastify.log.info(`Serving agent: ${CLIENT_AGENT_PATH} (${stat.size} bytes)`);
        
        // Read file into buffer and send
        const fileBuffer = fs.readFileSync(CLIENT_AGENT_PATH);

        reply
            .header('Content-Type', 'application/octet-stream')
            .header('Content-Disposition', 'attachment; filename="PrintServer-Agent-1.0.0.exe"')
            .header('Content-Length', stat.size)
            .send(fileBuffer);
    });

    fastify.get('/downloads/client-agent.exe', async (request: FastifyRequest, reply: FastifyReply) => {
        return reply.redirect('/downloads/agent');
    });
}
