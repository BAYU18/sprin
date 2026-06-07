/**
 * PrintServer Node Agent - Windows Print Client
 * 
 * Standalone Node.js agent that runs on Windows machines to:
 * - Auto-discover local printers
 * - Watch spool directories for print files
 * - Connect to central PrintServer via WebSocket
 * - Execute print jobs via PowerShell/SumatraPDF
 * 
 * Usage: node src/index.js [--config config.json]
 */

const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { exec, spawn } = require('child_process');
const { promisify } = require('util');
const { EventEmitter } = require('events');

const { AutoUpdater, CURRENT_VERSION: AGENT_VERSION } = require('./updater.js');

// Try to load optional dependencies
let chokidar, axios, uuid, log, FormData;
try {
  chokidar = require('chokidar');
  axios = require('axios');
  uuid = require('uuid');
  log = require('electron-log');
  FormData = require('form-data');
} catch (e) {
  console.log('[WARN] Some dependencies not available, using fallback');
}

// ─── Configuration ───────────────────────────────────────────────────────────

const DEFAULT_CONFIG = {
  serverUrl: 'http://192.168.1.141:3000',
  checkInterval: 10000,
  spoolDirs: [
    'C:\\Windows\\System32\\spool\\printers',
    'C:\\Users\\*\\AppData\\Local\\Temp'
  ],
  autoStart: true,
  reconnectDelay: 5000,
  maxRetries: 10,
  logLevel: 'info',
  printerRefreshInterval: 60000,
  watchExtensions: ['.pdf', '.ps', '.prn', '.tif', '.tiff', '.png', '.jpg', '.jpeg']
};

// ─── Logger ──────────────────────────────────────────────────────────────────

class Logger {
  constructor(level = 'info') {
    this.level = level;
    this.levels = { debug: 0, info: 1, warn: 2, error: 3 };
  }

  format(level, msg, data) {
    const ts = new Date().toISOString();
    const pid = process.pid;
    const prefix = `[${ts}] [${level.toUpperCase()}] [PID:${pid}]`;
    let out = `${prefix} ${msg}`;
    if (data) out += ` ${JSON.stringify(data)}`;
    return out;
  }

  debug(msg, data) { if (this.levels[this.level] <= 0) console.log(this.format('debug', msg, data)); }
  info(msg, data) { if (this.levels[this.level] <= 1) console.log(this.format('info', msg, data)); }
  warn(msg, data) { if (this.levels[this.level] <= 2) console.log(this.format('warn', msg, data)); }
  error(msg, data) { if (this.levels[this.level] <= 3) console.error(this.format('error', msg, data)); }
}

const logger = new Logger(DEFAULT_CONFIG.logLevel);

// ─── PowerShell Helper ────────────────────────────────────────────────────────

function execPS(command) {
  return new Promise((resolve, reject) => {
    // Remove shell:true to avoid cmd.exe interpreting PowerShell pipeline syntax
    const ps = spawn('powershell', [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy', 'Bypass',
      '-Command', command
    ]);

    let stdout = '';
    let stderr = '';

    ps.stdout.on('data', (data) => { stdout += data.toString(); });
    ps.stderr.on('data', (data) => { stderr += data.toString(); });

    ps.on('close', (code) => {
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(stderr || `Exit code: ${code}`));
    });

    ps.on('error', reject);
  });
}

// ─── Printer Scanner ──────────────────────────────────────────────────────────

class PrinterScanner {
  constructor() {
    this.printers = [];
  }

