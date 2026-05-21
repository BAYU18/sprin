import { io } from 'socket.io-client';
import log from 'electron-log';

let socket = null;
let store = null;

export async function setupSocket(configStore) {
    store = configStore;
    const serverUrl = store.get('serverUrl');

    if (!serverUrl) {
        log.error('[Socket] No server URL configured');
        return;
    }

    log.info('[Socket] Connecting to:', serverUrl);

    socket = io(serverUrl, {
        transports: ['websocket', 'polling'],
        reconnection: true,
        reconnectionAttempts: 10,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 30000,
        timeout: 20000
    });

    socket.on('connect', () => {
        log.info('[Socket] Connected:', socket.id);

        socket.emit('register', {
            clientId: store.get('clientId'),
            hostname: store.get('hostname') || require('os').hostname()
        });
    });

    socket.on('disconnect', (reason) => {
        log.warn('[Socket] Disconnected:', reason);
    });

    socket.on('connect_error', (error) => {
        log.error('[Socket] Connection error:', error.message);
    });

    socket.on('job:print', (data) => {
        log.info('[Socket] Received job:print command:', data);
    });

    socket.on('command', (data) => {
        log.info('[Socket] Command received:', data);
        handleCommand(data);
    });

    return socket;
}

function handleCommand(command) {
    const { action, payload } = command;

    switch (action) {
        case 'restart':
            log.info('[Socket] Restart command received');
            break;
        case 'update_config':
            log.info('[Socket] Config update:', payload);
            if (payload.spoolDir) {
                store.set('spoolDir', payload.spoolDir);
            }
            break;
        default:
            log.warn('[Socket] Unknown command:', action);
    }
}

export function getSocket() {
    return socket;
}

export function emit(event, data) {
    if (socket && socket.connected) {
        socket.emit(event, data);
    } else {
        log.warn('[Socket] Cannot emit, not connected');
    }
}