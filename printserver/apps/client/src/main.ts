import { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage, dialog } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import Store from 'electron-store';
import { setupWatcher } from './services/spoolWatcher.js';
import { setupSocket } from './services/socket.js';
import { setupAPI } from './services/api.js';
import log from 'electron-log';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const store = new Store({
    name: 'config',
    defaults: {
        serverUrl: 'http://localhost:3000',
        clientId: null,
        secretKey: '',
        hostname: '',
        checkInterval: 10000,
        spoolDir: '',
        autoStart: true,
        minimizeToTray: true
    }
});

let mainWindow = null;
let tray = null;
let spoolWatcher = null;
let isQuitting = false;

function createTray() {
    const iconPath = path.join(__dirname, '../build/icon.png');
    let icon;

    try {
        icon = nativeImage.createFromPath(iconPath);
        if (icon.isEmpty()) {
            icon = nativeImage.createEmpty();
        }
    } catch {
        icon = nativeImage.createEmpty();
    }

    tray = new Tray(icon);
    tray.setToolTip('PrintServer Client');

    updateTrayMenu();

    tray.on('double-click', () => {
        if (mainWindow) {
            mainWindow.show();
            mainWindow.focus();
        }
    });
}

function updateTrayMenu(status = { online: false, jobs: 0, lastSync: null }) {
    const statusText = status.online ? 'Online' : 'Offline';
    const lastSyncText = status.lastSync
        ? `Last sync: ${new Date(status.lastSync).toLocaleTimeString()}`
        : 'Not synced';

    const contextMenu = Menu.buildFromTemplate([
        { label: `Status: ${statusText}`, enabled: false },
        { label: `${status.jobs} jobs in queue`, enabled: false },
        { label: lastSyncText, enabled: false },
        { type: 'separator' },
        {
            label: 'Open Dashboard',
            click: () => {
                require('electron').shell.openExternal(store.get('serverUrl'));
            }
        },
        {
            label: 'View Logs',
            click: () => {
                const logPath = log.transports.file.getFile().path;
                require('electron').shell.showItemInFolder(logPath);
            }
        },
        { type: 'separator' },
        {
            label: 'Settings',
            click: () => {
                if (mainWindow) {
                    mainWindow.show();
                    mainWindow.focus();
                }
            }
        },
        { type: 'separator' },
        {
            label: 'Restart Service',
            click: () => {
                restartServices();
            }
        },
        {
            label: 'Exit',
            click: () => {
                isQuitting = true;
                app.quit();
            }
        }
    ]);

    tray.setContextMenu(contextMenu);
}

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 600,
        height: 700,
        show: false,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js')
        }
    });

    mainWindow.loadURL(store.get('serverUrl') + '/client');

    mainWindow.on('close', (event) => {
        if (!isQuitting && store.get('minimizeToTray')) {
            event.preventDefault();
            mainWindow.hide();
        }
    });

    mainWindow.on('ready-to-show', () => {
        if (store.get('autoStart')) {
            mainWindow.hide();
        } else {
            mainWindow.show();
        }
    });
}

async function restartServices() {
    log.info('[Client] Restarting services...');

    if (spoolWatcher) {
        spoolWatcher.stop();
    }

    await setupSocket(store);
    setupWatcher(store, (job) => {
        handlePrintJob(job);
    });

    updateTrayMenu({ online: true, jobs: 0, lastSync: new Date() });
}

async function handlePrintJob(job) {
    log.info('[Client] New print job:', job.fileName);

    try {
        await setupAPI.uploadJob(store, job);
        log.info('[Client] Job uploaded successfully');
    } catch (error) {
        log.error('[Client] Failed to upload job:', error);
    }
}

app.whenReady().then(async () => {
    log.info('[Client] Starting PrintServer Client...');

    if (store.get('spoolDir')) {
        spoolWatcher = setupWatcher(store, handlePrintJob);
        spoolWatcher.start();
    }

    await setupSocket(store);

    createWindow();
    createTray();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
    }
});

app.on('before-quit', () => {
    isQuitting = true;
});

ipcMain.handle('get-config', () => {
    return {
        serverUrl: store.get('serverUrl'),
        clientId: store.get('clientId'),
        hostname: store.get('hostname'),
        spoolDir: store.get('spoolDir'),
        checkInterval: store.get('checkInterval')
    };
});

ipcMain.handle('save-config', (event, config) => {
    for (const [key, value] of Object.entries(config)) {
        store.set(key, value);
    }
    return { success: true };
});

ipcMain.handle('get-logs', async () => {
    const logPath = log.transports.file.getFile().path;
    return logPath;
});

export { store, updateTrayMenu };