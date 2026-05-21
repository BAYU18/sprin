import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import * as fs from 'fs';
import * as http from 'http';
import * as https from 'https';
import { WebSocket } from 'ws';
import log from 'electron-log';
import * as tmp from 'tmp';

const execAsync = promisify(exec);

export interface PrintOptions {
  fitToPage?: boolean;
  colorMode?: 'color' | 'grayscale';
  duplex?: boolean;
  paperSize?: string;
  orientation?: 'portrait' | 'landscape';
  mediaType?: 'plain' | 'photo' | 'transparency';
}

export interface PrintJob {
  jobId: string;
  printerName: string;
  filePath: string;
  copies: number;
  options?: PrintOptions;
  reportUrl?: string;
  wsEndpoint?: string;
}

export interface PrintResult {
  success: boolean;
  jobId: string;
  error?: string;
  printedPages?: number;
}

interface DownloadOptions {
  jobId: string;
  url: string;
  reportUrl?: string;
  wsEndpoint?: string;
}

class JobExecutor {
  private wsConnection: WebSocket | null = null;
  private tempFiles: string[] = [];

  constructor() {
    log.info('JobExecutor initialized');
  }

  private async reportResult(result: PrintResult): Promise<void> {
    if (this.wsConnection && this.wsConnection.readyState === WebSocket.OPEN) {
      try {
        this.wsConnection.send(JSON.stringify({
          type: 'print-result',
          data: result
        }));
        log.info(`Reported result via WebSocket for job ${result.jobId}`);
      } catch (err) {
        log.error('Failed to report via WebSocket:', err);
      }
    }

    if (result.reportUrl) {
      try {
        await this.httpPost(result.reportUrl, result);
        log.info(`Reported result via HTTP for job ${result.jobId}`);
      } catch (err) {
        log.error('Failed to report via HTTP:', err);
      }
    }
  }