  async scan() {
    logger.info('Scanning for printers (filtering strictly for USB/LPT/COM ports)...');
    const discovered = [];

    try {
      // Method 1: WMIC (most reliable on Windows)
      const wmicOutput = await execPS(
        `Get-WmiObject -Class Win32_Printer | Select-Object Name, PortName, Status, Default, PrinterStatus, DetectedErrorState, WorkOffline | ConvertTo-Json -Compress`
      );

      if (wmicOutput) {
        let printers = JSON.parse(wmicOutput);
        if (!Array.isArray(printers)) printers = [printers];

        for (const p of printers) {
          const name = p.Name || '';
          const portName = (p.PortName || '').toUpperCase();

          // Skip virtual printers
          if (
            name.includes('Microsoft Print to PDF') ||
            name.includes('Microsoft XPS Document Writer') ||
            name.includes('OneNote') ||
            name.includes('Fax') ||
            portName.startsWith('PORTPROMPT') ||
            portName.startsWith('NUL') ||
            portName.startsWith('SHRFAX')
          ) {
            continue;
          }

          // STRICT FILTER: Only physical ports (USB only)
          const isPhysicalPort = portName.startsWith('USB');
          if (!isPhysicalPort) {
            continue;
          }

          // Advanced Hardware Telemetry Parsing
          let advancedStatus = 'online';
          let errorMessage = null;
          
          if (p.WorkOffline || p.PrinterStatus === 7) {
             advancedStatus = 'offline';
          } else if (p.DetectedErrorState !== null && p.DetectedErrorState !== 0 && p.DetectedErrorState !== 2) {
             advancedStatus = 'error';
             const errorCodes = {
                 3: 'Low Paper', 4: 'Out of Paper', 5: 'Low Toner', 6: 'Out of Toner',
                 7: 'Door Open', 8: 'Paper Jam', 9: 'Offline', 10: 'Service Requested',
                 11: 'Output Bin Full', 12: 'Paper Problem'
             };
             errorMessage = errorCodes[p.DetectedErrorState] || 'Hardware Error';
          } else if (p.PrinterStatus === 6) {
             advancedStatus = 'error';
             errorMessage = 'Paused / Stopped';
          }

          discovered.push({
            name: p.Name,
            port: p.PortName || 'UNKNOWN',
            status: advancedStatus,
            isDefault: p.Default || false,
            driver: 'Windows Driver',
            type: 'local',
            telemetry: {
              errorStateCode: p.DetectedErrorState || 0,
              printerStatusCode: p.PrinterStatus || 0,
              hardwareError: errorMessage
            }
          });
        }
      }

    } catch (err) {
      logger.warn('WMIC scan failed, trying alternative method...', { error: err.message });
      
      // Fallback: Get-Printer via PowerShell
      try {
        const netOutput = await execPS(
          `Get-Printer | Select-Object Name, PortName, Status | ConvertTo-Json -Compress`
        );
        if (netOutput) {
          let printers = JSON.parse(netOutput);
          if (!Array.isArray(printers)) printers = [printers];
          for (const p of printers) {
            const name = p.Name || '';
            const portName = (p.PortName || '').toUpperCase();

            // Skip virtual printers
            if (
              name.includes('Microsoft Print to PDF') ||
              name.includes('Microsoft XPS Document Writer') ||
              name.includes('OneNote') ||
              name.includes('Fax') ||
              portName.startsWith('PORTPROMPT') ||
              portName.startsWith('NUL') ||
              portName.startsWith('SHRFAX')
            ) {
              continue;
            }

            // STRICT FILTER: Only physical ports (USB only)
            const isPhysicalPort = portName.startsWith('USB');
            if (!isPhysicalPort) {
              continue;
            }

            discovered.push({
              name: p.Name,
              port: p.PortName || 'UNKNOWN',
              status: p.Status === 'Ready' || p.Status === 'OK' ? 'online' : 'offline',
              isDefault: false,
              driver: 'Windows Driver',
              type: 'local'
            });
          }
        }
      } catch (e2) {
        logger.error('All printer scan methods failed', { error: e2.message });
      }
    }

    this.printers = discovered;
    logger.info(`Found ${discovered.length} physical printers`, { printers: discovered.map(p => p.name) });
    return discovered;
  }

  async getDefaultPrinter() {
    try {
      const output = await execPS(
        `(Get-ItemProperty -Path "HKCU:\\Software\\Microsoft\\Windows NT\\CurrentVersion\\Windows").Device`
      );
      if (output) {
        const name = output.split(',')[0].trim();
        return name || null;
      }
    } catch {
      return this.printers.find(p => p.isDefault)?.name || null;
    }
    return null;
  }

  getAll() {
    return this.printers;
  }

  getPrinters() {
    return this.printers;
  }
}

// ─── Spool Watcher ────────────────────────────────────────────────────────────

class SpoolWatcher extends EventEmitter {
  constructor(dirs, extensions) {
    super();
    this.dirs = dirs.filter(d => d.includes('*') || fs.existsSync(d.split('*')[0]));
    this.extensions = extensions;
    this.watcher = null;
    this.watchedFiles = new Set();
  }

