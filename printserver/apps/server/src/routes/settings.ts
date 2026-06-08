import { FastifyInstance } from 'fastify';
import { exec } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

export async function setupSettingsRoutes(fastify: FastifyInstance) {
    // 1. Get list of backups
    fastify.get('/backup/list', async (request, reply) => {
        const backupDir = '/root/printserver-backups';
        if (!fs.existsSync(backupDir)) {
            return [];
        }
        try {
            const files = fs.readdirSync(backupDir)
                .filter(file => file.startsWith('printserver-backup-') && file.endsWith('.tar.gz'))
                .map(file => {
                    const filePath = path.join(backupDir, file);
                    const stats = fs.statSync(filePath);
                    return {
                        filename: file,
                        size: (stats.size / 1024).toFixed(2) + ' KB',
                        createdAt: stats.mtime
                    };
                })
                .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
            return files;
        } catch (err) {
            return reply.status(500).send({ error: 'Failed to read backups directory' });
        }
    });

    // 2. Trigger new backup
    fastify.post('/backup/trigger', async (request, reply) => {
        return new Promise((resolve, reject) => {
            exec('/root/serverbot/print/printserver/scripts/backup.sh', (error, stdout, stderr) => {
                if (error) {
                    console.error('Backup trigger error:', error);
                    reply.status(500).send({ error: 'Failed to execute backup script', details: stderr });
                    resolve(reply);
                    return;
                }
                
                // Find latest backup filename in stdout or read dir
                const backupDir = '/root/printserver-backups';
                const files = fs.readdirSync(backupDir)
                    .filter(file => file.startsWith('printserver-backup-') && file.endsWith('.tar.gz'))
                    .map(file => ({
                        name: file,
                        time: fs.statSync(path.join(backupDir, file)).mtime.getTime()
                    }))
                    .sort((a, b) => b.time - a.time);

                const latest = files.length > 0 ? files[0].name : 'unknown';
                resolve({ success: true, filename: latest, log: stdout });
            });
        });
    });

    // 3. Download a specific backup file
    fastify.get('/backup/download/:filename', async (request: any, reply) => {
        const { filename } = request.params;
        // Basic path traversal prevention
        const cleanFilename = path.basename(filename);
        const filePath = path.join('/root/printserver-backups', cleanFilename);

        if (!fs.existsSync(filePath)) {
            return reply.status(404).send({ error: 'Backup file not found' });
        }

        const stat = fs.statSync(filePath);
        const fileBuffer = fs.readFileSync(filePath);
        return reply
            .header('Content-Type', 'application/gzip')
            .header('Content-Disposition', `attachment; filename="${cleanFilename}"`)
            .header('Content-Length', stat.size)
            .send(fileBuffer);
    });

    // 4. Restore database + configs from a server-side backup file
    //    WARNING: destructive — drops & recreates the printserver database.
    fastify.post('/backup/restore', async (request: any, reply) => {
        const { filename } = request.body || {};
        if (!filename || typeof filename !== 'string') {
            return reply.status(400).send({ error: 'filename is required' });
        }

        // Strict allowlist: must match the backup naming pattern exactly
        const cleanFilename = path.basename(filename);
        if (!/^printserver-backup-.*\.tar\.gz$/.test(cleanFilename)) {
            return reply.status(400).send({ error: 'Invalid backup filename format' });
        }

        const backupDir = '/root/printserver-backups';
        const filePath = path.join(backupDir, cleanFilename);

        if (!fs.existsSync(filePath)) {
            return reply.status(404).send({ error: 'Backup file not found on server' });
        }

        // Run the restore script and stream stdout/stderr back
        return new Promise((resolve) => {
            exec(
                `/root/serverbot/print/printserver/scripts/restore.sh "${filePath}"`,
                { maxBuffer: 10 * 1024 * 1024 },
                (error, stdout, stderr) => {
                    if (error) {
                        console.error('Restore error:', error);
                        return resolve(reply.status(500).send({
                            error: 'Restore failed',
                            details: stderr || error.message,
                            log: stdout,
                        }));
                    }
                    resolve({
                        success: true,
                        filename: cleanFilename,
                        log: stdout,
                    });
                }
            );
        });
    });

    // 5. Upload a backup file from another VPS / local machine
    //    Saves the .tar.gz to /root/printserver-backups/ with a timestamp suffix
    //    so it appears in the list and can be restored via the existing flow.
    fastify.post('/backup/upload', async (request: any, reply) => {
        const backupDir = '/root/printserver-backups';
        if (!fs.existsSync(backupDir)) {
            fs.mkdirSync(backupDir, { recursive: true });
        }

        // Expect a single file field
        const data = await (request as any).file().catch(() => null);
        if (!data) {
            return reply.status(400).send({ error: 'No file uploaded. Use multipart/form-data with field "file".' });
        }

        // Validate filename extension
        const originalName = path.basename(data.filename || '');
        if (!originalName.toLowerCase().endsWith('.tar.gz')) {
            return reply.status(400).send({ error: 'File must have .tar.gz extension' });
        }

        // Collect the whole file in memory (backups are small — 13MB typical, 100MB hard cap)
        const chunks: Buffer[] = [];
        for await (const chunk of data.file) {
            chunks.push(chunk as Buffer);
        }
        const buffer = Buffer.concat(chunks);

        // Sanity check magic bytes (gzip: 0x1f 0x8b)
        if (buffer.length < 2 || buffer[0] !== 0x1f || buffer[1] !== 0x8b) {
            return reply.status(400).send({ error: 'File is not a valid gzip archive (bad magic bytes)' });
        }

        // Build a safe destination filename
        const ts = new Date().toISOString().replace(/[:.]/g, '-');
        const destName = `printserver-backup-UPLOADED-${ts}.tar.gz`;
        const destPath = path.join(backupDir, destName);

        try {
            fs.writeFileSync(destPath, buffer);
        } catch (err: any) {
            return reply.status(500).send({ error: 'Failed to write backup file', details: err.message });
        }

        return {
            success: true,
            filename: destName,
            size: buffer.length,
            originalName,
            message: 'Backup uploaded successfully. It now appears in the list below and can be restored.',
        };
    });

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

    fastify.get('/server-info', async (request, reply) => {
        return {
            name: process.env.SERVER_NAME || 'PrintServer Pro',
            ip: process.env.SERVER_IP || '127.0.0.1',
            // Agents register + heartbeat against the API port (PORT=3000),
            // NOT the IPP port (631). The Connect Agent page builds the agent's
            // server URL from this value, so it must be the API port.
            port: parseInt(process.env.PORT || '3000', 10)
        };
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