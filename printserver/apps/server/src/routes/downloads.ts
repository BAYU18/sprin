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
    // Derive the server's API base URL (http://<host>:3000) from the incoming
    // request, so downloaded .bat installers always point at the IP/hostname the
    // user actually reached us on — never a hardcoded IP that breaks when the
    // server moves. Falls back to env SERVER_IP, then localhost.
    const deriveApiBase = (request: FastifyRequest): string => {
        const hostHeader = (request.headers['x-forwarded-host'] as string) || request.headers.host || '';
        // strip any port the browser used (dashboard :3001) — agents talk to API :3000
        const host = hostHeader.split(':')[0] || process.env.SERVER_IP || 'localhost';
        return `http://${host}:3000`;
    };

    // Serve a .bat/.ps1 from disk with the hardcoded server URL rewritten to the
    // request-derived API base. Keeps the on-disk file as a template.
    const serveScriptDynamic = (
        diskPath: string,
        downloadName: string,
        contentType = 'application/x-msdos-program'
    ) => async (request: FastifyRequest, reply: FastifyReply) => {
        if (!fs.existsSync(diskPath)) {
            return reply.status(404).send({ error: `${downloadName} not found` });
        }
        const apiBase = deriveApiBase(request);
        const raw = fs.readFileSync(diskPath, 'utf8');
        // Replace any hardcoded http://<ip-or-host>:3000 with the live API base.
        const body = raw.replace(/http:\/\/[0-9A-Za-z.\-]+:3000/g, apiBase);
        reply
            .header('Content-Type', contentType)
            .header('Content-Disposition', `attachment; filename="${downloadName}"`)
            .send(body);
    };

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

    const AGENT_INSTALLER_PATH = '/root/serverbot/print/printserver/apps/server/public/downloads/install-agent.bat';
    fastify.get('/downloads/install-agent.bat',
        serveScriptDynamic(AGENT_INSTALLER_PATH, 'Install-PrintServer-Agent.bat'));

    // Node Agent Manager — local management menu (status/start/stop/restart/uninstall)
    const AGENT_MANAGER_PATH = '/root/serverbot/print/printserver/apps/server/public/downloads/manage-agent.bat';
    fastify.get('/downloads/manage-agent.bat',
        serveScriptDynamic(AGENT_MANAGER_PATH, 'Manage-PrintServer-Agent.bat'));

    // Agent updater PowerShell script — does the heavy lifting for menu [9]
    const AGENT_UPDATER_PATH = '/root/serverbot/print/printserver/apps/server/public/downloads/update-agent.ps1';
    fastify.get('/downloads/update-agent.ps1',
        serveScriptDynamic(AGENT_UPDATER_PATH, 'update-agent.ps1', 'text/plain'));

    // PowerShell script to bulk-add all printers from server
    const PS_SCRIPT_PATH = '/root/serverbot/print/printserver/docs/add-all-printers.ps1';
    const SNIPPETS_PATH = '/root/serverbot/print/printserver/docs/printer-snippets.txt';
    const PS_UNIVERSAL_PATH = '/root/serverbot/print/printserver/docs/quick-add-universal.ps1';

    const serveScript = (filePath: string, filename: string) => async (request: FastifyRequest, reply: FastifyReply) => {
        if (!fs.existsSync(filePath)) {
            return reply.status(404).send({ error: 'File not found' });
        }
        const host = deriveApiBase(request).replace(/^https?:\/\//, '').split(':')[0];
        const raw = fs.readFileSync(filePath, 'utf8');
        // Rewrite hardcoded host references so the script targets the live server:
        //   - http://<host>:3000  → API base
        //   - $serverHost = "..." → PowerShell host var
        //   - "Server: <ip>:631"  → comment header
        const body = raw
            .replace(/http:\/\/[0-9A-Za-z.\-]+:3000/g, `http://${host}:3000`)
            .replace(/(\$server(?:Host)?\s*=\s*)"[^"]*"/g, `$1"${host}"`)
            .replace(/([0-9]{1,3}(?:\.[0-9]{1,3}){3}):631/g, `${host}:631`)
            .replace(/([0-9]{1,3}(?:\.[0-9]{1,3}){3}):3000/g, `${host}:3000`);
        reply
            .header('Content-Type', 'application/octet-stream')
            .header('Content-Disposition', `attachment; filename="${filename}"`)
            .send(body);
    };

    fastify.get('/downloads/add-printers.ps1', serveScript(PS_SCRIPT_PATH, 'add-all-printers.ps1'));
    fastify.get('/downloads/quick-add-universal.ps1', serveScript(PS_UNIVERSAL_PATH, 'quick-add-universal.ps1'));

    // Universal printer installer .bat — fetches the printer catalog, shows a
    // numbered menu, then installs the chosen printer (auto IPP port + correct
    // driver + verify). Served straight from disk like the other .bat files.
    const ADD_PRINTER_BAT = path.join(__dirname, '..', '..', 'public', 'downloads', 'add-printer.bat');
    fastify.get('/downloads/add-printer.bat',
        serveScriptDynamic(ADD_PRINTER_BAT, 'Add-PrintServer-Printer.bat'));

    // Rute Unduhan APK Android
    const ANDROID_APK_PATH = '/root/serverbot/print/printserver/apps/server/public/downloads/printserver.apk';
    fastify.get('/downloads/android-apk', async (request: FastifyRequest, reply: FastifyReply) => {
        if (!fs.existsSync(ANDROID_APK_PATH)) {
            // Jika file APK belum diupload oleh admin, return template/pesan error
            return reply.status(404).send({ 
                error: 'APK build is in progress or not found. Please upload printserver.apk to apps/server/public/downloads/.' 
            });
        }
        const stat = fs.statSync(ANDROID_APK_PATH);
        const fileBuffer = fs.readFileSync(ANDROID_APK_PATH);
        reply
            .header('Content-Type', 'application/vnd.android.package-archive')
            .header('Content-Disposition', 'attachment; filename="PrintServer-Mobile.apk"')
            .header('Content-Length', stat.size)
            .send(fileBuffer);
    });

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

    // Lightweight node-status probe used by the local manage-agent.bat to show a
    // real "waiting for server" progress bar after Start/Restart. Public (no JWT)
    // — same trust model as the other /downloads/* agent endpoints. Returns a
    // tiny JSON the .bat can grep without a JSON parser.
    // ?hostname=IT-99  →  { "online": true, "secondsAgo": 3, "lastSeen": "..." }
    fastify.get('/downloads/node-status', async (request: FastifyRequest, reply: FastifyReply) => {
        const { hostname } = request.query as { hostname?: string };
        if (!hostname) {
            return reply.status(400).send({ online: false, error: 'hostname query param required' });
        }
        try {
            const row = await (fastify as any).knex('clients')
                .whereRaw('LOWER(hostname) = ?', [hostname.toLowerCase()])
                .orderBy('last_seen', 'desc')
                .first();

            if (!row || !row.last_seen) {
                return reply.send({ online: false, registered: !!row, secondsAgo: null, lastSeen: null });
            }
            const secondsAgo = Math.max(0, Math.floor((Date.now() - new Date(row.last_seen).getTime()) / 1000));
            // Online requires BOTH a fresh heartbeat (<=60s) AND the is_online
            // flag still set. An explicit Stop (node-offline) clears is_online
            // immediately, so this reports offline right away instead of waiting
            // up to 60s for the heartbeat to go stale.
            const online = row.is_online !== false && secondsAgo <= 60;
            return reply.send({
                online,
                registered: true,
                secondsAgo,
                lastSeen: new Date(row.last_seen).toISOString(),
                ip: row.ip_address || null,
            });
        } catch (err: any) {
            return reply.status(500).send({ online: false, error: 'lookup failed' });
        }
    });

    // Explicit "I'm shutting down" signal from the local manage-agent.bat Stop
    // action. A force-killed agent can't report its own offline state, so the
    // server would otherwise wait up to 60s for the heartbeat to go stale.
    // This lets the .bat flip the node offline instantly for snappy dashboard
    // feedback. Public (no JWT) — same trust model as the other agent endpoints.
    // POST /downloads/node-offline?hostname=IT-99
    fastify.post('/downloads/node-offline', async (request: FastifyRequest, reply: FastifyReply) => {
        const { hostname } = request.query as { hostname?: string };
        if (!hostname) {
            return reply.status(400).send({ ok: false, error: 'hostname query param required' });
        }
        try {
            const updated = await (fastify as any).knex('clients')
                .whereRaw('LOWER(hostname) = ?', [hostname.toLowerCase()])
                .update({ is_online: false, updated_at: new Date() });

            // Notify dashboards in real time so the node flips offline instantly.
            try {
                const row = await (fastify as any).knex('clients')
                    .whereRaw('LOWER(hostname) = ?', [hostname.toLowerCase()])
                    .first();
                if (row) (fastify as any).io?.emit('client:offline', { clientId: row.id });
            } catch { /* socket emit is best-effort */ }

            return reply.send({ ok: updated > 0, offline: true });
        } catch (err: any) {
            return reply.status(500).send({ ok: false, error: 'update failed' });
        }
    });

    // Public printer catalog consumed by the local add-printer.bat installer.
    // Returns each shared printer with the data the .bat needs to build a valid
    // IPP port + Add-Printer call: slug (→ IPP resource path), owning node
    // hostname, live status, and whether that node is currently online. Plus the
    // server's own LAN IP/port so the .bat can assemble the full ipp:// URL
    // without the user hardcoding anything. Public (no JWT) — same trust model
    // as the other /downloads/* agent endpoints.
    fastify.get('/downloads/printer-list', async (request: FastifyRequest, reply: FastifyReply) => {
        try {
            const STALE_SECONDS = 90;
            const staleCutoff = Date.now() - STALE_SECONDS * 1000;
            const rows = await (fastify as any).knex('printers')
                .leftJoin('clients', 'printers.client_id', 'clients.id')
                .select(
                    'printers.name as name',
                    'printers.slug as slug',
                    'printers.status as status',
                    'clients.hostname as node',
                    'clients.is_online as node_is_online',
                    'clients.last_seen as node_last_seen',
                )
                .whereNotNull('printers.slug')
                .orderBy('clients.hostname')
                .orderBy('printers.name');

            // Server LAN IP/port for building ipp:// URLs. Prefer explicit env,
            // then the request host (only if it's a real LAN IP, not localhost),
            // then the known server LAN IP. IPP server listens on 631.
            const hostHeader = request.headers.host ? String(request.headers.host).split(':')[0] : '';
            const hostIsUsable = hostHeader
                && hostHeader !== 'localhost'
                && hostHeader !== '127.0.0.1'
                && !hostHeader.startsWith('::');
            const serverIp = process.env.SERVER_LAN_IP
                || process.env.PUBLIC_IP
                || (hostIsUsable ? hostHeader : '192.168.1.141');
            const ippPort = 631;

            const printers = rows.map((r: any) => {
                const fresh = r.node_last_seen ? new Date(r.node_last_seen).getTime() >= staleCutoff : false;
                const nodeOnline = r.node_is_online === true && fresh;
                return {
                    name: r.name,
                    slug: r.slug,
                    status: r.status,
                    node: r.node || 'unknown',
                    nodeOnline,
                    ippUrl: `ipp://${serverIp}:${ippPort}/printers/${r.slug}`,
                };
            });

            return reply.send({
                serverIp,
                ippPort,
                driverName: 'Microsoft IPP Class Driver',
                count: printers.length,
                printers,
            });
        } catch (err: any) {
            return reply.status(500).send({ error: 'list failed' });
        }
    });

    // Per-printer one-click installer .bat, generated on the fly for a specific
    // printer slug. Everything is hardcoded into the script (name, IPP port,
    // driver) so there is NO fragile client-side parsing — the client just
    // double-clicks and the right printer installs. Public (no JWT).
    // GET /downloads/printer-bat/:slug  → Install-<slug>.bat
    fastify.get('/downloads/printer-bat/:slug', async (request: FastifyRequest, reply: FastifyReply) => {
        const { slug } = request.params as { slug: string };
        if (!slug) {
            return reply.status(400).send({ error: 'slug required' });
        }
        try {
            const row = await (fastify as any).knex('printers')
                .leftJoin('clients', 'printers.client_id', 'clients.id')
                .leftJoin('printer_drivers', 'printers.driver_id', 'printer_drivers.id')
                .select(
                    'printers.name as name',
                    'printers.slug as slug',
                    'printers.raw_port as raw_port',
                    'clients.hostname as node',
                    'printer_drivers.name as driver',
                )
                .whereRaw('LOWER(printers.slug) = ?', [slug.toLowerCase()])
                .first();

            if (!row) {
                return reply.status(404).send({ error: 'printer not found' });
            }

            // Build the server IP the same way as the catalog endpoint.
            const hostHeader = request.headers.host ? String(request.headers.host).split(':')[0] : '';
            const hostIsUsable = hostHeader
                && hostHeader !== 'localhost'
                && hostHeader !== '127.0.0.1'
                && !hostHeader.startsWith('::');
            const serverIp = process.env.SERVER_LAN_IP
                || process.env.PUBLIC_IP
                || (hostIsUsable ? hostHeader : '192.168.1.141');
            // Opsi C: each printer has a dedicated RAW TCP port on the server.
            // The client installs a Standard TCP/IP (RAW) port → <serverIp>:<rawPort>
            // which routes deterministically to THIS printer server-side.
            const rawPort = Number(row.raw_port) || 9100;
            // Driver: use the model-specific driver assigned in the DB (via JOIN).
            // Fallback to the Epson ESC/P-R class driver which is what proved to
            // work for the LX-310 over TCP/IP. Generic IPP class driver is a last
            // resort and only valid if actually installed on the client PC.
            const driver = (row.driver && String(row.driver).trim()) || 'Epson ESC/P-R V4 Class Driver';
            // Sanitize for safe embedding in the .bat (printer names can contain
            // spaces/parens — fine inside quotes, but strip CR/LF, %, and /
            // (forward-slash breaks Windows Print Spooler name resolution).
            const safeName = String(row.name).replace(/[\r\n%/]/g, ' ').replace(/\s+/g, ' ').trim();
            // Windows port name convention for a Standard TCP/IP RAW port.
            const portName = `${serverIp}_${rawPort}`;

            const bat = [
                '@echo off',
                ':: ============================================================',
                ':: PrintServer Pro - Pasang Printer (auto-generated)',
                `:: Printer : ${safeName}`,
                `:: Original: ${row.name}`,
                `:: Node    : ${row.node || 'unknown'}`,
                `:: Port    : RAW ${serverIp}:${rawPort}`,
                ':: ============================================================',
                'setlocal EnableDelayedExpansion',
                `title Pasang Printer - ${safeName}`,
                '',
                `set "PRINTER_NAME=${safeName}"`,
                `set "SERVER_HOST=${serverIp}"`,
                `set "RAW_PORT=${rawPort}"`,
                `set "PORT_NAME=${portName}"`,
                `set "DRIVER=${driver}"`,
                '',
                ':: --- Pastikan hak Administrator ---',
                'net session >nul 2>&1',
                'if not !errorLevel! == 0 (',
                '    echo.',
                '    echo  [PERLU ADMIN] Klik kanan file ini, pilih "Run as administrator".',
                '    echo.',
                '    pause',
                '    exit /b 1',
                ')',
                '',
                'cls',
                'echo ==============================================================',
                'echo   MEMASANG PRINTER',
                'echo ==============================================================',
                'echo  Nama   : !PRINTER_NAME!',
                'echo  Port   : RAW !SERVER_HOST!:!RAW_PORT!',
                'echo  Driver : !DRIVER!',
                'echo --------------------------------------------------------------',
                'echo.',
                '',
                ':: --- [0/4] Test koneksi ke port RAW printer ---',
                'echo  [0/4] Menguji koneksi ke !SERVER_HOST!:!RAW_PORT!...',
                `powershell -NoProfile -Command "$t=Test-NetConnection -ComputerName '!SERVER_HOST!' -Port !RAW_PORT! -WarningAction SilentlyContinue; if($t.TcpTestSucceeded){ exit 0 } else { exit 1 }" >nul 2>&1`,
                'if not !errorLevel! == 0 (',
                '    echo        [GAGAL] Tidak bisa terhubung ke !SERVER_HOST!:!RAW_PORT!',
                '    echo.',
                '    echo  Pastikan:',
                '    echo   - Server PrintServer aktif',
                '    echo   - Port !RAW_PORT! tidak diblokir firewall',
                '    echo   - Komputer dalam jaringan yang sama',
                '    echo.',
                '    echo  Test manual: powershell "Test-NetConnection !SERVER_HOST! -Port !RAW_PORT!"',
                '    echo.',
                '    pause',
                '    exit /b 1',
                ')',
                'echo        [OK] Koneksi OK.',
                '',
                'echo  [1/4] Membuat Standard TCP/IP port (RAW)...',
                `powershell -NoProfile -Command "if (-not (Get-PrinterPort -Name '!PORT_NAME!' -ErrorAction SilentlyContinue)) { Add-PrinterPort -Name '!PORT_NAME!' -PrinterHostAddress '!SERVER_HOST!' -PortNumber !RAW_PORT! }" >nul 2>&1`,
                'if !errorLevel! == 0 (echo        [OK] Port siap.) else (echo        [!] Port mungkin sudah ada, lanjut.)',
                '',
                'echo  [2/4] Memasang printer...',
                `powershell -NoProfile -ExecutionPolicy Bypass -Command "try { $n='!PRINTER_NAME!'; $p='!PORT_NAME!'; $d='!DRIVER!'; $ex=Get-Printer -Name $n -ErrorAction SilentlyContinue; if($ex){ Remove-Printer -Name $n -ErrorAction SilentlyContinue }; Add-Printer -Name $n -DriverName $d -PortName $p -ErrorAction Stop; exit 0 } catch { Write-Error $_.Exception.Message; exit 1 }" 2>%TEMP%\\ps_addprn_err.txt`,
                'if !errorLevel! == 0 (',
                '    echo        [OK] Perintah pasang dikirim.',
                ') else (',
                '    echo        [GAGAL] Gagal memasang printer.',
                '    echo.',
                '    echo  Pesan error:',
                '    type %TEMP%\\ps_addprn_err.txt 2>nul',
                '    echo.',
                '    echo  Kemungkinan: driver "!DRIVER!" belum terpasang di PC ini.',
                '    echo  Pasang driver printer dulu, lalu jalankan ulang.',
                '    echo.',
                '    pause',
                '    exit /b 1',
                ')',
                '',
                'echo  [3/4] Mematikan bidirectional (hilangkan balon communication error)...',
                'rundll32 printui.dll,PrintUIEntry /Xs /n "!PRINTER_NAME!" EnableBIDI disable >nul 2>&1',
                'echo        [OK] Bidirectional dimatikan.',
                '',
                'echo  [4/4] Verifikasi...',
                'timeout /t 3 /nobreak >nul',
                `powershell -NoProfile -Command "if (Get-Printer -Name '!PRINTER_NAME!' -ErrorAction SilentlyContinue) { exit 0 } else { exit 1 }" >nul 2>&1`,
                'if !errorLevel! == 0 (',
                '    echo        [OK] Printer terpasang dan terverifikasi.',
                '    echo.',
                '    echo  ============================================================',
                '    echo   [SUKSES] "!PRINTER_NAME!" siap dipakai!',
                '    echo   Coba print test page dari Settings ^> Printers.',
                '    echo  ============================================================',
                ') else (',
                '    echo        [!] Printer tidak ditemukan setelah pemasangan.',
                '    echo.',
                '    echo  Kemungkinan penyebab:',
                '    echo   - Driver "Microsoft IPP Class Driver" tidak tersedia',
                '    echo   - Coba install manual: Settings ^> Printers ^> Add printer',
                '    echo   - Port: !IPP_URL!',
                '    echo   - Driver: !DRIVER!',
                ')',
                'echo.',
                'pause',
                'endlocal',
                'exit /b 0',
                '',
            ].join('\r\n');

            const safeFilename = `Install-${row.slug}.bat`.replace(/[^A-Za-z0-9._-]/g, '_');
            reply
                .header('Content-Type', 'application/x-msdos-program')
                .header('Content-Disposition', `attachment; filename="${safeFilename}"`)
                .header('Content-Length', Buffer.byteLength(bat))
                .send(bat);
        } catch (err: any) {
            return reply.status(500).send({ error: 'generate failed' });
        }
    });
}