  async start() {
    if (!chokidar) {
      logger.warn('chokidar not available, using polling fallback');
      this.startPolling();
      return;
    }

    const patterns = this.dirs.map(d => {
      if (d.includes('*')) {
        // Expand wildcards for user temp dirs
        const base = d.split('*')[0].trim();
        if (fs.existsSync(base)) {
          const entries = fs.readdirSync(base, { withFileTypes: true });
          return entries
            .filter(e => e.isDirectory())
            .map(e => path.join(base, e.name, '*'));
        }
        return null;
      }
      return d;
    }).filter(Boolean);

    logger.info('Starting spool watcher on:', patterns);

    this.watcher = chokidar.watch(patterns, {
      persistent: true,
      ignoreInitial: true,
      depth: 1,
      awaitWriteFinish: {
        stabilityThreshold: 2000,
        pollInterval: 100
      },
      ignorePermissionErrors: true
    });

    this.watcher.on('add', (filePath) => this.handleFile(filePath));
    this.watcher.on('error', (err) => logger.error('Watcher error', { error: err.message }));
  }

  handleFile(filePath) {
    if (this.watchedFiles.has(filePath)) return;
    
    const ext = path.extname(filePath).toLowerCase();
    if (!this.extensions.includes(ext)) return;

    const stat = fs.statSync(filePath);
    if (stat.size === 0) return;

    this.watchedFiles.add(filePath);
    logger.info('New print file detected', { file: filePath, size: stat.size });

    this.emit('file', {
      id: uuid?.v4() || `file-${Date.now()}`,
      fileName: path.basename(filePath),
      filePath: filePath,
      fileSize: stat.size,
      fileType: ext.replace('.', '').toUpperCase(),
      timestamp: new Date().toISOString()
    });

    // Clean up set after some time
    setTimeout(() => this.watchedFiles.delete(filePath), 60000);
  }

  startPolling() {
    logger.info('Using polling fallback for file detection');
    setInterval(() => {
      for (const dir of this.dirs) {
        try {
          let targetDirs = [dir];
          if (dir.includes('*')) {
            const base = dir.split('*')[0].trim();
            if (fs.existsSync(base)) {
              targetDirs = fs.readdirSync(base, { withFileTypes: true })
                .filter(e => e.isDirectory())
                .map(e => path.join(base, e.name));
            }
          }

          for (const targetDir of targetDirs) {
            if (!fs.existsSync(targetDir)) continue;
            
            const files = fs.readdirSync(targetDir)
              .filter(f => this.extensions.includes(path.extname(f).toLowerCase()))
              .map(f => path.join(targetDir, f));

            for (const file of files) {
              if (!this.watchedFiles.has(file)) {
                this.handleFile(file);
              }
            }
          }
        } catch (e) { /* skip inaccessible dirs */ }
      }
    }, 2000);
  }

  stop() {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
  }
}

// ─── Job Executor ─────────────────────────────────────────────────────────────

class JobExecutor {
  constructor() {
    this.sumatraPDFPath = this.findSumatraPDF();
  }

  findSumatraPDF() {
    const locations = [
      'C:\\Program Files\\SumatraPDF\\SumatraPDF.exe',
      'C:\\Program Files (x86)\\SumatraPDF\\SumatraPDF.exe',
      path.join(process.env.LOCALAPPDATA || '', 'SumatraPDF', 'SumatraPDF.exe'),
      'C:\\Windows\\System32\\spool\\tools\\SumatraPDF.exe'
    ];

    for (const loc of locations) {
      if (fs.existsSync(loc)) return loc;
    }
    return null;
  }

  async execute(job) {
    logger.info('Executing print job', { jobId: job.id, printer: job.printer, file: job.filePath });

    try {
      const paper = job.paper || null; // { size, orientation, tray, customWidthMm, customHeightMm }

      // Try SumatraPDF first (best for silent printing). SumatraPDF only
      // supports predefined paper names (A4/Letter/etc) — for custom sizes
      // we fall through to the PowerShell path which can set PaperSize by
      // exact millimetre dimensions.
      const sumatraSupportsCustom = false;
      if (this.sumatraPDFPath && fs.existsSync(job.filePath)
          && (!paper || this.isSumatraBuiltin(paper.size))) {
        const printerArg = job.printer ? `-printer "${job.printer}"` : '';
        const paperArg = paper ? `-paper "${this.mapSumatraPaper(paper.size)}"` : '';
        const settingsArg = paper && paper.orientation === 'landscape' ? '-landscape' : '';
        const cmd = `"${this.sumatraPDFPath}" -print-to ${printerArg} ${paperArg} ${settingsArg} "${job.filePath}"`;

        await new Promise((resolve, reject) => {
          exec(cmd, { shell: true }, (err, stdout, stderr) => {
            if (err) reject(err);
            else resolve();
          });
        });

        logger.info('Job printed via SumatraPDF', { jobId: job.id, paper: paper?.size });
        return { success: true, method: 'sumatra', paper: paper?.size };
      }

      // PowerShell path: supports exact custom dimensions via .NET PaperSize
      if (job.printer) {
        const psCmd = this.buildPowerShellPrintScript(job.filePath, job.printer, paper);
        await execPS(psCmd);
        logger.info('Job sent via PowerShell', { jobId: job.id, paper: paper?.size });
        return { success: true, method: 'powershell', paper: paper?.size };
      }

      // Last resort: default printer (no paper config applied)
      const psCmd = `Get-ChildItem "${path.dirname(job.filePath)}" -Filter "${path.basename(job.filePath)}" | ForEach-Object { Start-Process $_.FullName -Verb Print }`;
      await execPS(psCmd);
      return { success: true, method: 'default' };

    } catch (err) {
      logger.error('Job execution failed', { jobId: job.id, error: err.message });
      return { success: false, error: err.message };
    }
  }

