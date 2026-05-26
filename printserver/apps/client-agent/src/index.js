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
  serverUrl: 'http://192.168.170.58:3000',
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
    logger.info('Scanning for printers...');
    const discovered = [];

    try {
      // Method 1: WMIC (most reliable on Windows)
      const wmicOutput = await execPS(
        `Get-WmiObject -Class Win32_Printer | Select-Object Name, PortName, Status, Default | ConvertTo-Json -Compress`
      );

      if (wmicOutput) {
        let printers = JSON.parse(wmicOutput);
        if (!Array.isArray(printers)) printers = [printers];

        for (const p of printers) {
          discovered.push({
            name: p.Name,
            port: p.PortName || 'UNKNOWN',
            status: p.Status === 'OK' ? 'online' : 'offline',
            isDefault: p.Default || false,
            driver: 'Windows Driver',
            type: 'local'
          });
        }
      }

      // Method 2: Registry lookup for spool printers
      try {
        const regOutput = await execPS(
          `Get-ItemProperty "HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Print\\Printers" -ErrorAction SilentlyContinue | Select-Object -ExpandProperty PSPath`
        );
        if (regOutput) {
          const regPrinters = regOutput.split('\n').filter(p => p.trim());
          for (const rp of regPrinters) {
            const name = rp.split('\\').pop().replace(/'/g, '');
            if (name && !discovered.find(p => p.name === name)) {
              discovered.push({
                name,
                port: 'REGISTRY',
                status: 'unknown',
                isDefault: false,
                driver: 'Unknown',
                type: 'local'
              });
            }
          }
        }
      } catch (e) { /* skip registry */ }

    } catch (err) {
      logger.warn('WMIC scan failed, trying alternative method...', { error: err.message });
      
      // Fallback: net view
      try {
        const netOutput = await execPS(
          `Get-Printer | Select-Object Name, Status | ConvertTo-Json -Compress`
        );
        if (netOutput) {
          let printers = JSON.parse(netOutput);
          if (!Array.isArray(printers)) printers = [printers];
          for (const p of printers) {
            discovered.push({
              name: p.Name,
              port: 'NETWORK',
              status: p.Status === 'Ready' ? 'online' : 'unknown',
              isDefault: false,
              driver: 'Network Printer',
              type: 'network'
            });
          }
        }
      } catch (e2) {
        logger.error('All printer scan methods failed', { error: e2.message });
      }
    }

    this.printers = discovered;
    logger.info(`Found ${discovered.length} printers`, { printers: discovered.map(p => p.name) });
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
      // Try SumatraPDF first (best for silent printing)
      if (this.sumatraPDFPath && fs.existsSync(job.filePath)) {
        const printerArg = job.printer ? `-printer "${job.printer}"` : '';
        const cmd = `"${this.sumatraPDFPath}" -print-to ${printerArg} "${job.filePath}"`;
        
        await new Promise((resolve, reject) => {
          exec(cmd, { shell: true }, (err, stdout, stderr) => {
            if (err) reject(err);
            else resolve();
          });
        });

        logger.info('Job printed via SumatraPDF', { jobId: job.id });
        return { success: true, method: 'sumatra' };
      }

      // Fallback: PowerShell Print Document
      if (job.printer) {
        const psCmd = `Start-Process -FilePath "${job.filePath}" -Verb Print -WindowStyle Hidden`;
        await execPS(psCmd);
        logger.info('Job sent via PowerShell', { jobId: job.id });
        return { success: true, method: 'powershell' };
      }

      // Last resort: default printer
      const psCmd = `Get-ChildItem "${path.dirname(job.filePath)}" -Filter "${path.basename(job.filePath)}" | ForEach-Object { Start-Process $_.FullName -Verb Print }`;
      await execPS(psCmd);
      return { success: true, method: 'default' };

    } catch (err) {
      logger.error('Job execution failed', { jobId: job.id, error: err.message });
      return { success: false, error: err.message };
    }
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
        client_version: '1.0.0'
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

  async heartbeat() {
    if (!this.clientId) return;

    try {
      await axios.post(`${this.baseUrl}/api/clients/${this.clientId}/heartbeat`, {
        status: 'online',
        printers: [],
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

// ─── WebSocket Client ─────────────────────────────────────────────────────────

class WebSocketClient extends EventEmitter {
  constructor(url) {
    super();
    this.url = url.replace('http', 'ws') + '/socket.io/?EIO=4&transport=websocket';
    this.connected = false;
    this.client = null;
  }

  connect() {
    try {
      // Using socket.io-client would be ideal here
      // For lightweight fallback, we use polling
      this.startPolling();
    } catch (err) {
      logger.error('WebSocket connect failed, using polling fallback', { error: err.message });
    }
  }

  startPolling() {
    logger.info('Using polling mode for server communication');
    this.pollInterval = setInterval(() => {
      // Polling handled externally via APIClient
    }, 5000);
  }

  disconnect() {
    if (this.pollInterval) clearInterval(this.pollInterval);
    this.connected = false;
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
    this.spoolWatcher = null;
    this.running = false;
    this.clientId = null;
  }

  async start() {
    logger.info('╔══════════════════════════════════════╗');
    logger.info('║   PrintServer Node Agent v1.0.0      ║');
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
      const addrs = Object.values(os.networkInterfaces()).flat().filter(i => i && !i.internal).map(i => i.address);
      const nodeInfo = {
        hostname: os.hostname(),
        ip_address: addrs[0] || null,
        mac_address: null,
        os_version: os.platform() + ' ' + os.release(),
        client_version: '1.0.0'
      };

      const result = await this.apiClient.register(nodeInfo);

      if (result?.id) {
        this.clientId = result.id;
        this.config.set('clientId', result.clientId);
        if (result.nodeSecret) {
          this.config.set('secretKey', result.nodeSecret);
        }
        logger.info('Node registered successfully', { clientId: this.clientId });
      }
    } catch (err) {
      logger.error('Failed to register with server', { error: err.message });
      // Continue anyway - agent can work offline
    }
  }

  startHeartbeat() {
    const interval = this.config.get('checkInterval') || 10000;
    
    this.heartbeatTimer = setInterval(async () => {
      if (!this.clientId) {
        await this.registerWithServer();
      } else {
        await this.apiClient.heartbeat();
      }

      // Periodically refresh printer list
      await this.printerScanner.scan();
    }, interval);

    logger.info(`Heartbeat started (interval: ${interval}ms)`);
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
}

main();