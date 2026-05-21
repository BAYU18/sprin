import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
    getConfig: () => ipcRenderer.invoke('get-config'),
    saveConfig: (config) => ipcRenderer.invoke('save-config', config),
    getLogs: () => ipcRenderer.invoke('get-logs'),

    onJobReceived: (callback) => {
        ipcRenderer.on('job:received', (event, job) => callback(job));
    },

    onStatusUpdate: (callback) => {
        ipcRenderer.on('status:update', (event, status) => callback(status));
    },

    onCommand: (callback) => {
        ipcRenderer.on('command', (event, cmd) => callback(cmd));
    },

    platform: process.platform,
    isWindows: process.platform === 'win32'
});