  // Built-in names that SumatraPDF recognizes on its -paper flag
  isSumatraBuiltin(size) {
    if (!size) return true;
    const builtin = ['A2','A3','A4','A5','A6','Letter','Legal','Tabloid',
                     'Executive','Statement','B4','B5','Folio','F4','Custom'];
    return builtin.includes(size) || /^\d/.test(size); // numeric page-size also accepted
  }

  // Map our size name to SumatraPDF's expected name (mostly identity)
  mapSumatraPaper(size) {
    const map = { 'F4': 'Folio' }; // Sumatra uses "Folio" not "F4"
    return map[size] || size;
  }

  // Build a PowerShell script that prints a file to a specific printer with
  // a specific paper size. For .NET PaperSize, the dimensions must be in
  // 1/100 inch units (1mm = 3.937 1/100-inch).
  buildPowerShellPrintScript(filePath, printerName, paper) {
    const escPath = filePath.replace(/'/g, "''");
    const escPrinter = printerName.replace(/'/g, "''");

    // If no paper config, use printer default
    if (!paper || !paper.size) {
      return `Start-Process -FilePath '${escPath}' -Verb PrintTo -ArgumentList '${escPrinter}' -WindowStyle Hidden`;
    }

    // mm -> 1/100 inch
    const widthMm = paper.customWidthMm || this.builtinWidth(paper.size);
    const heightMm = paper.customHeightMm || this.builtinHeight(paper.size);
    const widthHi = widthMm ? Math.round((widthMm / 25.4) * 100) : null;
    const heightHi = heightMm ? Math.round((heightMm / 25.4) * 100) : null;
    const landscape = paper.orientation === 'landscape';

    if (!widthHi || !heightHi) {
      // Fall back to size name lookup
      return `
Add-Type -AssemblyName System.Drawing
$printDoc = New-Object System.Drawing.Printing.PrintDocument
$printDoc.PrinterSettings.PrinterName = '${escPrinter}'
$paperName = '${paper.size.replace(/'/g, "''")}'
try {
  $ps = [System.Drawing.Printing.PrinterSettings]::InstalledPrinters |
    ForEach-Object { $_.ToString() } | Where-Object { $_ -eq $printDoc.PrinterSettings.PrinterName } | Select-Object -First 1
  $sizes = $printDoc.PrinterSettings.PaperSizes | Where-Object { $_.PaperName -eq $paperName }
  if ($sizes) { $printDoc.DefaultPageSettings.PaperSize = $sizes[0] }
} catch { }
$printDoc.DocumentName = [System.IO.Path]::GetFileName('${escPath}')
$printDoc.Print()
$printDoc.Dispose()
`;
    }

    return `
Add-Type -AssemblyName System.Drawing
$printDoc = New-Object System.Drawing.Printing.PrintDocument
$printDoc.PrinterSettings.PrinterName = '${escPrinter}'

# Custom paper size: ${paper.size} (${widthMm}x${heightMm}mm)
$customW = ${widthHi}    # 1/100 inch
$customH = ${heightHi}
$isLandscape = $${landscape}

# Find or create matching PaperSize
$existing = $printDoc.PrinterSettings.PaperSizes | Where-Object {
  $_.Width -eq $customW -and $_.Height -eq $customH
} | Select-Object -First 1

if ($existing) {
  $printDoc.DefaultPageSettings.PaperSize = $existing
} else {
  $customPaper = New-Object System.Drawing.Printing.PaperSize('${paper.size.replace(/'/g, "''")}', $customW, $customH)
  $printDoc.DefaultPageSettings.PaperSize = $customPaper
}

if ($isLandscape) { $printDoc.DefaultPageSettings.Landscape = $true }

$printDoc.DocumentName = [System.IO.Path]::GetFileName('${escPath}')
$printDoc.Print()
$printDoc.Dispose()
`;
  }

  // Built-in paper dimensions (mm). Mirrors server/paper-service.ts.
  builtinWidth(name) {
    const m = { 'A3':297,'A4':210,'A5':148,'A6':105,'B4':257,'B5':182,
                'Letter':215.9,'Legal':215.9,'Tabloid':279.4,'Executive':184.15,
                'Folio':210,'F4':215.9,'Statement':139.7,
                'Kertas Kwitansi':210,'Kertas SEP':210.7,'Kertas Label Besar':60.5,'Kertas Label Kecil':60.5 };
    return m[name] || null;
  }
  builtinHeight(name) {
    const m = { 'A3':420,'A4':297,'A5':210,'A6':148,'B4':364,'B5':257,
                'Letter':279.4,'Legal':355.6,'Tabloid':431.8,'Executive':266.7,
                'Folio':330,'F4':330.2,'Statement':215.9,
                'Kertas Kwitansi':139.5,'Kertas SEP':90.7,'Kertas Label Besar':50,'Kertas Label Kecil':20 };
    return m[name] || null;
  }

  async listPrinters() {
    const scanner = new PrinterScanner();
    return await scanner.scan();
  }
}

// ─── API Client ────────────────────────────────────────────────────────────────

class APIClient {
  constructor(baseUrl) {
    this.baseUrl = baseUrl;
    this.clientId = null;
    this.secretKey = '';
    this.nodeSecret = '';
  }

  async register(nodeInfo) {
    try {
      const response = await axios.post(`${this.baseUrl}/api/clients/register`, {
        hostname: nodeInfo.hostname,
        ip_address: nodeInfo.ip_address || null,
        mac_address: nodeInfo.mac_address || null,
        os_version: `${os.platform()} ${os.release()}`.trim(),
        client_version: AGENT_VERSION
      }, { timeout: 10000 });

      if (response.data?.id) {
        this.clientId = response.data.id;
        this.nodeSecret = response.data.nodeSecret || '';
        logger.info('Registered with central server', { clientId: this.clientId });
        return response.data;
      }
      throw new Error('Invalid registration response');
    } catch (err) {
      logger.error('Registration failed', { error: err.message });
      throw err;
    }
  }

  async heartbeat(printers = []) {
    if (!this.clientId) return;

    try {
      await axios.post(`${this.baseUrl}/api/clients/${this.clientId}/heartbeat`, {
        status: 'online',
        printers,
        jobsInQueue: 0,
        timestamp: new Date().toISOString()
      }, { timeout: 5000 });
    } catch (err) {
      logger.warn('Heartbeat failed', { error: err.message });
    }
  }

  async uploadJob(job) {
    try {
      const form = new FormData();
      form.append('file', fs.createReadStream(job.filePath));
      form.append('metadata', JSON.stringify({
        fileName: job.fileName,
        fileType: job.fileType,
        sourceApp: job.sourceApp || 'Unknown',
        user: job.user || os.userInfo().username
      }));

      const response = await axios.post(`${this.baseUrl}/api/jobs/submit`, form, {
        headers: { ...form.getHeaders() },
        timeout: 30000
      });

      logger.info('Job uploaded', { jobId: response.data?.jobId });
      return response.data;
    } catch (err) {
      logger.error('Job upload failed', { error: err.message });
      throw err;
    }
  }

  async pollJobs() {
    if (!this.clientId) return [];

    try {
      const response = await axios.get(
        `${this.baseUrl}/api/clients/${this.clientId}/jobs`,
        { timeout: 5000 }
      );
      return response.data?.jobs || [];
    } catch (err) {
      return [];
    }
  }
}

// ─── WebSocket Client (Socket.IO) ─────────────────────────────────────────────

class WebSocketClient extends EventEmitter {
  constructor(url) {
    super();
    this.url = url;
    this.connected = false;
    this.socket = null;
    this.reconnectTimer = null;
    this.executor = null; // injected from PrintServerAgent
  }

  setExecutor(executor) {
    this.executor = executor;
  }

  connect() {
    try {
      const { io } = require('socket.io-client');
      this.socket = io(this.url, {
        transports: ['websocket'],
        reconnection: true,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 10000,
        timeout: 10000
      });

      this.socket.on('connect', () => {
        this.connected = true;
        logger.info('WebSocket connected to server');
        // Register with server so it can route print jobs to us
        if (this.clientId) {
          this.socket.emit('register', { clientId: this.clientId, hostname: this.hostname });
        }
        this.emit('connected');
      });

      this.socket.on('disconnect', (reason) => {
        this.connected = false;
        logger.warn('WebSocket disconnected', { reason });
        this.emit('disconnected', reason);
      });

      this.socket.on('connect_error', (err) => {
        logger.warn('WebSocket connect error', { error: err.message });
      });

      // Server pushes a print job for one of our printers
      this.socket.on('print:execute', async (data) => {
        await this.handlePrintJob(data);
      });
    } catch (err) {
      logger.error('WebSocket connect failed', { error: err.message });
    }
  }

  setClient(clientId, hostname) {
    this.clientId = clientId;
    this.hostname = hostname;
    if (this.socket && this.connected) {
      this.socket.emit('register', { clientId, hostname });
    }
  }

  async handlePrintJob(data) {
    const { jobId, printerName, fileName, copies, fileData, fileType, tempDir, paper } = data || {};
    if (!jobId) {
      logger.warn('print:execute missing jobId', { data });
      return;
    }

    logger.info('Received print job via WebSocket', { jobId, printerName, fileName, copies, fileType });

    try {
      // Decode base64 file data and write to temp file
      const dir = tempDir || path.join(process.env.TEMP || process.env.TMP || 'C:\\Windows\\Temp', 'printserver-spool');
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const safeName = (fileName || `job-${jobId}`).replace(/[^a-zA-Z0-9._-]/g, '_');
      const filePath = path.join(dir, `${Date.now()}_${safeName}`);
      const buffer = Buffer.from(fileData || '', 'base64');
      fs.writeFileSync(filePath, buffer);

      // Execute the print job
      const result = this.executor
        ? await this.executor.execute({
            id: jobId,
            printer: printerName,
            filePath,
            fileName,
            fileType,
            copies: copies || 1,
            paper: paper || null,  // { size, orientation, customWidthMm, customHeightMm, tray } | null
          })
        : { success: false, error: 'no executor configured' };

      // Cleanup spool file
      try { fs.unlinkSync(filePath); } catch (e) { /* ignore */ }

      // Send result back to server
      this.socket?.emit('print:result', {
        jobId,
        success: result.success,
        method: result.method,
        error: result.error
      });

      logger.info('Print job complete', { jobId, ...result });
    } catch (err) {
      logger.error('Print job execution failed', { jobId, error: err.message });
      this.socket?.emit('print:result', {
        jobId,
        success: false,
        error: err.message
      });
    }
  }

  disconnect() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.socket) this.socket.disconnect();
  }
}

