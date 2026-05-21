import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import QRCode from 'qrcode';
import { logger } from '../utils/logger.js';

interface Printer {
    id: number;
    name: string;
    slug: string;
    type: string;
    share_name?: string;
    is_shared: boolean;
}

interface SetupPrinterInfo {
    id: number;
    name: string;
    slug: string;
    type: string;
    ippUrl: string;
    shareName?: string;
}

function generatePrinterSlug(name: string): string {
    return name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
}

export async function setupSetupRoutes(fastify: FastifyInstance) {
    fastify.get('/setup', async (request, reply) => {
        try {
            const serverIp = process.env.SERVER_IP || request.ip.replace('::ffff:', '') || 'localhost';
            const serverPort = process.env.PORT || '3000';
            const serverUrl = `http://${serverIp}:${serverPort}`;

            const printers = await fastify.knex<Printer>('printers')
                .select('id', 'name', 'slug', 'type', 'share_name', 'is_shared')
                .where({ is_shared: true });

            const setupPrinters: SetupPrinterInfo[] = printers.map(p => ({
                id: p.id,
                name: p.name,
                slug: p.slug || generatePrinterSlug(p.name),
                type: p.type || 'network',
                ippUrl: `${serverUrl}/ipp/print/${p.slug || generatePrinterSlug(p.name)}`,
                shareName: p.share_name
            }));

            let qrCodeDataUrl = '';
            try {
                qrCodeDataUrl = await QRCode.toDataURL(`${serverUrl}/setup`, {
                    width: 200,
                    margin: 2,
                    color: {
                        dark: '#2563eb',
                        light: '#ffffff'
                    }
                });
            } catch (qrError) {
                logger.warn({ err: qrError }, 'Failed to generate QR code');
            }

            const html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>PrintServer Pro - Printer Setup</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            padding: 20px;
        }
        .container {
            max-width: 900px;
            margin: 0 auto;
        }
        .header {
            text-align: center;
            color: white;
            margin-bottom: 30px;
        }
        .header h1 {
            font-size: 2.5rem;
            margin-bottom: 10px;
        }
        .header p {
            font-size: 1.1rem;
            opacity: 0.9;
        }
        .card {
            background: white;
            border-radius: 16px;
            box-shadow: 0 10px 40px rgba(0,0,0,0.2);
            padding: 30px;
            margin-bottom: 20px;
        }
        .server-info {
            display: flex;
            justify-content: space-between;
            align-items: center;
            background: #f8fafc;
            border-radius: 12px;
            padding: 20px;
            margin-bottom: 25px;
        }
        .server-info .info-group {
            text-align: center;
        }
        .server-info .label {
            font-size: 0.85rem;
            color: #64748b;
            margin-bottom: 5px;
        }
        .server-info .value {
            font-size: 1.4rem;
            font-weight: 600;
            color: #1e293b;
        }
        .qr-section {
            text-align: center;
            padding: 20px;
            background: #f8fafc;
            border-radius: 12px;
            margin-bottom: 25px;
        }
        .qr-section h3 {
            color: #1e293b;
            margin-bottom: 15px;
        }
        .qr-section img {
            border-radius: 8px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.1);
        }
        .qr-section p {
            margin-top: 10px;
            color: #64748b;
            font-size: 0.9rem;
        }
        h2 {
            color: #1e293b;
            margin-bottom: 20px;
            font-size: 1.5rem;
        }
        .printer-list {
            display: grid;
            gap: 15px;
            margin-bottom: 25px;
        }
        .printer-item {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 15px 20px;
            background: #f8fafc;
            border-radius: 10px;
            border-left: 4px solid #667eea;
        }
        .printer-item .name {
            font-weight: 600;
            color: #1e293b;
        }
        .printer-item .details {
            font-size: 0.85rem;
            color: #64748b;
        }
        .printer-item .ipp-url {
            font-family: 'Courier New', monospace;
            font-size: 0.8rem;
            color: #2563eb;
            background: #e0e7ff;
            padding: 4px 8px;
            border-radius: 4px;
        }
        .instructions-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 20px;
        }
        .os-card {
            padding: 20px;
            border-radius: 12px;
            background: #f8fafc;
        }
        .os-card h3 {
            display: flex;
            align-items: center;
            gap: 10px;
            margin-bottom: 15px;
            color: #1e293b;
        }
        .os-icon {
            width: 32px;
            height: 32px;
            border-radius: 8px;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 1.2rem;
        }
        .windows-icon { background: #0078d4; color: white; }
        .mac-icon { background: #000; color: white; }
        .ios-icon { background: #000; color: white; }
        .android-icon { background: #3ddc84; color: white; }
        .chrome-icon { background: #4285f4; color: white; }
        .os-card ol {
            padding-left: 20px;
            color: #475569;
            font-size: 0.9rem;
            line-height: 1.8;
        }
        .os-card .auto-note {
            margin-top: 10px;
            padding: 10px;
            background: #ecfdf5;
            border-radius: 8px;
            color: #059669;
            font-size: 0.85rem;
        }
        .manual-url {
            background: #fef3c7;
            border: 1px solid #f59e0b;
            border-radius: 12px;
            padding: 20px;
            margin-top: 20px;
        }
        .manual-url h3 {
            color: #92400e;
            margin-bottom: 10px;
        }
        .manual-url code {
            display: block;
            background: #fef9c3;
            padding: 10px;
            border-radius: 6px;
            font-family: 'Courier New', monospace;
            color: #854d0e;
            word-break: break-all;
            margin-top: 10px;
        }
        .footer {
            text-align: center;
            color: rgba(255,255,255,0.8);
            margin-top: 20px;
            font-size: 0.9rem;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>PrintServer Pro</h1>
            <p>Network Printer Setup - Mobility Print</p>
        </div>

        <div class="card">
            <div class="server-info">
                <div class="info-group">
                    <div class="label">Server IP</div>
                    <div class="value">${serverIp}</div>
                </div>
                <div class="info-group">
                    <div class="label">Port</div>
                    <div class="value">${serverPort}</div>
                </div>
                <div class="info-group">
                    <div class="label">Printers</div>
                    <div class="value">${setupPrinters.length}</div>
                </div>
            </div>

            ${qrCodeDataUrl ? `
            <div class="qr-section">
                <h3>Scan to Setup</h3>
                <img src="${qrCodeDataUrl}" alt="QR Code" width="200" height="200">
                <p>Scan with your phone camera to open setup page</p>
            </div>
            ` : ''}

            <h2>Available Printers</h2>
            <div class="printer-list">
                ${setupPrinters.length > 0 ? setupPrinters.map(p => `
                <div class="printer-item">
                    <div>
                        <div class="name">${escapeHtml(p.name)}</div>
                        <div class="details">Type: ${p.type} ${p.shareName ? `| Share: ${escapeHtml(p.shareName)}` : ''}</div>
                    </div>
                    <div class="ipp-url">${escapeHtml(p.ippUrl)}</div>
                </div>
                `).join('') : '<p style="color:#64748b;text-align:center;">No shared printers available</p>'}
            </div>

            <h2>Setup Instructions by OS</h2>
            <div class="instructions-grid">
                <div class="os-card">
                    <h3><span class="os-icon windows-icon">W</span> Windows</h3>
                    <ol>
                        <li>Open Settings → Printers & scanners</li>
                        <li>Click "Add a printer or scanner"</li>
                        <li>Click "The printer that I want isn't listed"</li>
                        <li>Select "Add a printer using TCP/IP address"</li>
                        <li>Enter server IP: <strong>${serverIp}</strong></li>
                        <li>Follow the on-screen wizard</li>
                    </ol>
                </div>

                <div class="os-card">
                    <h3><span class="os-icon mac-icon"></span> Mac</h3>
                    <ol>
                        <li>Open System Settings → Printers & Scanners</li>
                        <li>Click the + button</li>
                        <li>Select "IP" tab</li>
                        <li>Enter server IP: <strong>${serverIp}</strong></li>
                        <li>Select printer from list or enter IPP URL</li>
                        <li>Click "Add"</li>
                    </ol>
                </div>

                <div class="os-card">
                    <h3><span class="os-icon ios-icon">📱</span> iOS</h3>
                    <div class="auto-note">
                        ✓ AirPrint enabled - no setup needed!<br>
                        Simply select a printer when printing from any app. Printers are discovered automatically on the same network.
                    </div>
                </div>

                <div class="os-card">
                    <h3><span class="os-icon android-icon">🤖</span> Android</h3>
                    <ol>
                        <li>Open Settings → Printing</li>
                        <li>Enable "Default Print Service"</li>
                        <li>Go to Print Settings</li>
                        <li>Select PrintServer from available printers</li>
                        <li>Or install "PrintServer Pro" app for enhanced features</li>
                    </ol>
                </div>

                <div class="os-card">
                    <h3><span class="os-icon chrome-icon">C</span> Chromebook</h3>
                    <ol>
                        <li>Press Ctrl + P to open print dialog</li>
                        <li>Click "See more" if needed</li>
                        <li>Select an available network printer</li>
                        <li>Or click "Manage printers" to add manually</li>
                        <li>Printer should auto-discover via mDNS</li>
                    </ol>
                </div>

                <div class="os-card">
                    <h3><span class="os-icon" style="background:#6b7280;color:white;">🍎</span> Linux</h3>
                    <ol>
                        <li>Open system print settings</li>
                        <li>Click "Add" → "Network Printer"</li>
                        <li>Select "Internet Printing Protocol (IPP)"</li>
                        <li>Enter: <strong>${serverIp}</strong></li>
                        <li>Click forward and complete setup</li>
                    </ol>
                </div>
            </div>

            <div class="manual-url">
                <h3>Manual Printer Installation URL</h3>
                <p>If your system doesn't auto-discover printers, use this IPP URL directly:</p>
                <code>ipp://${serverIp}:${serverPort}/ipp/print/[printer-slug]</code>
                <p style="margin-top:10px;font-size:0.85rem;color:#92400e;">
                    Replace [printer-slug] with the printer name in lowercase with hyphens. 
                    Example: for "Office Printer" use <code>ipp://${serverIp}:${serverPort}/ipp/print/office-printer</code>
                </p>
            </div>
        </div>

        <div class="footer">
            PrintServer Pro Mobility Print | Server Time: ${new Date().toISOString()}
        </div>
    </div>
</body>
</html>`;

            return reply.type('text/html').send(html);
        } catch (error) {
            logger.error({ err: error }, 'Error generating setup page');
            return reply.status(500).send({ error: 'Failed to generate setup page' });
        }
    });

    fastify.get('/setup/printers.json', async (request, reply) => {
        try {
            const serverIp = process.env.SERVER_IP || request.ip.replace('::ffff:', '') || 'localhost';
            const serverPort = process.env.PORT || '3000';
            const serverUrl = `http://${serverIp}:${serverPort}`;

            const printers = await fastify.knex<Printer>('printers')
                .select('id', 'name', 'slug', 'type', 'share_name', 'is_shared')
                .where({ is_shared: true });

            const printerList = printers.map(p => {
                const slug = p.slug || generatePrinterSlug(p.name);
                return {
                    id: p.id,
                    name: p.name,
                    slug: slug,
                    type: p.type || 'network',
                    ippUrl: `ipp://${serverIp}:${serverPort}/ipp/print/${slug}`,
                    httpUrl: `${serverUrl}/ipp/print/${slug}`,
                    shareName: p.share_name || null
                };
            });

            return reply.send({
                success: true,
                serverIp,
                serverPort,
                serverUrl,
                timestamp: new Date().toISOString(),
                printers: printerList
            });
        } catch (error) {
            logger.error({ err: error }, 'Error fetching printer list');
            return reply.status(500).send({ 
                success: false, 
                error: 'Failed to fetch printer list' 
            });
        }
    });

    fastify.get('/setup/install', async (request, reply) => {
        try {
            const { printer } = request.query as { printer?: string };
            const serverIp = process.env.SERVER_IP || request.ip.replace('::ffff:', '') || 'localhost';
            const serverPort = process.env.PORT || '3000';

            if (!printer) {
                return reply.status(400).send({ 
                    error: 'Printer parameter is required',
                    usage: '/setup/install?printer=printer-slug'
                });
            }

            const ippUrl = `ipp://${serverIp}:${serverPort}/ipp/print/${encodeURIComponent(printer)}`;

            logger.info({ printer, ippUrl }, 'IPP installation URL requested');

            return reply.send({
                success: true,
                ippUrl,
                printer,
                instructions: {
                    windows: `Add a printer with TCP/IP address: ${ippUrl}`,
                    mac: `Add printer via IP: ${ippUrl}`,
                    linux: `lpadmin -p ${printer} -v ${ippUrl} -E`
                }
            });
        } catch (error) {
            logger.error({ err: error }, 'Error generating install URL');
            return reply.status(500).send({ 
                success: false, 
                error: 'Failed to generate install URL' 
            });
        }
    });
}

function escapeHtml(text: string): string {
    const map: Record<string, string> = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
    };
    return text.replace(/[&<>"']/g, m => map[m]);
}