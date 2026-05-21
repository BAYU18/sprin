import chokidar from 'chokidar';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import log from 'electron-log';
import os from 'os';

let watcher = null;

export function setupWatcher(store, onNewJob) {
    const spoolDirs = getSpoolDirectories(store);

    log.info('[SpoolWatcher] Setting up watchers on:', spoolDirs);

    watcher = chokidar.watch(spoolDirs, {
        persistent: true,
        ignoreInitial: true,
        depth: 1,
        awaitWriteFinish: {
            stabilityThreshold: 2000,
            pollInterval: 100
        }
    });

    watcher.on('add', async (filePath) => {
        const ext = path.extname(filePath).toLowerCase();
        const supportedExts = ['.pdf', '.ps', '.prn', '.tif', '.tiff', '.png', '.jpg', '.jpeg'];

        if (!supportedExts.includes(ext)) {
            return;
        }

        log.info('[SpoolWatcher] New file detected:', filePath);

        try {
            const stats = fs.statSync(filePath);
            const job = {
                id: uuidv4(),
                fileName: path.basename(filePath),
                filePath: filePath,
                fileSize: stats.size,
                fileType: getFileType(ext),
                pages: await estimatePages(filePath),
                copies: 1,
                sourceApp: detectSourceApp(filePath),
                user: os.userInfo().username,
                hostname: os.hostname(),
                timestamp: new Date().toISOString()
            };

            await onNewJob(job);
        } catch (error) {
            log.error('[SpoolWatcher] Error processing file:', error);
        }
    });

    watcher.on('error', (error) => {
        log.error('[SpoolWatcher] Error:', error);
    });

    return {
        start: () => {
            log.info('[SpoolWatcher] Started');
        },
        stop: () => {
            if (watcher) {
                watcher.close();
                watcher = null;
                log.info('[SpoolWatcher] Stopped');
            }
        }
    };
}

function getSpoolDirectories(store) {
    const defaultDirs = [
        'C:\\PrintServer\\Spool',
        'C:\\Windows\\System32\\spool\\PRINTERS',
        'C:\\Users\\' + os.userInfo().username + '\\AppData\\Local\\Temp'
    ];

    if (store.get('spoolDir')) {
        return [store.get('spoolDir')];
    }

    return defaultDirs.filter(dir => {
        try {
            return fs.existsSync(dir);
        } catch {
            return false;
        }
    });
}

function getFileType(ext) {
    const types = {
        '.pdf': 'application/pdf',
        '.ps': 'application/postscript',
        '.prn': 'application/x-printer',
        '.tif': 'image/tiff',
        '.tiff': 'image/tiff',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg'
    };
    return types[ext] || 'application/octet-stream';
}

function detectSourceApp(filePath) {
    const name = path.basename(filePath).toLowerCase();

    if (name.includes('word') || name.includes('docx')) return 'Microsoft Word';
    if (name.includes('excel') || name.includes('xlsx')) return 'Microsoft Excel';
    if (name.includes('powerpoint') || name.includes('pptx')) return 'Microsoft PowerPoint';
    if (name.includes('pdf') || name.includes('.pdf')) return 'PDF Reader';
    if (name.includes('chrome') || name.includes('edge') || name.includes('firefox')) return 'Browser';

    return 'Unknown';
}

async function estimatePages(filePath) {
    return 1;
}

export function watchSpoolDirectory(dir, onNewFile) {
    const watcher = chokidar.watch(dir, {
        persistent: true,
        ignoreInitial: false
    });

    watcher.on('add', onNewFile);

    return watcher;
}