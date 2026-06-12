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
const net = require('net');
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

// Resolve a writable log path next to the running exe. When the task runs as
// SYSTEM, console output is discarded and electron-log lands in the SYSTEM
// profile (unreachable). The exe's own dir is confirmed writable (we write
// version.txt there), so crash diagnostics go there instead.
const LOG_DIR = path.dirname(process.execPath || process.argv[1]);
const LOG_FILE = path.join(LOG_DIR, 'agent.log');
const LOG_MAX_BYTES = 5 * 1024 * 1024; // 5 MB, rotate to .old once exceeded

function writeLogLine(line) {
  try {
    // Size-based rotation so the file never grows unbounded.
    try {
      const st = fs.statSync(LOG_FILE);
      if (st.size > LOG_MAX_BYTES) {
        try { fs.renameSync(LOG_FILE, LOG_FILE + '.old'); } catch (_) {}
      }
    } catch (_) { /* file may not exist yet */ }
    fs.appendFileSync(LOG_FILE, line + '\n', 'utf8');
  } catch (_) { /* never let logging crash the agent */ }
}

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

  debug(msg, data) { if (this.levels[this.level] <= 0) { const l = this.format('debug', msg, data); console.log(l); writeLogLine(l); } }
  info(msg, data) { if (this.levels[this.level] <= 1) { const l = this.format('info', msg, data); console.log(l); writeLogLine(l); } }
  warn(msg, data) { if (this.levels[this.level] <= 2) { const l = this.format('warn', msg, data); console.log(l); writeLogLine(l); } }
  error(msg, data) { if (this.levels[this.level] <= 3) { const l = this.format('error', msg, data); console.error(l); writeLogLine(l); } }
}

const logger = new Logger(DEFAULT_CONFIG.logLevel);

// ─── PowerShell Helper ────────────────────────────────────────────────────────