// ─── Config Manager ───────────────────────────────────────────────────────────

class ConfigManager {
  constructor() {
    // Check for config.json in same directory as executable first (for pkg bundle)
    const exeDir = path.dirname(process.execPath);
    const localConfig = path.join(exeDir, 'config.json');
    const roamingDir = path.join(process.env.APPDATA || process.env.HOME || '', 'printserver-agent');
    this.configPath = fs.existsSync(localConfig) ? localConfig : path.join(roamingDir, 'config.json');
    this.config = { ...DEFAULT_CONFIG };
    this.load();
  }

  load() {
    try {
      if (fs.existsSync(this.configPath)) {
        const saved = JSON.parse(fs.readFileSync(this.configPath, 'utf8'));
        this.config = { ...DEFAULT_CONFIG, ...saved };
        logger.info('Config loaded', { path: this.configPath });
      }
    } catch (err) {
      logger.warn('Config load failed, using defaults', { error: err.message });
    }
  }

  save() {
    try {
      const dir = path.dirname(this.configPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(this.configPath, JSON.stringify(this.config, null, 2));
      logger.info('Config saved');
    } catch (err) {
      logger.error('Config save failed', { error: err.message });
    }
  }

  get(key) {
    return this.config[key];
  }

  set(key, value) {
    this.config[key] = value;
    this.save();
  }

  getAll() {
    return { ...this.config };
  }
}

// ─── Main Agent ───────────────────────────────────────────────────────────────

class PrintServerAgent {
  constructor() {
    this.config = new ConfigManager();
    this.printerScanner = new PrinterScanner();
    this.jobExecutor = new JobExecutor();
    this.apiClient = new APIClient(this.config.get('serverUrl'));
    this.wsClient = new WebSocketClient(this.config.get('serverUrl'));
    this.wsClient.setExecutor(this.jobExecutor);
    this.spoolWatcher = null;
    this.running = false;
    this.clientId = null;
  }

