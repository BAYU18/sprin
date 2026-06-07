// ────────────────────────────────────────────────────────────────────────────
// TIER-2 #1: Redis cache helper with fail-safe behaviour.
//
// Usage:
//   const data = await cache.getOrSet('printers:list', 10, async () => {
//     return await knex('printers')...
//   });
//
//   // Invalidate on update
//   cache.invalidate('printers:list');
//
// If Redis is down/unavailable, cache is a no-op (every call goes through to
// the loader fn) — never breaks the request path.
// ────────────────────────────────────────────────────────────────────────────

import { logger } from '../utils/logger.js';
import IORedis, { type Redis } from 'ioredis';

let client: Redis | null = null;
let isReady = false;
let connectAttempted = false;

function getRedisUrl(): string {
    return process.env.REDIS_URL || 'redis://127.0.0.1:6379';
}

function tryConnect(): Redis | null {
    if (connectAttempted) return isReady ? client : null;
    connectAttempted = true;
    try {
        client = new IORedis(getRedisUrl(), {
            maxRetriesPerRequest: 1,
            enableOfflineQueue: false,
            lazyConnect: false,
            connectTimeout: 2000,
            // Don't crash the server if redis is down
            retryStrategy: (times) => (times > 5 ? null : 1000)
        });
        client.on('ready', () => {
            isReady = true;
            logger.info('[Cache] Redis ready');
        });
        client.on('error', (err) => {
            if (isReady) {
                logger.warn(`[Cache] Redis error: ${err.message}`);
            }
            isReady = false;
        });
        client.on('end', () => { isReady = false; });
    } catch (err) {
        logger.warn(`[Cache] Failed to construct Redis client: ${(err as Error).message}`);
        client = null;
    }
    return isReady ? client : null;
}

interface CacheStats {
    hits: number;
    misses: number;
    sets: number;
    invalidations: number;
    errors: number;
    skipped: number;
}

const stats: CacheStats = { hits: 0, misses: 0, sets: 0, invalidations: 0, errors: 0, skipped: 0 };

export const cache = {
    /**
     * Get value from cache. Returns null on miss, error, or no redis.
     */
    async get<T = any>(key: string): Promise<T | null> {
        const c = tryConnect();
        if (!c || !isReady) {
            stats.skipped++;
            return null;
        }
        try {
            const raw = await c.get(key);
            if (raw === null) {
                stats.misses++;
                return null;
            }
            stats.hits++;
            return JSON.parse(raw) as T;
        } catch (err) {
            stats.errors++;
            logger.warn(`[Cache] get(${key}) error: ${(err as Error).message}`);
            return null;
        }
    },

    /**
     * Set value with TTL (seconds). Silent on error.
     */
    async set<T = any>(key: string, value: T, ttlSec: number): Promise<boolean> {
        const c = tryConnect();
        if (!c || !isReady) {
            stats.skipped++;
            return false;
        }
        try {
            await c.set(key, JSON.stringify(value), 'EX', ttlSec);
            stats.sets++;
            return true;
        } catch (err) {
            stats.errors++;
            logger.warn(`[Cache] set(${key}) error: ${(err as Error).message}`);
            return false;
        }
    },

    /**
     * Get-or-set pattern: try cache first, on miss call loader and store result.
     */
    async getOrSet<T = any>(key: string, ttlSec: number, loader: () => Promise<T>): Promise<T> {
        const self = this as any;
        const cached: T | null = await self.get(key);
        if (cached !== null) return cached;
        const fresh = await loader();
        await self.set(key, fresh, ttlSec);
        return fresh;
    },

    /**
     * Invalidate a key (or pattern like "printers:*"). For pattern, uses SCAN
     * to avoid blocking Redis with KEYS command.
     */
    async invalidate(keyOrPattern: string): Promise<number> {
        const c = tryConnect();
        if (!c || !isReady) {
            stats.skipped++;
            return 0;
        }
        try {
            let removed = 0;
            if (keyOrPattern.includes('*')) {
                // SCAN to find matching keys, then DEL in batches
                const stream = c.scanStream({ match: keyOrPattern, count: 100 });
                const keys: string[] = [];
                for await (const batch of stream) {
                    keys.push(...(batch as string[]));
                }
                if (keys.length > 0) {
                    removed = await c.del(...keys);
                }
            } else {
                removed = await c.del(keyOrPattern);
            }
            stats.invalidations += removed;
            return removed;
        } catch (err) {
            stats.errors++;
            logger.warn(`[Cache] invalidate(${keyOrPattern}) error: ${(err as Error).message}`);
            return 0;
        }
    },

    /**
     * Get cache stats (for /api/health/cache endpoint).
     */
    stats(): CacheStats & { enabled: boolean } {
        return { ...stats, enabled: isReady };
    },

    /**
     * Test connectivity. Returns true if redis is responding to PING.
     */
    async ping(): Promise<boolean> {
        const c = tryConnect();
        if (!c) return false;
        try {
            await c.ping();
            return true;
        } catch {
            return false;
        }
    }
};

// ── Cache key helpers ───────────────────────────────────────────────────────
export const cacheKeys = {
    printersList: (query: string = '') => `printers:list:${query}`,
    clientsList: () => 'clients:list:all',
    analytics: (range: string) => `analytics:${range}`,
    jobStatsToday: () => 'jobs:stats:today'
};
