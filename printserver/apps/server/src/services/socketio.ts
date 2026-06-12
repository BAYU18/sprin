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
            // socket.broadcast.emit bypasses our io.emit wrapper, so invalidate here too
            cache.invalidate(cacheKeys.printersList('default')).catch(() => {});
        });

        socket.on('client:heartbeat', (data) => {
            socket.broadcast.emit('client:heartbeat', data);
            cache.invalidate(cacheKeys.clientsList()).catch(() => {});
        });

        // ── Driver harvest progress/result relay (agent → dashboard) ─────────
        // Agent memancarkan progress & hasil akhir export driver. Server hanya
        // meneruskan ke semua dashboard yang terhubung agar UI bisa update.
        socket.on('driver:harvest:progress', (data) => {
            socket.broadcast.emit('driver:harvest:progress', data);
        });
        socket.on('driver:harvest:result', (data) => {
            socket.broadcast.emit('driver:harvest:result', data);
        });

        socket.on('disconnect', (reason) => {
            logger.info(`[Socket.IO] Client disconnected: ${socket.id}, reason: ${reason}`);
        });

        socket.on('error', (error) => {
            logger.error(`[Socket.IO] Socket error:`, error);
        });
    });

    // ── TIER-2 #1: Global cache invalidation on broadcast ───────────────────
    // IMPORTANT: io.on('customEvent') does NOT fire on the server — io.on only
    // handles 'connection'. Custom events emitted via io.emit() go OUT to
    // browsers and never trigger a server-side listener. The previous io.on()
    // hooks here were dead code, so the printers/clients list cache (60s TTL)
    // was never invalidated on status changes → stale "kadang ada kadang tidak"
    // data until the TTL happened to expire.
    //
    // Fix: wrap io.emit so EVERY broadcast is the single chokepoint that
    // invalidates the matching cache key. This catches all emit sites
    // (heartbeat, health-check offline, driver-assign, etc.) without having to
    // touch a dozen files.
    const originalEmit = io.emit.bind(io);
    (io as any).emit = (event: string, ...args: any[]) => {
        try {
            if (typeof event === 'string') {
                if (event.startsWith('printer:')) {
                    cache.invalidate(cacheKeys.printersList('default')).catch(() => {});
                } else if (event.startsWith('client:')) {
                    cache.invalidate(cacheKeys.clientsList()).catch(() => {});
                }
            }
        } catch { /* never let cache invalidation break the emit */ }
        return originalEmit(event, ...args);
    };

    fastify.decorate('io', io);

    return io;
}