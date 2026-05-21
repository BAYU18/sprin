import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { logger } from '../utils/logger.js';

export interface PrinterCapabilities {
    id?: number;
    name?: string;
    supports_pdf_direct?: boolean;
    driver_type?: string;
    device_uri?: string;
    pdl?: string[];
}

export interface JobOptions {
    jobId?: string;
    printerId?: number;
    userId?: number;
    copies?: number;
    duplex?: boolean;
    paperSize?: string;
}

const MAGIC_BYTES: Record<string, { bytes: number[]; offset: number; mime: string }> = {
    'application/pdf': { bytes: [0x25, 0x50, 0x44, 0x46], offset: 0 },
    'image/urf': { bytes: [0x55, 0x52, 0x46, 0x57], offset: 0 },
    'image/pwg-raster': { bytes: [0x55, 0x53, 0x54, 0x4F], offset: 0 },
};

export function detectFormat(buffer: Buffer): string {
    for (const [mime, config] of Object.entries(MAGIC_BYTES)) {
        const { bytes, offset } = config;
        const matches = bytes.every((b, i) => buffer[offset + i] === b);
        if (matches) {
            logger.debug(`Detected format: ${mime}`);
            return mime;
        }
    }
    return 'application/octet-stream';
}

export function getGhostscriptPath(): string {
    const envPath = process.env.GHOSTSCRIPT_PATH;
    if (envPath && fs.existsSync(envPath)) {
        return envPath;
    }

    const possiblePaths = [
        'C:\\Program Files\\gs\\gs10.03.1\\bin\\gswin64c.exe',
        'C:\\Program Files\\gs\\gs10.03.1\\bin\\gswin32c.exe',
        'C:\\Program Files\\Ghostscript\\bin\\gswin64c.exe',
        'C:\\Program Files\\Ghostscript\\bin\\gswin32c.exe',
        '/usr/bin/gs',
        '/usr/local/bin/gs',
    ];

    for (const p of possiblePaths) {
        if (fs.existsSync(p)) {
            return p;
        }
    }

    return 'gs';
}

function getPclDriver(): string {
    const device = process.env.GHOSTSCRIPT_PCL_DEVICE;
    if (device) {
        return device;
    }
    return 'ljet4';
}

async function convertWithGhostscript(
    inputPath: string,
    outputPath: string,
    ghostscriptPath: string
): Promise<boolean> {
    return new Promise((resolve) => {
        const device = getPclDriver();
        const args = [
            '-dBATCH',
            '-dNOPAUSE',
            `-sDEVICE=${device}`,
            `-sOutputFile=${outputPath}`,
            inputPath,
        ];

        logger.info(`Running Ghostscript: ${ghostscriptPath} ${args.join(' ')}`);

        const proc = spawn(ghostscriptPath, args, {
            windowsHide: true,
        });

        let stderr = '';

        proc.stderr.on('data', (data: Buffer) => {
            stderr += data.toString();
        });

        proc.on('error', (err: Error) => {
            logger.error({ err }, 'Ghostscript spawn error');
            resolve(false);
        });

        proc.on('close', (code: number | null) => {
            if (code === 0) {
                logger.info('Ghostscript conversion completed successfully');
                resolve(true);
            } else {
                logger.error({ code, stderr }, 'Ghostscript conversion failed');
                resolve(false);
            }
        });
    });
}

async function writeTempFile(buffer: Buffer, suffix: string): Promise<string> {
    const tempDir = os.tmpdir();
    const tempFile = path.join(tempDir, `printjob-${Date.now()}-${Math.random().toString(36).substring(7)}${suffix}`);
    await fs.promises.writeFile(tempFile, buffer);
    logger.debug({ tempFile }, 'Temporary file created');
    return tempFile;
}

async function cleanupTempFile(filePath: string): Promise<void> {
    try {
        if (fs.existsSync(filePath)) {
            await fs.promises.unlink(filePath);
            logger.debug({ filePath }, 'Temporary file cleaned up');
        }
    } catch (err) {
        logger.warn({ err, filePath }, 'Failed to cleanup temporary file');
    }
}

export async function convertJob(
    documentBuffer: Buffer,
    printerCapabilities: PrinterCapabilities,
    jobOptions: JobOptions = {}
): Promise<Buffer> {
    const { jobId, printerId } = jobOptions;

    logger.info({
        jobId,
        printerId,
        bufferSize: documentBuffer.length,
        printerCapabilities,
    }, 'Starting job conversion');

    const format = detectFormat(documentBuffer);
    logger.debug({ format }, 'Detected document format');

    if (format === 'application/pdf' && printerCapabilities.supports_pdf_direct) {
        logger.info({ jobId }, 'Printer supports PDF direct, returning PDF buffer as-is');
        return documentBuffer;
    }

    if (format !== 'application/pdf' && format !== 'image/urf' && format !== 'image/pwg-raster') {
        logger.warn({ jobId, format }, 'Unsupported format, returning original buffer');
        return documentBuffer;
    }

    const gsPath = getGhostscriptPath();
    let gsAvailable = false;

    try {
        const testProc = spawn(gsPath, ['-h'], { windowsHide: true });
        await new Promise<void>((resolve) => {
            testProc.on('close', (code) => {
                gsAvailable = code === 0;
                resolve();
            });
            testProc.on('error', () => {
                gsAvailable = false;
                resolve();
            });
            setTimeout(resolve, 2000);
        });
    } catch {
        gsAvailable = false;
    }

    if (!gsAvailable) {
        logger.warn({ jobId }, 'Ghostscript not available, falling back to original buffer');
        return documentBuffer;
    }

    let inputTempFile: string | null = null;
    let outputTempFile: string | null = null;

    try {
        const inputSuffix = format === 'application/pdf' ? '.pdf' : format === 'image/urf' ? '.urf' : '.pwg';
        inputTempFile = await writeTempFile(documentBuffer, inputSuffix);

        const outputSuffix = '.pcl';
        outputTempFile = path.join(os.tmpdir(), `printjob-${Date.now()}-${Math.random().toString(36).substring(7)}${outputSuffix}`);

        const success = await convertWithGhostscript(inputTempFile, outputTempFile, gsPath);

        if (!success) {
            logger.warn({ jobId }, 'Ghostscript conversion failed, returning original buffer');
            return documentBuffer;
        }

        if (!fs.existsSync(outputTempFile)) {
            logger.warn({ jobId }, 'Ghostscript output file not found, returning original buffer');
            return documentBuffer;
        }

        const outputBuffer = await fs.promises.readFile(outputTempFile);
        logger.info({
            jobId,
            originalSize: documentBuffer.length,
            convertedSize: outputBuffer.length,
        }, 'Job conversion completed successfully');

        return outputBuffer;
    } catch (err) {
        logger.error({ err, jobId }, 'Error during job conversion, returning original buffer');
        return documentBuffer;
    } finally {
        if (inputTempFile) {
            await cleanupTempFile(inputTempFile);
        }
        if (outputTempFile) {
            await cleanupTempFile(outputTempFile);
        }
    }
}

export const jobConverter = {
    convertJob,
    detectFormat,
    getGhostscriptPath,
};

export default jobConverter;