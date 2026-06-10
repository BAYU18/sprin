// ────────────────────────────────────────────────────────────────────────────
// Fastify type augmentation — register custom decorators (knex, io, etc.) so
// the rest of the codebase can call `fastify.knex(...)` and `fastify.io.emit(...)`
// with full type safety. Without this, TypeScript treats them as `any`-with-error
// under `strict: true` and `tsc` refuses to emit the .d.ts / .js files.
// ────────────────────────────────────────────────────────────────────────────

import 'fastify';
import type { Knex } from 'knex';
import type { Server as SocketIOServer } from 'socket.io';

declare module 'fastify' {
    interface FastifyInstance {
        /** Knex query builder — initialised by `db/knex.ts` in src/index.ts. */
        knex: Knex;
        /** Socket.IO server reference for cross-route realtime events. */
        io?: SocketIOServer;
        /** Central print router used by /api/jobs/submit. */
        printRouter: any;
        /** IPP server instance (port 631 — test print, raw TCP, job dispatch). */
        ippServer?: any;
    }

    interface FastifyRequest {
        /** Populated by JWT auth middleware. */
        user?: {
            id: number;
            username: string;
            role: string;
        };
    }
}