  async start() {
    logger.info('╔══════════════════════════════════════╗');
    logger.info(`║   PrintServer Node Agent v${AGENT_VERSION}      ║`);
    logger.info('╚══════════════════════════════════════╝');
    logger.info('Starting PrintServer Node Agent...');

    this.running = true;

    // Load saved clientId if exists
    this.clientId = this.config.get('clientId');
    this.apiClient.clientId = this.clientId;
    this.apiClient.secretKey = this.config.get('secretKey') || '';

    // Scan printers
    const printers = await this.printerScanner.scan();

    // Setup spool watcher
    const spoolDirs = this.config.get('spoolDirs');
    this.spoolWatcher = new SpoolWatcher(spoolDirs, this.config.get('watchExtensions'));
    
    this.spoolWatcher.on('file', async (fileInfo) => {
      logger.info('Print file detected', fileInfo);
      await this.handleNewFile(fileInfo);
    });

    await this.spoolWatcher.start();

    // Register with server
    await this.registerWithServer();

    // Start heartbeat
    this.startHeartbeat();

    // Register shutdown handlers
    process.on('SIGINT', () => this.shutdown());
    process.on('SIGTERM', () => this.shutdown());

    logger.info('PrintServer Node Agent is running!');
    logger.info(`  Server: ${this.config.get('serverUrl')}`);
    logger.info(`  Hostname: ${os.hostname()}`);
    logger.info(`  Printers: ${printers.length}`);
    logger.info(`  Spool dirs: ${spoolDirs.join(', ')}`);
  }

