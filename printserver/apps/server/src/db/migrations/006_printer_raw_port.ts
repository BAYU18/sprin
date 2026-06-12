/**
 * PrintServer Pro - Database Migration 006
 * Add `raw_port` column to `printers` table (Opsi C — RAW per-port routing).
 *
 * Reason: multi-printer-per-node support. Each printer bound to a node gets a
 * dedicated RAW TCP listen port on the server (9100, 9101, ...). The Windows
 * client installs a Standard TCP/IP port pointing at <server>:<raw_port>, so
 * print data lands on exactly the right printer — no fragile name-hint routing.
 *
 * Additive + idempotent. Backfill assigns 9100+ to printers that have a
 * client_id but no raw_port yet, ordered by id.
 *
 * NOTE: the repo's runMigrations() only fires on first-ever boot (no `users`
 * table). This file documents the change; it was also applied directly via SQL
 * on the live DB. Keep both in sync.
 */

import { Knex } from 'knex';

export const RAW_PORT_BASE = 9100;

export async function up(knex: Knex): Promise<void> {
    const hasCol = await knex.schema.hasColumn('printers', 'raw_port');
    if (!hasCol) {
        await knex.schema.alterTable('printers', (t) => {
            t.integer('raw_port').unique();
        });
        console.log('[Migration 006] Added raw_port column to printers');
    }

    // Backfill: 9100+ for node-bound printers missing a port, ordered by id.
    await knex.raw(`
        WITH numbered AS (
            SELECT id, ${RAW_PORT_BASE} + (ROW_NUMBER() OVER (ORDER BY id)) - 1 AS newport
            FROM printers
            WHERE client_id IS NOT NULL AND raw_port IS NULL
        )
        UPDATE printers p SET raw_port = n.newport FROM numbered n WHERE p.id = n.id;
    `);
    console.log('[Migration 006] Backfilled raw_port for existing printers');
}

export async function down(knex: Knex): Promise<void> {
    const hasCol = await knex.schema.hasColumn('printers', 'raw_port');
    if (hasCol) {
        await knex.schema.alterTable('printers', (t) => {
            t.dropColumn('raw_port');
        });
        console.log('[Migration 006] Dropped raw_port column from printers');
    }
}
