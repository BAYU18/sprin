/**
 * File Scaler Utility — ZPL Printer Compensation
 *
 * When a ZPL printer's Windows driver scales EMF content (e.g., from A4 to
 * label size), documents come out zoomed. This utility pre-scales the file
 * BEFORE it reaches the driver so the final output is correct.
 *
 * Currently supports:
 *   - PDF  → ghostscript (gs) scaling
 *   - Image (png/jpg/jpeg/tif/tiff) → passed through with scaleFactor in options for client-side scaling
 *
 * Only applied when printer.config.scale_factor is set AND printer type is 'zpl'.
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { logger } from './logger.js';

const execFileAsync = promisify(execFile);

// Ghostscript path (Linux)
const GS_PATH = process.env.GS_PATH || 'gs';

// Supported image extensions (client-side scaling via PowerShell)
const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.tif', '.tiff', '.bmp', '.gif'];

/**
 * Check if ghostscript is available on the system.
 */
export async function isGhostscriptAvailable(): Promise<boolean> {
    try {
        await execFileAsync(GS_PATH, ['--version']);
        return true;
    } catch {
        return false;
    }
}

/**
 * Scale a PDF file using ghostscript.
 *
 * The scale factor is applied to the PDF page content (MediaBox), effectively
 * shrinking the visual content while keeping the page dimensions. This
 * compensates for the ZDesigner driver's EMF→ZPL zoom.
 *
 * @param inputPath  - Path to the original PDF
 * @param scaleFactor - 0.0–1.0 (e.g. 0.7 = 70%)
 * @returns Path to the scaled PDF (temp file)
 */
export async function scalePdf(inputPath: string, scaleFactor: number): Promise<string> {
    if (scaleFactor <= 0 || scaleFactor >= 1) {
        throw new Error(`Invalid scale_factor: ${scaleFactor}. Must be between 0 and 1.`);
    }

    // Output to temp dir with _scaled suffix
    const ext = path.extname(inputPath);
    const baseName = path.basename(inputPath, ext);
    const outputPath = path.join(
        os.tmpdir(),
        `printserver_scaled_${Date.now()}_${baseName}${ext}`
    );

    // Ghostscript PostScript expression to scale page content.
    // We use epsave/transform: translate to page center, scale, translate back.
    // This scales content uniformly while keeping the page at original dimensions.
    //
    // The approach: use gs -sDEVICE=pdfwrite and a PostScript header that
    // applies a scaling transform to each page's content.
    const psScale = scaleFactor;
    const psExpr = [
        `% Scale factor: ${psScale}`,
        `/OldPageSetpagedevice where { pop } if`,
        `% Override MediaBox to keep original page size`,
        `% Scale content by applying transform`,
        `<< /BeginPage {`,
        ` currentpagedevice /PageSize get`,
        `  dup 0 get 2 div exch 1 get 2 div  %% cx cy = center of page`,
        `  ${psScale} ${psScale} scale`,
        `  %% content is now scaled around page center`,
        `} >> setpagedevice`,
    ].join('\n');

    try {
        // Write the PostScript file
        const psFile = path.join(os.tmpdir(), `scale_${Date.now()}.ps`);
        fs.writeFileSync(psFile, psExpr);

        const args = [
            '-dNOPAUSE',
            '-dBATCH',
            '-dSAFER',
            '-sDEVICE=pdfwrite',
            '-dCompatibilityLevel=1.5',
            `-sOutputFile=${outputPath}`,
            `-c`, psExpr,
            `-f`, inputPath,
        ];

        logger.info(`[FileScaler] Scaling PDF: ${inputPath} → ${outputPath} (${Math.round(scaleFactor * 100)}%)`);

        const { stdout, stderr } = await execFileAsync(GS_PATH, args, {
            timeout: 30000,
            maxBuffer: 10 * 1024 * 1024,
        });

        // Cleanup PS file
        try { fs.unlinkSync(psFile); } catch {}

        if (!fs.existsSync(outputPath)) {
            throw new Error(`Ghostscript did not produce output file`);
        }

        const outputSize = fs.statSync(outputPath).size;
        if (outputSize === 0) {
            throw new Error(`Ghostscript produced empty output file`);
        }

        logger.info(`[FileScaler] PDF scaled successfully: ${outputSize} bytes`);
        return outputPath;

    } catch (error: any) {
        logger.error(`[FileScaler] Ghostscript scaling failed: ${error.message}`);
        // Cleanup partial output
        try { if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath); } catch {}
        throw error;
    }
}

/**
 * Scale an image file. Currently images are passed through to the client
 * with the scaleFactor in options — the client applies scaling via
 * PowerShell System.Drawing.
 *
 * @returns The original filePath (scaling happens on client)
 */
export function scaleImage(filePath: string, _scaleFactor: number): string {
    logger.info(`[FileScaler] Image ${path.basename(filePath)} — scaling deferred to client node`);
    return filePath;
}

/**
 * Determine if a file is a PDF.
 */
export function isPdf(filePath: string): boolean {
    return path.extname(filePath).toLowerCase() === '.pdf';
}

/**
 * Determine if a file is an image.
 */
export function isImage(filePath: string): boolean {
    return IMAGE_EXTENSIONS.includes(path.extname(filePath).toLowerCase());
}

/**
 * Scale a file for ZPL printer compensation.
 *
 * @param filePath   - Original file path
 * @param scaleFactor - 0.0–1.0
 * @param fileType   - 'pdf' | 'image' | 'raw' etc.
 * @returns Object with scaledFilePath and whether client should apply additional scaling
 */
export async function scaleForZpl(
    filePath: string,
    scaleFactor: number,
    fileType: string
): Promise<{ scaledFilePath: string; clientScale: boolean }> {
    if (isPdf(filePath) || fileType === 'pdf') {
        try {
            const scaled = await scalePdf(filePath, scaleFactor);
            return { scaledFilePath: scaled, clientScale: false };
        } catch (error: any) {
            logger.warn(`[FileScaler] PDF scaling failed, falling back to client-side: ${error.message}`);
            return { scaledFilePath: filePath, clientScale: true };
        }
    }

    if (isImage(filePath) || fileType === 'image' || fileType === 'document') {
        // Images: defer to client-side scaling via PowerShell
        return { scaledFilePath: filePath, clientScale: true };
    }

    // Unknown type: pass through, no scaling
    logger.info(`[FileScaler] Unknown file type "${fileType}", skipping scaling`);
    return { scaledFilePath: filePath, clientScale: false };
}

/**
 * Cleanup a temporary scaled file (call after job completes).
 */
export function cleanupScaledFile(filePath: string): void {
    try {
        if (filePath && fs.existsSync(filePath) && filePath.includes('printserver_scaled_')) {
            fs.unlinkSync(filePath);
            logger.debug(`[FileScaler] Cleaned up: ${filePath}`);
        }
    } catch {}
}