  async registerWithServer() {
    try {
      // Pick the best LAN IP — prefer private IPv4, then any IPv4, then IPv6.
      // Skip link-local fe80::, virtual adapters, and internal NICs.
      const allIfaces = Object.values(os.networkInterfaces()).flat().filter(i => i && !i.internal);
      const isPrivateIPv4 = (a) => /^(10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[0-1])\.)/.test(a);
      const isLinkLocalIPv6 = (a) => /^fe80:/i.test(a);

      const privateIPv4 = allIfaces.find(i => i.family === 'IPv4' && isPrivateIPv4(i.address));
      const anyIPv4     = allIfaces.find(i => i.family === 'IPv4');
      const globalIPv6  = allIfaces.find(i => i.family === 'IPv6' && !isLinkLocalIPv6(i.address));
      const linkIPv6    = allIfaces.find(i => i.family === 'IPv6' && isLinkLocalIPv6(i.address));

      const bestIface = privateIPv4 || anyIPv4 || globalIPv6 || linkIPv6 || null;

      // Map Windows release number → friendly product name.
      let osVersionLabel = `${os.platform()} ${os.release()}`;
      if (os.platform() === 'win32') {
        const r = os.release();
        if (r.startsWith('11.')) osVersionLabel = `Windows 11 (${r})`;
        else if (r.startsWith('10.')) osVersionLabel = `Windows 10 (${r})`;
        else if (r.startsWith('6.3.')) osVersionLabel = `Windows 8.1 (${r})`;
        else if (r.startsWith('6.2.')) osVersionLabel = `Windows 8 (${r})`;
        else if (r.startsWith('6.1.')) osVersionLabel = `Windows 7 (${r})`;
        else if (r.startsWith('6.0.')) osVersionLabel = `Windows Vista (${r})`;
        else osVersionLabel = `Windows (${r})`;
      }

      const nodeInfo = {
        hostname: os.hostname(),
        ip_address: bestIface ? bestIface.address : null,
        mac_address: bestIface ? bestIface.mac : null,
        os_version: osVersionLabel,
        client_version: AGENT_VERSION
      };

      const result = await this.apiClient.register(nodeInfo);

      if (result?.id) {
        this.clientId = result.id;
        this.config.set('clientId', result.clientId);
        if (result.nodeSecret) {
          this.config.set('secretKey', result.nodeSecret);
        }
        logger.info('Node registered successfully', { clientId: this.clientId });

        // Connect WebSocket for receiving print jobs from server (IPP → node)
        this.wsClient.setClient(this.clientId, os.hostname());
        this.wsClient.connect();
      }
    } catch (err) {
      logger.error('Failed to register with server', { error: err.message });
      // Continue anyway - agent can work offline
    }
  }

