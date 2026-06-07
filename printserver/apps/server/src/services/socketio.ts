import { Server } from 'socket.io';
import { logger } from '../utils/logger.js';
import { cache, cacheKeys } from '../utils/cache.js';

export function setupSocketIO(fastify: any) {
    const io = new Server(fastify.server, {
        cors: {
            origin: '*',
            methods: ['GET', 'POST']
        },
        transports: ['websocket', 'polling'],
        pingTimeout: 60000,
        pingInterval: 25000
    });

    io.on('connection', (socket) => {
        logger.info(`[Socket.IO] Client connected: ${socket.id}`);

        socket.on('register', (data) => {
            const { clientId, hostname } = data || {};
            if (clientId) {
                socket.join(`client:${clientId}`);
                logger.info(`[Socket.IO] Client ${hostname} registered in room client:${clientId}`);
            }
        });

        socket.on('subscribe', (data) => {
            const { room } = data || {};
            if (room) {
                socket.join(room);
                logger.info(`[Socket.IO] Socket ${socket.id} joined room: ${room}`);
            }
        });

        socket.on('unsubscribe', (data) => {
            const { room } = data || {};
            if (room) {
                socket.leave(room);
            }
        });

        socket.on('job:submit', (data) => {
            socket.broadcast.emit('job:new', data);
        });

        socket.on('job:progress', (data) => {
            socket.broadcast.emit('job:progress', data);
        });

        socket.on('job:complete', (data) => {
            socket.broadcast.emit('job:complete', data);
        });

        socket.on('job:error', (data) => {
            socket.broadcast.emit('job:error', data);
        });

        socket.on('printer:status', (data) => {
            socket.broadcast.emit('printer:status', data);
        });

        socket.on('client:heartbeat', (data) => {
            socket.broadcast.emit('client:heartbeat', data);
        });

        socket.on('disconnect', (reason) => {
            logger.info(`[Socket.IO] Client disconnected: ${socket.id}, reason: ${reason}`);
        });

        socket.on('error', (error) => {
            logger.error(`[Socket.IO] Socket error:`, error);
        });
    });

    // ── TIER-2 #1: Global cache invalidation hooks ──────────────────────────
    // When any printer/client/job-stats event fires, blow away the
    // corresponding cache key so the next API call re-reads the DB.
    const PRINTER_EVENTS = [
        'printer:update', 'printer:created', 'printer:deleted', 'printer:updated',
        'printer:status', 'printer:offline', 'printer:driver-assigned',
        'printer:failover', 'printer:auto-removed', 'printer:queue-cleared'
    ];
    for (const evt of PRINTER_EVENTS) {
        io.on(evt, () => {
            cache.invalidate(cacheKeys.printersList('default')).catch(() => {});
        });
    }
    io.on('client:heartbeat', () => {
        cache.invalidate(cacheKeys.clientsList()).catch(() => {});
    });
    io.on('client:status-changed', () => {
        cache.invalidate(cacheKeys.clientsList()).catch(() => {});
    });

    fastify.decorate('io', io);

    return io;
}