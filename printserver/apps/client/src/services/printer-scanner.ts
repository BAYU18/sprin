import { exec, ChildProcess } from 'child_process';
import { promisify } from 'util';
import log from 'electron-log';
import { EventEmitter } from 'events';

const execAsync = promisify(exec);

export enum PrinterStatus {
  Other = 1,
  Unknown = 2,
  Idle = 3,
  Printing = 4,
  Offline = 5
}

export interface PrinterInfo {
  name: string;
  driver: string;
  port: string;
  status: PrinterStatus;
  isShared: boolean;
  shareName: string;
}

type PrinterChangeCallback = (printers: PrinterInfo[]) => void;

export class PrinterScanner extends EventEmitter {
  private monitoringInterval: NodeJS.Timeout | null = null;
  private lastPrinterList: PrinterInfo[] = [];
  private isMonitoring = false;
  private currentProcess: ChildProcess | null = null;

  constructor() {
    super();
    log.info('[PrinterScanner] Initialized');
  }

  private parseCSVToPrinters(csvOutput: string): PrinterInfo[] {
    const lines = csvOutput.trim().split('\n');
    if (lines.length < 2) {
      return [];
    }

    const printers: PrinterInfo[] = [];
    const headerLine = lines[0].toLowerCase();

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      const parts = line.split(',');
      if (parts.length < 5) continue;

      const node = parts[0] || '';
      const name = parts[1] || '';
      const driverName = parts[2] || '';
      const portName = parts[3] || '';
      const printerStatus = parseInt(parts[4], 10) || PrinterStatus.Unknown;
      const sharedStr = parts[5] || 'FALSE';
      const shareName = parts[6] || '';

      if (!name || name === 'NULL' || name === '') continue;

      const isShared = sharedStr.toUpperCase() === 'TRUE' || sharedStr === '1';

      printers.push({
        name,
        driver: driverName,
        port: portName,
        status: printerStatus as PrinterStatus,
        isShared,
        shareName
      });
    }

    return printers;
  }

  private async executeWMIC(): Promise<string> {
    const command = 'wmic printer get Name,DriverName,PortName,PrinterStatus,Shared /format:csv';
    
    try {
      const { stdout, stderr } = await execAsync(command, {
        timeout: 30000,
        windowsHide: true
      });

      if (stderr && stderr.trim()) {
        log.warn('[PrinterScanner] WMIC stderr:', stderr);
      }

      return stdout;
    } catch (error) {
      const err = error as Error;
      log.error('[PrinterScanner] WMIC execution error:', err.message);
      throw error;
    }
  }

  async scanPrinters(): Promise<PrinterInfo[]> {
    log.info('[PrinterScanner] Scanning printers...');

    try {
      const csvOutput = await this.executeWMIC();
      const printers = this.parseCSVToPrinters(csvOutput);
      
      this.lastPrinterList = printers;
      log.info(`[PrinterScanner] Found ${printers.length} printer(s)`);
      
      return printers;
    } catch (error) {
      const err = error as Error;
      log.error('[PrinterScanner] Failed to scan printers:', err.message);
      return this.lastPrinterList;
    }
  }

  private detectChanges(currentPrinters: PrinterInfo[]): boolean {
    if (currentPrinters.length !== this.lastPrinterList.length) {
      return true;
    }

    const lastNames = new Set(this.lastPrinterList.map(p => p.name));
    for (const printer of currentPrinters) {
      if (!lastNames.has(printer.name)) {
        return true;
      }
    }

    for (const lastPrinter of this.lastPrinterList) {
      const current = currentPrinters.find(p => p.name === lastPrinter.name);
      if (!current) {
        return true;
      }
      if (current.status !== lastPrinter.status) {
        return true;
      }
      if (current.isShared !== lastPrinter.isShared) {
        return true;
      }
    }

    return false;
  }

  private async pollPrinters(): Promise<void> {
    if (!this.isMonitoring) return;

    try {
      const printers = await this.scanPrinters();
      
      if (this.detectChanges(printers)) {
        log.info('[PrinterScanner] Printer changes detected');
        this.emit('printer-change', printers);
        
        const callbacks = this.getPrinterChangeCallbacks();
        for (const callback of callbacks) {
          try {
            callback(printers);
          } catch (callbackError) {
            const err = callbackError as Error;
            log.error('[PrinterScanner] Callback error:', err.message);
          }
        }
      }
    } catch (error) {
      const err = error as Error;
      log.error('[PrinterScanner] Polling error:', err.message);
    }
  }

  private getPrinterChangeCallbacks(): PrinterChangeCallback[] {
    return this.listeners('printer-change') as PrinterChangeCallback[];
  }

  startMonitoring(intervalMs: number = 5000): void {
    if (this.isMonitoring) {
      log.warn('[PrinterScanner] Already monitoring');
      return;
    }

    if (intervalMs < 1000) {
      intervalMs = 1000;
      log.warn('[PrinterScanner] Interval too small, using 1000ms minimum');
    }

    this.isMonitoring = true;
    log.info(`[PrinterScanner] Starting monitoring with ${intervalMs}ms interval`);

    this.pollPrinters();

    this.monitoringInterval = setInterval(() => {
      this.pollPrinters();
    }, intervalMs);
  }

  stopMonitoring(): void {
    if (!this.isMonitoring) {
      log.warn('[PrinterScanner] Not currently monitoring');
      return;
    }

    this.isMonitoring = false;

    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
    }

    if (this.currentProcess) {
      this.currentProcess.kill();
      this.currentProcess = null;
    }

    log.info('[PrinterScanner] Stopped monitoring');
  }

  onPrinterChange(callback: PrinterChangeCallback): void {
    this.on('printer-change', callback);
    log.info('[PrinterScanner] Registered printer change callback');
  }

  removePrinterChangeCallback(callback: PrinterChangeCallback): void {
    this.off('printer-change', callback);
    log.info('[PrinterScanner] Removed printer change callback');
  }

  cleanup(): void {
    log.info('[PrinterScanner] Cleaning up...');
    this.stopMonitoring();
    this.removeAllListeners();
    log.info('[PrinterScanner] Cleanup complete');
  }

  getMonitoringStatus(): boolean {
    return this.isMonitoring;
  }

  getLastPrinterList(): PrinterInfo[] {
    return [...this.lastPrinterList];
  }
}

export default PrinterScanner;