  startHeartbeat() {
    const interval = this.config.get('checkInterval') || 10000;
    const printerRefreshInterval = this.config.get('printerRefreshInterval') || 300000; // 5 minutes default

    const BUILTIN_PRINTERS = [
      'microsoft print to pdf',
      'microsoft xps document writer',
      'onenote',
      'fax',
      'nitro pdf creator'
    ];

    const isNetworkShare = (name) => /^\\\\/.test((name || '').trim());
    const isBuiltin = (name) => {
      const lower = (name || '').toLowerCase();
      return BUILTIN_PRINTERS.some(b => lower.includes(b));
    };

    let lastScanTime = 0;

    this.heartbeatTimer = setInterval(async () => {
      if (!this.clientId) {
        await this.registerWithServer();
      } else {
        const now = Date.now();
        // Periodically refresh printer list (limit to 5 minutes to prevent PowerShell CPU/RAM spikes)
        if (now - lastScanTime >= printerRefreshInterval || lastScanTime === 0) {
          try {
            await this.printerScanner.scan();
            lastScanTime = now;
          } catch (scanErr) {
            logger.error('Scheduled printer scan failed', { error: scanErr.message });
          }
        }

        const printerList = (this.printerScanner.printers || [])
          .filter(p => p.name && !isNetworkShare(p.name) && !isBuiltin(p.name))
          .map(p => ({
            name: p.name,
            status: p.status === 'online' ? 'online' : 'offline',
            port: p.port || 'UNKNOWN',
            type: p.type || 'local',
            jobs_in_queue: 0
          }));

        await this.apiClient.heartbeat(printerList);
      }
    }, interval);

    logger.info(`Heartbeat started (interval: ${interval}ms, printer refresh: ${printerRefreshInterval}ms)`);
  }

  async handleNewFile(fileInfo) {
    try {
      // Submit job to server
      const jobResult = await this.apiClient.uploadJob(fileInfo);
      
      if (jobResult?.jobId) {
        logger.info('Job submitted to server', { jobId: jobResult.jobId });
        
        // Execute print locally
        const execResult = await this.jobExecutor.execute({
          ...fileInfo,
          printer: jobResult.printer || null,
          jobId: jobResult.jobId
        });

        // Notify server of completion
        if (execResult.success) {
          logger.info('Job completed successfully', { jobId: jobResult.jobId, method: execResult.method });
        }
      }
    } catch (err) {
      logger.error('Failed to handle print file', { error: err.message });
    }
  }

  async shutdown() {
    logger.info('Shutting down PrintServer Node Agent...');
    this.running = false;

    if (this.spoolWatcher) {
      this.spoolWatcher.stop();
    }

    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
    }

    logger.info('Agent stopped');
    process.exit(0);
  }
}

// ─── Entry Point ─────────────────────────────────────────────────────────────

function main() {
  const args = process.argv.slice(2);
  
  // Check for --config argument
  const configArg = args.find(arg => arg.startsWith('--config='));
  if (configArg) {
    const configPath = configArg.split('=')[1];
    if (fs.existsSync(configPath)) {
      try {
        const customConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        Object.assign(DEFAULT_CONFIG, customConfig);
        logger.info('Loaded custom config', { path: configPath });
      } catch (err) {
        console.error('Failed to load config:', err.message);
        process.exit(1);
      }
    }
  }

  // Check Node.js version
  const [major] = process.version.slice(1).split('.').map(Number);
  if (major < 16) {
    console.error('Node.js 16+ required. Current:', process.version);
    process.exit(1);
  }

  const agent = new PrintServerAgent();
  agent.start().catch(err => {
    console.error('Failed to start agent:', err);
    process.exit(1);
  });

  // Start auto-updater (no-op when running unpackaged / no serverUrl)
  const updater = new AutoUpdater({
    serverUrl: agent.config.get('serverUrl') || DEFAULT_CONFIG.serverUrl,
    log: (level, msg, data) => {
      if (data !== undefined) {
        (logger[level] || logger.info).call(logger, msg, data);
      } else {
        (logger[level] || logger.info).call(logger, msg);
      }
    }
  });
  updater.start();

  // Graceful shutdown — stop the updater timer
  const cleanup = () => {
    updater.stop();
    process.exit(0);
  };
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
}

main();