function execPS(command, extraEnv) {
  return new Promise((resolve, reject) => {
    // Remove shell:true to avoid cmd.exe interpreting PowerShell pipeline syntax
    const ps = spawn('powershell', [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy', 'Bypass',
      '-Command', command
    ], extraEnv ? { env: { ...process.env, ...extraEnv } } : undefined);

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
        // Expand wildcards for user temp dirs. IMPORTANT: preserve the suffix
        // AFTER the '*'. e.g. "C:\Users\*\AppData\Local\Temp" must expand to
        // each user's "...\AppData\Local\Temp" — NOT to "C:\Users\<user>\*"
        // (watching every profile root blew RSS to 3GB → OOM / exit 134).
        const starIdx = d.indexOf('*');
        const base = d.slice(0, starIdx).trim();          // "C:\Users\"
        const suffix = d.slice(starIdx + 1).replace(/^[\\/]+/, ''); // "AppData\Local\Temp"
        if (fs.existsSync(base)) {
          const entries = fs.readdirSync(base, { withFileTypes: true });
          return entries
            .filter(e => e.isDirectory())
            .map(e => suffix ? path.join(base, e.name, suffix) : path.join(base, e.name))
            // Only keep dirs that actually exist — avoids chokidar polling
            // thousands of non-existent paths.
            .filter(p => fs.existsSync(p));
        }
        return null;
      }
      return d;
    }).filter(Boolean);
    // Flatten (each wildcard entry returns an array of expanded dirs).
    const flatPatterns = patterns.flat();

    logger.info('Starting spool watcher on:', flatPatterns);

    this.watcher = chokidar.watch(flatPatterns, {
      persistent: true,
      ignoreInitial: true,
      depth: 0,
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

    let stat;
    try { stat = fs.statSync(filePath); } catch { return; }
    if (stat.size === 0) return;
    // Guard against pathological files — a normal print spool is well under
    // 100MB. Anything larger is almost certainly not a real print job and
    // would risk blowing memory / upload timeouts.
    const MAX_FILE_BYTES = 100 * 1024 * 1024;
    if (stat.size > MAX_FILE_BYTES) {
      logger.warn('Skipping oversized file', { file: filePath, sizeMB: +(stat.size / 1048576).toFixed(1) });
      return;
    }

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
    // Cache printer port detection (WMI Get-CimInstance is slow — 10-40s on
    // some boxes). Key = printer name, value = { host, port } | null.
    // TTL keeps it fresh if a printer's port config changes.
    this._portCache = new Map();
    this._portCacheTtlMs = 10 * 60 * 1000; // 10 minutes
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
    logger.info('Executing print job', { jobId: job.id, printer: job.printer, file: job.filePath, fileType: job.fileType });

    try {
      const paper = job.paper || null; // { size, orientation, tray, customWidthMm, customHeightMm }

      // ── Raw data (ESC/P, raw TCP, etc.) ───────────────────────────────────
      // Strategy:
      //   1. Detect if the printer has a TCP/IP port (e.g. IP_192.168.1.x)
      //   2. If yes → send raw bytes directly via TCP socket (bypass spooler)
      //   3. If no (USB/local) → use Out-Printer (spooler required for USB)
      //
      // CRITICAL: only TRUE raw printer language (ESC/P, ESC/POS, PCL, ZPL) may
      // go straight to port 9100. A document the Windows IPP driver rendered
      // (PDF / PostScript / PWG-raster) is NOT printer language — sending it
      // raw makes the printer spit out garbage symbols. So we sniff the magic
      // bytes first and, if it's a document format, route it through the driver
      // (SumatraPDF / spooler) which translates it into the printer's language.
      if (job.fileType === 'raw' || (job.filePath && job.filePath.endsWith('.raw'))) {
        const fileBytes = fs.readFileSync(job.filePath);

        // Magic-byte sniff: is this actually a rendered document, not raw ESC/P?
        const docFormat = this.detectDocumentFormat(fileBytes);
        if (docFormat) {
          logger.info('Raw job is actually a document — routing through driver, not raw TCP', {
            jobId: job.id, printer: job.printer, format: docFormat, bytes: fileBytes.length
          });
          // Fall through to the document-printing paths below by re-dispatching
          // with a corrected file type. PDF → SumatraPDF; everything else → PS path.
          const docJob = { ...job, fileType: docFormat === 'pdf' ? 'pdf' : 'document', _isDocument: true };
          return await this.printDocument(docJob, paper);
        }

        const printerEsc = (job.printer || '').replace(/'/g, "''");

        // Try to detect TCP/IP port for this printer
        const portInfo = await this.detectPrinterPort(printerEsc);

        if (portInfo && portInfo.host) {
          // ── Direct TCP send (bypass Windows Print Spooler) ──
          // This preserves binary data integrity for ESC/P and other raw protocols.
          const port = portInfo.port || 9100;
          logger.info('Sending raw bytes via TCP direct', {
            jobId: job.id, printer: job.printer,
            host: portInfo.host, port, bytes: fileBytes.length
          });
          await this.sendRawTCP(portInfo.host, port, fileBytes, 15000);
          logger.info('Raw TCP send complete', { jobId: job.id, printer: job.printer });
          return { success: true, method: 'raw-tcp-direct', host: portInfo.host, port };
        }

        // ── Fallback: USB/local printer → WritePrinter with RAW datatype ──
        // CRITICAL: Out-Printer / GDI re-encodes the byte stream through the
        // printer driver, which DOUBLE-PROCESSES already-valid ESC/P data and
        // produces garbage symbols on dot-matrix printers (e.g. EPSON LX-310).
        // The correct way to send raw printer language to a USB/local printer
        // is the Win32 spooler API (OpenPrinter → StartDocPrinter with
        // datatype "RAW" → WritePrinter), which bypasses GDI entirely.
        // Ref: Microsoft KB322090.
        logger.info('No TCP port detected, sending via WritePrinter RAW (bypass GDI)', {
          jobId: job.id, printer: job.printer, bytes: fileBytes.length
        });
        await this.writePrinterRaw(printerEsc, job.filePath);
        logger.info('Job sent via WritePrinter RAW', { jobId: job.id, printer: job.printer });
        return { success: true, method: 'writeprinter-raw' };
      }

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

  /**
   * Send raw bytes to a USB/local printer via the Win32 spooler API with the
   * "RAW" datatype — OpenPrinter → StartDocPrinter(RAW) → WritePrinter →
   * EndDocPrinter. This bypasses the GDI rendering path entirely, so already-
   * valid printer language (ESC/P, ESC/POS, PCL) reaches the printer byte-for-
   * byte instead of being re-encoded by the driver. Ref: Microsoft KB322090.
   *
   * Implemented with inline C# (Add-Type) because PowerShell can't P/Invoke
   * winspool.drv cleanly otherwise. The file is read as raw bytes and pushed
   * through unmodified.
   */
  async writePrinterRaw(printerName, filePath) {
    // Build a C# helper that does the P/Invoke. Keep the C# in a here-string
    // and pass printer name + file path as PowerShell variables (no string
    // interpolation into the C# source → no escaping landmines).
    const csharp = [
      'using System;',
      'using System.IO;',
      'using System.Runtime.InteropServices;',
      'public class RawPrinterHelper {',
      '  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Ansi)]',
      '  public class DOCINFOA {',
      '    [MarshalAs(UnmanagedType.LPStr)] public string pDocName;',
      '    [MarshalAs(UnmanagedType.LPStr)] public string pOutputFile;',
      '    [MarshalAs(UnmanagedType.LPStr)] public string pDataType;',
      '  }',
      '  [DllImport("winspool.Drv", EntryPoint="OpenPrinterA", SetLastError=true, CharSet=CharSet.Ansi)]',
      '  public static extern bool OpenPrinter(string src, out IntPtr hPrinter, IntPtr pd);',
      '  [DllImport("winspool.Drv", EntryPoint="ClosePrinter", SetLastError=true)]',
      '  public static extern bool ClosePrinter(IntPtr hPrinter);',
      '  [DllImport("winspool.Drv", EntryPoint="StartDocPrinterA", SetLastError=true, CharSet=CharSet.Ansi)]',
      '  public static extern bool StartDocPrinter(IntPtr hPrinter, int level, [In] DOCINFOA di);',
      '  [DllImport("winspool.Drv", EntryPoint="EndDocPrinter", SetLastError=true)]',
      '  public static extern bool EndDocPrinter(IntPtr hPrinter);',
      '  [DllImport("winspool.Drv", EntryPoint="StartPagePrinter", SetLastError=true)]',
      '  public static extern bool StartPagePrinter(IntPtr hPrinter);',
      '  [DllImport("winspool.Drv", EntryPoint="EndPagePrinter", SetLastError=true)]',
      '  public static extern bool EndPagePrinter(IntPtr hPrinter);',
      '  [DllImport("winspool.Drv", EntryPoint="WritePrinter", SetLastError=true)]',
      '  public static extern bool WritePrinter(IntPtr hPrinter, IntPtr pBytes, int dwCount, out int dwWritten);',
      '  public static bool SendBytes(string printerName, byte[] bytes) {',
      '    IntPtr hPrinter; int written = 0; bool ok = false;',
      '    DOCINFOA di = new DOCINFOA();',
      '    di.pDocName = "PrintServer RAW Job"; di.pDataType = "RAW";',
      '    if (!OpenPrinter(printerName, out hPrinter, IntPtr.Zero)) return false;',
      '    try {',
      '      if (!StartDocPrinter(hPrinter, 1, di)) return false;',
      '      if (!StartPagePrinter(hPrinter)) return false;',
      '      IntPtr p = Marshal.AllocCoTaskMem(bytes.Length);',
      '      Marshal.Copy(bytes, 0, p, bytes.Length);',
      '      ok = WritePrinter(hPrinter, p, bytes.Length, out written);',
      '      Marshal.FreeCoTaskMem(p);',
      '      EndPagePrinter(hPrinter); EndDocPrinter(hPrinter);',
      '    } finally { ClosePrinter(hPrinter); }',
      '    return ok && written == bytes.Length;',
      '  }',
      '}',
    ].join('\n');

    const psCmd = [
      `$ErrorActionPreference = 'Stop'`,
      `$src = @'`,
      csharp,
      `'@`,
      `Add-Type -TypeDefinition $src -Language CSharp`,
      `$bytes = [System.IO.File]::ReadAllBytes($env:PS_RAW_FILE)`,
      `$ok = [RawPrinterHelper]::SendBytes($env:PS_RAW_PRINTER, $bytes)`,
      `if (-not $ok) { throw "WritePrinter RAW failed for printer '$($env:PS_RAW_PRINTER)'" }`,
      `Write-Output "RAW_OK"`,
    ].join('\r\n');

    // Pass printer name + path via environment variables to avoid any quoting
    // issues with spaces/parentheses in the printer name (e.g. "LX-310 (Copy 1)").
    // execPS resolves with trimmed stdout (string) on success, rejects on error.
    const stdout = await execPS(psCmd, {
      PS_RAW_PRINTER: printerName,
      PS_RAW_FILE: filePath,
    });
    if (!/RAW_OK/.test(stdout || '')) {
      throw new Error(`WritePrinter RAW did not confirm. Output: ${(stdout || '').slice(0, 200)}`);
    }
  }

  /**
   * Sniff magic bytes to tell whether a "raw" job is actually a rendered
   * document (PDF / PostScript / PWG-raster) that the Windows IPP driver
   * produced. Returns 'pdf' | 'ps' | 'pwg' | null (null = genuine raw ESC/P).
   */
  detectDocumentFormat(buf) {
    if (!buf || buf.length < 4) return null;
    // PDF: "%PDF"
    if (buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46) return 'pdf';
    // PostScript: "%!PS" or EPSF "%!"
    if (buf[0] === 0x25 && buf[1] === 0x21) return 'ps';
    // PostScript with DOS preamble (0xC5 0xD0 0xD3 0xC6)
    if (buf[0] === 0xC5 && buf[1] === 0xD0 && buf[2] === 0xD3 && buf[3] === 0xC6) return 'ps';
    // PWG Raster: "RaS2" (big-endian) or "2SaR" (little-endian)
    if (buf[0] === 0x52 && buf[1] === 0x61 && buf[2] === 0x53 && buf[3] === 0x32) return 'pwg';
    if (buf[0] === 0x32 && buf[1] === 0x53 && buf[2] === 0x61 && buf[3] === 0x52) return 'pwg';
    // Apple Raster: "UNIRAST\0"
    if (buf.length >= 8 && buf.slice(0, 7).toString('latin1') === 'UNIRAST') return 'pwg';
    return null; // genuine raw printer language → send to port 9100
  }

  /**
   * Print a rendered document (PDF/PS/PWG) by routing through the printer
   * driver, which translates it into the printer's native language. This is
   * the OPPOSITE of raw TCP — we deliberately want the spooler/driver here.
   * PDF goes through SumatraPDF; if SumatraPDF is missing we fall back to the
   * shell's print verb. The temp file is given a proper extension so the tools
   * recognise it.
   */
  async printDocument(job, paper) {
    const ext = job.fileType === 'pdf' ? '.pdf'
              : job.fileType === 'document' ? '.ps'
              : '';
    let docPath = job.filePath;
    // Ensure the file has the right extension (SumatraPDF / Start-Process -Verb
    // Print rely on it to pick the correct handler).
    if (ext && !docPath.toLowerCase().endsWith(ext)) {
      const newPath = docPath + ext;
      try {
        fs.copyFileSync(docPath, newPath);
        docPath = newPath;
      } catch (e) {
        logger.warn('Could not rename doc for printing, using original', { error: e.message });
      }
    }

    try {
      // PDF via SumatraPDF — silent, reliable, honours paper size.
      if (job.fileType === 'pdf' && this.sumatraPDFPath && fs.existsSync(docPath)) {
        const printerArg = job.printer ? `-printer "${job.printer}"` : '';
        const paperArg = paper && this.isSumatraBuiltin(paper.size) ? `-paper "${this.mapSumatraPaper(paper.size)}"` : '';
        const settingsArg = paper && paper.orientation === 'landscape' ? '-landscape' : '';
        const cmd = `"${this.sumatraPDFPath}" -print-to ${printerArg} ${paperArg} ${settingsArg} "${docPath}"`;
        await new Promise((resolve, reject) => {
          exec(cmd, { shell: true }, (err) => err ? reject(err) : resolve());
        });
        logger.info('Document printed via SumatraPDF', { jobId: job.id, format: job.fileType });
        return { success: true, method: 'sumatra-doc', format: job.fileType };
      }

      // Fallback: shell print verb (uses the OS-registered handler → driver).
      if (job.printer) {
        const psCmd = [
          `$h = Start-Process -FilePath '${docPath.replace(/'/g, "''")}' -Verb PrintTo -ArgumentList '${job.printer.replace(/'/g, "''")}' -PassThru -WindowStyle Hidden`,
          `Start-Sleep -Seconds 3`,
          `if ($h -and !$h.HasExited) { $h.CloseMainWindow() | Out-Null }`,
        ].join("\r\n");
        await execPS(psCmd);
        logger.info('Document printed via shell PrintTo verb', { jobId: job.id, format: job.fileType });
        return { success: true, method: 'shell-printto', format: job.fileType };
      }

      throw new Error('No printer specified and SumatraPDF unavailable for document printing');
    } finally {
      // Clean up the renamed copy (original is cleaned by the caller).
      if (docPath !== job.filePath) {
        try { fs.unlinkSync(docPath); } catch (e) { /* ignore */ }
      }
    }
  }

  /**
   * Detect if a printer uses a TCP/IP port. Returns { host, port } or null.
   * Queries Windows WMI for the printer's port configuration.
   * Handles port names like "IP_192.168.1.100" or "192.168.1.100_1".
   */
  async detectPrinterPort(printerName) {
    // Serve from cache when fresh — avoids slow repeat WMI queries.
    const cached = this._portCache.get(printerName);
    if (cached && (Date.now() - cached.ts) < this._portCacheTtlMs) {
      logger.debug('Printer port from cache', { printerName, value: cached.value });
      return cached.value;
    }
    try {
      const psCmd = [
        `$p = Get-CimInstance Win32_Printer -Filter "Name='${printerName.replace(/'/g, "''")}'" -ErrorAction SilentlyContinue`,
        `if ($p) {`,
        `  # Check Win32_TCPIPPrinterPort first (modern Windows)`,
        `  $port = Get-CimInstance Win32_TCPIPPrinterPort -Filter "Name='$($p.PortName)'" -ErrorAction SilentlyContinue`,
        `  if ($port -and $port.HostAddress) {`,
        `    Write-Output ("TCP|" + $port.HostAddress + "|" + $port.PortNumber)`,
        `  } else {`,
        `    # Fallback: parse port name pattern IP_x.x.x.x or x.x.x.x_N`,
        `    $name = $p.PortName`,
        `    if ($name -match '^(?:IP_)?(\\d+\\.\\d+\\.\\d+\\.\\d+)(?:_(\\d+))?$') {`,
        `      $ip = $Matches[1]`,
        `      $port = if ($Matches[2]) { [int]$Matches[2] } else { 9100 }`,
        `      Write-Output ("TCP|" + $ip + "|" + $port)`,
        `    } else {`,
        `      Write-Output "LOCAL|$($p.PortName)"`,
        `    }`,
        `  }`,
        `} else { Write-Output "NOTFOUND" }`,
      ].join('\r\n');
      const result = await execPS(psCmd);
      const line = (result.stdout || '').trim();
      logger.debug('Printer port detection', { printerName, result: line });

      if (line.startsWith('TCP|')) {
        const parts = line.split('|');
        const value = { host: parts[1], port: parseInt(parts[2]) || 9100 };
        this._portCache.set(printerName, { ts: Date.now(), value });
        return value;
      }
      this._portCache.set(printerName, { ts: Date.now(), value: null });
      return null; // USB, local, or not found
    } catch (err) {
      logger.warn('Printer port detection failed', { printerName, error: err.message });
      return null;
    }
  }

  /**
   * Send raw bytes to a TCP/IP endpoint (printer port 9100).
   * Bypasses Windows Print Spooler entirely — data goes directly to the printer.
   */
  sendRawTCP(host, port, data, timeoutMs = 15000) {
    return new Promise((resolve, reject) => {
      const socket = new net.Socket();
      const timer = setTimeout(() => {
        socket.destroy();
        reject(new Error(`TCP send to ${host}:${port} timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      socket.connect(port, host, () => {
        logger.debug('TCP connected to printer', { host, port });
        socket.write(data, () => {
          socket.end();
        });
      });

      socket.on('close', () => {
        clearTimeout(timer);
        resolve();
      });

      socket.on('error', (err) => {
        clearTimeout(timer);
        socket.destroy();
        reject(new Error(`TCP send to ${host}:${port} failed: ${err.message}`));
      });
    });
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

  /**
   * Send heartbeat to central server's /api/node-internal/heartbeat endpoint
   * This is the dedicated internal heartbeat endpoint for node management
   * @param nodeName - Name of this node
   * @param status - Node status (online/offline/error)
   * @param printers - Array of printer info objects
   * @param osInfo - OS info object with platform, release, hostname, arch, memory_gb, cpus
   */
  async heartbeatNodeInternal(nodeName, status = 'online', printers = [], osInfo = {}) {
    try {
      const payload = {
        node_name: nodeName,
        status,
        printers,
        os_info: osInfo
      };

      const response = await axios.post(
        `${this.baseUrl}/api/node-internal/heartbeat`,
        payload,
        {
          timeout: 5000,
          headers: {
            'Content-Type': 'application/json'
          }
        }
      );

      if (response.data?.success) {
        logger.debug('Node-internal heartbeat sent successfully');
      }
      return response.data;
    } catch (err) {
      logger.warn('Node-internal heartbeat failed', { error: err.message });
      return null;
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
    const interval = 30000; // 30 seconds - fixed interval for node-internal heartbeat
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

        // Build OS info for heartbeat
        const totalMemGb = Math.round(os.totalmem() / (1024 * 1024 * 1024) * 10) / 10;
        const osInfo = {
          platform: os.platform(),
          release: os.release(),
          hostname: os.hostname(),
          arch: os.arch(),
          memory_gb: totalMemGb,
          cpus: os.cpus().length
        };

        // Send heartbeat to /api/node-internal/heartbeat endpoint
        await this.apiClient.heartbeatNodeInternal(os.hostname(), 'online', printerList, osInfo);

        // Also send the old-style heartbeat to /api/clients/:id/heartbeat for backwards compatibility
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

  // ─── Crash diagnostics ──────────────────────────────────────────────────
  // Task runs as SYSTEM with no console, so exit 134 (SIGABRT, usually OOM or
  // a fatal uncaught error) leaves no trace. Capture everything to agent.log.
  logger.info('=== Agent process starting ===', {
    version: AGENT_VERSION,
    node: process.version,
    pid: process.pid,
    execPath: process.execPath,
    logFile: LOG_FILE
  });

  process.on('uncaughtException', (err) => {
    logger.error('FATAL uncaughtException', { message: err && err.message, stack: err && err.stack });
    try { writeLogLine(`[FATAL] uncaughtException: ${err && err.stack ? err.stack : err}`); } catch (_) {}
    // Give the file write a tick to flush, then exit so the task can be restarted.
    setTimeout(() => process.exit(134), 250);
  });

  process.on('unhandledRejection', (reason) => {
    const r = reason instanceof Error ? reason.stack : JSON.stringify(reason);
    logger.error('unhandledRejection', { reason: r });
  });

  process.on('warning', (w) => {
    logger.warn('process warning', { name: w.name, message: w.message, stack: w.stack });
  });

  process.on('exit', (code) => {
    const mu = process.memoryUsage();
    writeLogLine(`[${new Date().toISOString()}] [EXIT] code=${code} rss=${(mu.rss/1048576).toFixed(1)}MB heapUsed=${(mu.heapUsed/1048576).toFixed(1)}MB`);
  });

  // Memory sampler — logs RSS/heap every 60s so a leak shows as a rising trend
  // before the eventual OOM abort. Unref so it never keeps the process alive.
  const memTimer = setInterval(() => {
    const mu = process.memoryUsage();
    const rssMB = +(mu.rss / 1048576).toFixed(1);
    logger.info('mem sample', {
      rssMB,
      heapUsedMB: +(mu.heapUsed / 1048576).toFixed(1),
      heapTotalMB: +(mu.heapTotal / 1048576).toFixed(1),
      externalMB: +(mu.external / 1048576).toFixed(1)
    });
    // Circuit-breaker: a healthy agent sits at ~60MB RSS. If it ever crosses
    // 600MB something is leaking. Exit cleanly NOW (well below the ~2GB heap
    // ceiling that triggers SIGABRT/exit 134) so the Scheduled Task relaunches
    // us in seconds instead of the node sitting silently dead for ~24 min.
    if (rssMB > 600) {
      logger.error('Memory circuit-breaker tripped — restarting agent', { rssMB });
      // exit 0 so the relaunch is treated as a clean restart by the task.
      setTimeout(() => process.exit(0), 250);
    }
  }, 60 * 1000);
  if (memTimer.unref) memTimer.unref();

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

  // Write version.txt for the batch manager to read
  const versionFile = path.join(path.dirname(process.execPath || process.argv[1]), 'version.txt');
  try {
    fs.writeFileSync(versionFile, AGENT_VERSION, 'utf8');
  } catch (e) { /* non-fatal */ }

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