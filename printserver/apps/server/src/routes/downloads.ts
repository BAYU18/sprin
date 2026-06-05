import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import fs from 'fs';
import path from 'path';

const CLIENT_AGENT_PATH = '/root/serverbot/print/printserver/apps/client-agent/dist/printserver-agent.exe';
const AGENT_PACKAGE_JSON = '/root/serverbot/print/printserver/apps/client-agent/package.json';

// Read the agent's baked-in version from its package.json (single source of
// truth — the same file the updater compares against). Cached and invalidated
// by mtime so each rebuild of the .exe is picked up automatically.
let cachedVersion: string | null = null;
let cachedPkgMtimeMs = 0;
function getAgentVersion(): string {
    try {
        const stat = fs.statSync(AGENT_PACKAGE_JSON);
        if (cachedVersion && stat.mtimeMs === cachedPkgMtimeMs) return cachedVersion;
        const pkg = JSON.parse(fs.readFileSync(AGENT_PACKAGE_JSON, 'utf8'));
        cachedVersion = String(pkg.version || '0.0.0');
        cachedPkgMtimeMs = stat.mtimeMs;
    } catch {
        cachedVersion = cachedVersion || '0.0.0';
    }
    return cachedVersion!;
}

export async function setupDownloadsRoutes(fastify: FastifyInstance) {
    fastify.get('/downloads/agent', async (request: FastifyRequest, reply: FastifyReply) => {
        if (!fs.existsSync(CLIENT_AGENT_PATH)) {
            fastify.log.error(`Agent not found at: ${CLIENT_AGENT_PATH}`);
            return reply.status(404).send({ error: 'Agent not found', path: CLIENT_AGENT_PATH });
        }

        const stat = fs.statSync(CLIENT_AGENT_PATH);
        const version = getAgentVersion();
        fastify.log.info(`Serving agent v${version}: ${CLIENT_AGENT_PATH} (${stat.size} bytes, mtime=${stat.mtime.toISOString()})`);

        const fileBuffer = fs.readFileSync(CLIENT_AGENT_PATH);
        const filename = `PrintServer-Agent-${version}-${stat.mtime.toISOString().slice(0,10)}.exe`;

        reply
            .header('Content-Type', 'application/octet-stream')
            .header('Content-Disposition', `attachment; filename="${filename}"`)
            .header('X-Agent-Version', version)
            .header('X-Agent-Build-Time', stat.mtime.toISOString())
            .header('Content-Length', stat.size)
            .send(fileBuffer);
    });

    fastify.get('/downloads/agent/info', async (request: FastifyRequest, reply: FastifyReply) => {
        if (!fs.existsSync(CLIENT_AGENT_PATH)) {
            return reply.status(404).send({ error: 'Agent not found' });
        }
        const stat = fs.statSync(CLIENT_AGENT_PATH);
        return {
            version: getAgentVersion(),
            size: stat.size,
            buildTime: stat.mtime.toISOString(),
            downloadUrl: '/downloads/agent'
        };
    });

    fastify.get('/downloads/client-agent.exe', async (request: FastifyRequest, reply: FastifyReply) => {
        return reply.redirect('/downloads/agent');
    });

    // PowerShell script to bulk-add all printers from server
    const PS_SCRIPT_PATH = '/root/serverbot/print/printserver/docs/add-all-printers.ps1';
    const SNIPPETS_PATH = '/root/serverbot/print/printserver/docs/printer-snippets.txt';
    const PS_UNIVERSAL_PATH = '/root/serverbot/print/printserver/docs/quick-add-universal.ps1';

    const serveScript = (path: string, filename: string) => async (request: FastifyRequest, reply: FastifyReply) => {
        if (!fs.existsSync(path)) {
            return reply.status(404).send({ error: 'File not found' });
        }
        const stat = fs.statSync(path);
        const fileBuffer = fs.readFileSync(path);
        reply
            .header('Content-Type', 'application/octet-stream')
            .header('Content-Disposition', `attachment; filename="${filename}"`)
            .header('Content-Length', stat.size)
            .send(fileBuffer);
    };

    fastify.get('/downloads/add-printers.ps1', serveScript(PS_SCRIPT_PATH, 'add-all-printers.ps1'));
    fastify.get('/downloads/quick-add-universal.ps1', serveScript(PS_UNIVERSAL_PATH, 'quick-add-universal.ps1'));

    fastify.get('/downloads/printer-snippets.txt', async (request: FastifyRequest, reply: FastifyReply) => {
        if (!fs.existsSync(SNIPPETS_PATH)) {
            return reply.status(404).send({ error: 'Snippets not found' });
        }
        const stat = fs.statSync(SNIPPETS_PATH);
        const fileBuffer = fs.readFileSync(SNIPPETS_PATH);
        reply
            .header('Content-Type', 'text/plain')
            .header('Content-Disposition', `attachment; filename="printer-snippets.txt"`)
            .header('Content-Length', stat.size)
            .send(fileBuffer);
    });
}
