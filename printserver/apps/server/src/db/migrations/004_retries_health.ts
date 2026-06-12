/**
 * PrintServer Pro - Database Migration 004
 * Add `error_message`, `started_at`, `completed_at` to retries table
 * Add `printer_drivers` table (referenced in driver JOINs but never created)
 * Add `driver_id` FK to printers table
 *
 * Reason: GET /api/jobs/:jobId surfaces per-attempt error_message and duration
 * in the timeline/attempts_history response, and the dashboard's printer
 * detail page binds `printer.driver_id` / `printer.driver_name`. The
 * `printer_drivers` table is the join target for the existing
 * `printers.driver_id` column and the seed data used by the auto-assigner.
 */

import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
    // ============================================
    // retries: add error_message + attempt duration
    // ============================================
    const retriesHasError = await knex.schema.hasColumn('retries', 'error_message');
    if (!retriesHasError) {
        await knex.schema.alterTable('retries', (table) => {
            table.text('error_message');
        });
        console.log('[Migration 004] Added error_message column to retries table');
    }

    const retriesHasStarted = await knex.schema.hasColumn('retries', 'started_at');
    if (!retriesHasStarted) {
        await knex.schema.alterTable('retries', (table) => {
            table.timestamp('started_at');
        });
        console.log('[Migration 004] Added started_at column to retries table');
    }

    const retriesHasCompleted = await knex.schema.hasColumn('retries', 'completed_at');
    if (!retriesHasCompleted) {
        await knex.schema.alterTable('retries', (table) => {
            table.timestamp('completed_at');
        });
        console.log('[Migration 004] Added completed_at column to retries table');
    }

    // ============================================
    // printer_drivers: catalog of known drivers
    // ============================================
    const driversExists = await knex.schema.hasTable('printer_drivers');
    if (!driversExists) {
        await knex.schema.createTable('printer_drivers', (table) => {
            table.increments('id').primary();
            table.string('name').notNullable();
            table.string('manufacturer');
            table.text('description');
            table.boolean('is_builtin').defaultTo(false);
            table.text('install_instructions');
            table.string('download_url');
            table.timestamps(true, true);
        });
        console.log('[Migration 004] Created printer_drivers table');
    }

    // ============================================
    // printers: add driver_id FK (idempotent)
    // ============================================
    const printersHasDriverId = await knex.schema.hasColumn('printers', 'driver_id');
    if (!printersHasDriverId) {
        await knex.schema.alterTable('printers', (table) => {
            table.integer('driver_id').unsigned()
                .references('id')
                .inTable('printer_drivers')
                .onDelete('SET NULL');
        });
        console.log('[Migration 004] Added driver_id column to printers table');
    }

    // Indexes for the lookup-heavy paths in /api/jobs/:jobId
    const hasRetriesJobIdx = await knex.raw(`
        SELECT 1 FROM pg_indexes
        WHERE schemaname = 'public' AND tablename = 'retries' AND indexname = 'retries_print_job_id_index'
    `);
    if (!hasRetriesJobIdx.rows?.length) {
        await knex.schema.alterTable('retries', (table) => {
            table.index('print_job_id');
        });
    }

    const hasDriversNameIdx = await knex.raw(`
        SELECT 1 FROM pg_indexes
        WHERE schemaname = 'public' AND tablename = 'printer_drivers' AND indexname = 'printer_drivers_name_index'
    `);
    if (!hasDriversNameIdx.rows?.length) {
        await knex.schema.alterTable('printer_drivers', (table) => {
            table.index('name');
        });
    }
}

export async function down(knex: Knex): Promise<void> {
    // Drop printer driver_id FK first to keep order correct on rollback
    const printersHasDriverId = await knex.schema.hasColumn('printers', 'driver_id');
    if (printersHasDriverId) {
        await knex.schema.alterTable('printers', (table) => {
            table.dropColumn('driver_id');
        });
        console.log('[Migration 004] Dropped driver_id column from printers table');
    }

    await knex.schema.dropTableIfExists('printer_drivers');

    // Drop the new retry columns
    const retriesHasCompleted = await knex.schema.hasColumn('retries', 'completed_at');
    if (retriesHasCompleted) {
        await knex.schema.alterTable('retries', (table) => {
            table.dropColumn('completed_at');
        });
    }
    const retriesHasStarted = await knex.schema.hasColumn('retries', 'started_at');
    if (retriesHasStarted) {
        await knex.schema.alterTable('retries', (table) => {
            table.dropColumn('started_at');
        });
    }
    const retriesHasError = await knex.schema.hasColumn('retries', 'error_message');
    if (retriesHasError) {
        await knex.schema.alterTable('retries', (table) => {
            table.dropColumn('error_message');
        });
    }

    console.log('[Migration 004] Rollback complete');
}
