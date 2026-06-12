/**
 * PrintServer Pro - Database Migration 005
 * Add `is_paused` column to `printers` table.
 *
 * Reason: TIER-2 #8 — Queue Management Dashboard. We need a durable, queryable
 * "this printer's queue is paused" flag independent from the in-process
 * `printQueue.isPaused()` boolean. The DB flag survives restarts and lets the
 * printer-engine refuse to pick up jobs even before BullMQ workers run.
 *
 * It is *additive*: defaults to false, so existing printers stay active.
 */

import { Knex } from 'knex';

async function indexExists(knex: Knex, table: string, indexName: string): Promise<boolean> {
    // pg-specific: query pg_indexes for a clean boolean answer
    const row = await knex.raw(
        'SELECT 1 FROM pg_indexes WHERE schemaname = current_schema() AND tablename = ? AND indexname = ? LIMIT 1',
        [table, indexName]
    );
    const rows = row?.rows || row || [];
    return Array.isArray(rows) ? rows.length > 0 : !!rows;
}

export async function up(knex: Knex): Promise<void> {
    const hasIsPaused = await knex.schema.hasColumn('printers', 'is_paused');
    if (!hasIsPaused) {
        await knex.schema.alterTable('printers', (table) => {
            table.boolean('is_paused').defaultTo(false).notNullable();
        });
        console.log('[Migration 005] Added is_paused column to printers table');
    }

    // Helpful index for "give me all paused printers" queries
    const idxExists = await indexExists(knex, 'printers', 'printers_is_paused_idx');
    if (!idxExists) {
        await knex.schema.alterTable('printers', (table) => {
            table.index('is_paused', 'printers_is_paused_idx');
        });
        console.log('[Migration 005] Added index printers_is_paused_idx');
    }
}

export async function down(knex: Knex): Promise<void> {
    const idxExists = await indexExists(knex, 'printers', 'printers_is_paused_idx');
    if (idxExists) {
        await knex.schema.alterTable('printers', (table) => {
            table.dropIndex('is_paused', 'printers_is_paused_idx');
        });
    }

    const hasIsPaused = await knex.schema.hasColumn('printers', 'is_paused');
    if (hasIsPaused) {
        await knex.schema.alterTable('printers', (table) => {
            table.dropColumn('is_paused');
        });
        console.log('[Migration 005] Dropped is_paused column from printers table');
    }
}
