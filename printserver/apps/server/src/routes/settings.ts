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
            port: parseInt(process.env.IPP_PORT || '631', 10)
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