  private httpPost(url: string, data: PrintResult): Promise<void> {
    return new Promise((resolve, reject) => {
      const urlObj = new URL(url);
      const protocol = urlObj.protocol === 'https:' ? https : http;
      
      const postData = JSON.stringify(data);
      
      const options: http.RequestOptions = {
        hostname: urlObj.hostname,
        port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
        path: urlObj.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData)
        }
      };

      const req = protocol.request(options, (res) => {
        res.on('data', () => {});
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            resolve();
          } else {
            reject(new Error(`HTTP ${res.statusCode}`));
          }
        });
      });

      req.on('error', reject);
      req.write(postData);
      req.end();
    });
  }

  private async downloadFile(url: string, destPath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const urlObj = new URL(url);
      const protocol = urlObj.protocol === 'https:' ? https : http;
      
      const options: http.RequestOptions = {
        hostname: urlObj.hostname,
        port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
        path: urlObj.pathname + urlObj.search,
        method: 'GET',
        rejectUnauthorized: false
      };

      const req = protocol.request(options, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302) {
          const redirectUrl = res.headers.location;
          if (redirectUrl) {
            this.downloadFile(redirectUrl, destPath).then(resolve).catch(reject);
            return;
          }
        }

        if (res.statusCode !== 200) {
          reject(new Error(`Download failed with status ${res.statusCode}`));
          return;
        }

        const fileStream = fs.createWriteStream(destPath);
        res.pipe(fileStream);
        
        fileStream.on('finish', () => {
          fileStream.close();
          resolve(destPath);
        });
        
        fileStream.on('error', (err) => {
          fileStream.close();
          reject(err);
        });
      });

      req.on('error', reject);
      req.setTimeout(30000, () => {
        req.destroy();
        reject(new Error('Download timeout'));
      });
      req.end();
    });
  }

  private createTempFile(suffix: string): Promise<string> {
    return new Promise((resolve, reject) => {
      tmp.file({ postfix: suffix }, (err, filepath) => {
        if (err) {
          reject(err);
        } else {
          this.tempFiles.push(filepath);
          resolve(filepath);
        }
      });
    });
  }

  private cleanupTempFile(filePath: string): void {
    try {
      const index = this.tempFiles.indexOf(filePath);
      if (index > -1) {
        this.tempFiles.splice(index, 1);
      }
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        log.info(`Cleaned up temp file: ${filePath}`);
      }
    } catch (err) {
      log.warn(`Failed to cleanup temp file ${filePath}:`, err);
    }
  }

  cleanupAllTempFiles(): void {
    for (const filePath of this.tempFiles) {
      this.cleanupTempFile(filePath);
    }
    this.tempFiles = [];
  }

  setWebSocket(ws: WebSocket): void {
    this.wsConnection = ws;
  }

  disconnectWebSocket(): void {
    if (this.wsConnection) {
      this.wsConnection.close();
      this.wsConnection = null;
    }
  }

  async downloadAndPrint(jobId: string, url: string, reportUrl?: string, wsEndpoint?: string): Promise<PrintResult> {
    log.info(`Downloading file for job ${jobId} from ${url}`);
    
    const tempPath = await this.createTempFile('.printjob');
    
    try {
      const filePath = await this.downloadFile(url, tempPath);
      log.info(`Downloaded file to ${filePath}`);
      
      const ext = path.extname(filePath).toLowerCase();
      const printerName = ''; 
      const copies = 1;
      
      let result: PrintResult;
      if (ext === '.pdf') {
        result = await this.printPDF(filePath, printerName, copies);
      } else if (['.png', '.jpg', '.jpeg', '.bmp', '.gif', '.tiff'].includes(ext)) {
        result = await this.printImage(filePath, printerName);
      } else {
        result = await this.printRaw(filePath, printerName);
      }
      
      result.jobId = jobId;
      
      if (reportUrl) {
        result.reportUrl = reportUrl;
      }
      
      await this.reportResult(result);
      this.cleanupTempFile(filePath);
      
      return result;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown download error';
      log.error(`Download failed for job ${jobId}:`, errorMessage);
      
      const result: PrintResult = {
        success: false,
        jobId,
        error: `Download failed: ${errorMessage}`
      };
      
      this.cleanupTempFile(tempPath);
      
      if (reportUrl) {
        result.reportUrl = reportUrl;
        await this.reportResult(result);
      }
      
      return result;
    }
  }

  async printPDF(filePath: string, printerName: string, copies: number = 1): Promise<PrintResult> {
    log.info(`Printing PDF: ${filePath} to ${printerName}, copies: ${copies}`);
    
    const sumatraPaths = [
      'C:\\Program Files\\SumatraPDF\\SumatraPDF.exe',
      'C:\\Program Files (x86)\\SumatraPDF\\SumatraPDF.exe',
      path.join(process.env.LOCALAPPDATA || '', 'SumatraPDF', 'SumatraPDF.exe')
    ];
    
    let sumatraPath: string | null = null;
    for (const p of sumatraPaths) {
      if (fs.existsSync(p)) {
        sumatraPath = p;
        break;
      }
    }

    if (sumatraPath) {
      return this.printPDFWithSumatra(sumatraPath, filePath, printerName, copies);
    }

    log.info('SumatraPDF not found, falling back to ShellExecute');
    return this.printPDFWithShellExecute(filePath, printerName, copies);
  }

  private async printPDFWithSumatra(sumatraPath: string, filePath: string, printerName: string, copies: number): Promise<PrintResult> {
    const jobId = `pdf-${Date.now()}`;
    
    for (let i = 0; i < copies; i++) {
      const escapedPath = filePath.replace(/"/g, '`"');
      const escapedPrinter = printerName.replace(/"/g, '`"');
      const command = `& "${sumatraPath}" -print-to "${escapedPrinter}" "${escapedPath}"`;
      
      try {
        const { stdout, stderr } = await execAsync(command, { timeout: 60000 });
        if (stderr) {
          log.warn(`SumatraPDF stderr: ${stderr}`);
        }
        log.info(`SumatraPDF printed page ${i + 1} of ${copies}`);
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Unknown error';
        log.error(`SumatraPDF print failed: ${errorMessage}`);
        return {
          success: false,
          jobId,
          error: `SumatraPDF print failed: ${errorMessage}`
        };
      }
    }
    
    return {
      success: true,
      jobId,
      printedPages: copies
    };
  }

  private async printPDFWithShellExecute(filePath: string, printerName: string, copies: number): Promise<PrintResult> {
    const jobId = `pdf-${Date.now()}`;
    
    const escapedPath = filePath.replace(/'/g, "''");
    const escapedPrinter = printerName.replace(/'/g, "''");
    
    const psScript = `
Add-Type -AssemblyName System.Drawing

$filePath = '${escapedPath}'
$printerName = '${escapedPrinter}'
$copies = ${copies}

for ($i = 0; $i -lt $copies; $i++) {
    try {
        $printDoc = New-Object System.Drawing.Printing.PrintDocument
        $printDoc.PrinterSettings.PrinterName = $printerName
        $printDoc.DocumentName = [System.IO.Path]::GetFileName($filePath)
        $printDoc.Print()
        $printDoc.Dispose()
    } catch {
        Write-Error "Print failed: $_"
        exit 1
    }
}
`;

    try {
      const result = await this.executePowerShell(psScript, 60000 * copies);
      return {
        success: true,
        jobId,
        printedPages: copies
      };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      return {
        success: false,
        jobId,
        error: `ShellExecute print failed: ${errorMessage}`
      };
    }
  }

  async printRaw(filePath: string, printerName: string): Promise<PrintResult> {
    log.info(`Printing raw: ${filePath} to ${printerName}`);
    
    const jobId = `raw-${Date.now()}`;
    const escapedPath = filePath.replace(/'/g, "''");
    const escapedPrinter = printerName.replace(/'/g, "''");
    
    const psScript = `
Add-Type -AssemblyName System.Drawing.Printing

$filePath = '${escapedPath}'
$printerName = '${escapedPrinter}'

try {
    $printDoc = New-Object System.Drawing.Printing.PrintDocument
    $printDoc.PrinterSettings.PrinterName = $printerName
    
    $stream = [System.IO.File]::OpenRead($filePath)
    $buffer = New-Object byte[] 4096
    $bytesRead = 0
    
    $printDoc.Print()
    $printDoc.Dispose()
    $stream.Close()
    
    Write-Output "Raw print successful"
} catch {
    Write-Error "Raw print failed: $_"
    exit 1
}
`;

    try {
      await this.executePowerShell(psScript, 30000);
      return {
        success: true,
        jobId
      };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      return {
        success: false,
        jobId,
        error: `Raw print failed: ${errorMessage}`
      };
    }
  }

  async printImage(filePath: string, printerName: string): Promise<PrintResult> {
    log.info(`Printing image: ${filePath} to ${printerName}`);
    
    const jobId = `img-${Date.now()}`;
    const escapedPath = filePath.replace(/'/g, "''");
    const escapedPrinter = printerName.replace(/'/g, "''");
    
    const psScript = `
Add-Type -AssemblyName System.Drawing

$filePath = '${escapedPath}'
$printerName = '${escapedPrinter}'

try {
    $img = [System.Drawing.Image]::FromFile($filePath)
    $printDoc = New-Object System.Drawing.Printing.PrintDocument
    $printDoc.PrinterSettings.PrinterName = $printerName
    $printDoc.DocumentName = [System.IO.Path]::GetFileName($filePath)
    
    Register-ObjectEvent -InputObject $printDoc -EventName PrintPage -Action {
        $e = $EventArgs
        $e.Graphics.DrawImage($img, $e.PageBounds)
    } | Out-Null
    
    $printDoc.Print()
    $printDoc.Dispose()
    $img.Dispose()
    
    Write-Output "Image print successful"
} catch {
    Write-Error "Image print failed: $_"
    exit 1
}
`;

    try {
      await this.executePowerShell(psScript, 30000);
      return {
        success: true,
        jobId,
        printedPages: 1
      };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      return {
        success: false,
        jobId,
        error: `Image print failed: ${errorMessage}`
      };
    }
  }

  async executePrintJob(job: PrintJob): Promise<PrintResult> {
    const { jobId, printerName, filePath, copies = 1, options, reportUrl, wsEndpoint } = job;
    
    log.info(`Executing print job ${jobId}: printer=${printerName}, file=${filePath}, copies=${copies}`);
    
    let ws: WebSocket | null = null;
    if (wsEndpoint) {
      try {
        ws = new WebSocket(wsEndpoint);
        this.setWebSocket(ws);
      } catch (err) {
        log.warn(`Failed to connect to WebSocket ${wsEndpoint}:`, err);
      }
    }
    
    try {
      if (!fs.existsSync(filePath)) {
        return {
          success: false,
          jobId,
          error: `File not found: ${filePath}`
        };
      }
      
      const ext = path.extname(filePath).toLowerCase();
      let result: PrintResult;
      
      if (ext === '.pdf') {
        result = await this.printPDF(filePath, printerName, copies);
      } else if (['.pcl', '.ps', '.prn'].includes(ext)) {
        result = await this.printRaw(filePath, printerName);
      } else if (['.png', '.jpg', '.jpeg', '.bmp', '.gif', '.tiff', '.tif'].includes(ext)) {
        result = await this.printImage(filePath, printerName);
      } else {
        result = await this.printPDFWithShellExecute(filePath, printerName, copies);
      }
      
      result.jobId = jobId;
      
      if (reportUrl) {
        result.reportUrl = reportUrl;
      }
      
      await this.reportResult(result);
      
      return result;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      log.error(`Print job ${jobId} failed:`, errorMessage);
      
      const result: PrintResult = {
        success: false,
        jobId,
        error: `Print job failed: ${errorMessage}`
      };
      
      if (reportUrl) {
        result.reportUrl = reportUrl;
        await this.reportResult(result);
      }
      
      return result;
    } finally {
      if (ws) {
        this.disconnectWebSocket();
      }
    }
  }

  private executePowerShell(script: string, timeout: number = 30000): Promise<string> {
    return new Promise((resolve, reject) => {
      const ps = spawn('powershell.exe', [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy', 'Bypass',
        '-Command', script
      ], {
        windowsHide: true
      });

      let stdout = '';
      let stderr = '';

      ps.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      ps.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      const timer = setTimeout(() => {
        ps.kill('SIGTERM');
        reject(new Error('PowerShell execution timeout'));
      }, timeout);

      ps.on('close', (code) => {
        clearTimeout(timer);
        
        if (code === 0) {
          resolve(stdout);
        } else {
          const errorMsg = stderr || stdout || `PowerShell exited with code ${code}`;
          reject(new Error(errorMsg));
        }
      });

      ps.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });
  }
}

export const jobExecutor = new JobExecutor();
export default jobExecutor;
