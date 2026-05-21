/**
 * PrintServer Pro - Database Migrations
 * Multi-Server Support: Nodes + Printers with Node FK
 */

import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
    // ============================================
    // Create nodes table (Windows Servers)
    // ============================================
    const nodesExists = await knex.schema.hasTable('nodes');
    if (!nodesExists) {
        await knex.schema.createTable('nodes', (table) => {
            table.increments('id').primary();
            table.string('node_name').unique().notNullable();
            table.string('hostname');
            table.string('ip_address');
            table.string('mac_address');
            table.string('api_url').notNullable();           // e.g., http://192.168.1.101:3000
            table.string('secret_key').unique();             // For authentication
            table.string('status').defaultTo('offline');    // online, offline, warning
            table.string('os_version');
            table.string('api_version').defaultTo('1.0.0');
            table.jsonb('metadata');                        // Additional info
            table.timestamp('last_heartbeat');
            table.timestamps(true, true);
        });

        console.log('[Migration] Created nodes table');
    }

    // ============================================
    // Update printers table - add node_id FK
    // ============================================
    const printersHasNodeId = await knex.schema.hasColumn('printers', 'node_id');
    if (!printersHasNodeId) {
        await knex.schema.alterTable('printers', (table) => {
            table.integer('node_id').unsigned()
                .references('id')
                .inTable('nodes')
                .onDelete('SET NULL')
                .alter();
        });

        console.log('[Migration] Added node_id column to printers table');
    }

    // ============================================
    // Add node_id to print_jobs (for tracking which node processed)
    // ============================================
    const jobsHasNodeId = await knex.schema.hasColumn('print_jobs', 'node_id');
    if (!jobsHasNodeId) {
        await knex.schema.alterTable('print_jobs', (table) => {
            table.integer('node_id').unsigned()
                .references('id')
                .inTable('nodes')
                .onDelete('SET NULL');
        });

        console.log('[Migration] Added node_id column to print_jobs table');
    }

    // ============================================
    // Add columns to clients for multi-node support
    // ============================================
    const clientsHasNodeId = await knex.schema.hasColumn('clients', 'node_id');
    if (!clientsHasNodeId) {
        await knex.schema.alterTable('clients', (table) => {
            table.integer('node_id').unsigned()
                .references('id')
                .inTable('nodes')
                .onDelete('SET NULL');
        });

        console.log('[Migration] Added node_id column to clients table');
    }

    // ============================================
    // Create node_heartbeats table for monitoring
    // ============================================
    const heartbeatsExists = await knex.schema.hasTable('node_heartbeats');
    if (!heartbeatsExists) {
        await knex.schema.createTable('node_heartbeats', (table) => {
            table.increments('id').primary();
            table.integer('node_id').unsigned()
                .references('id')
                .inTable('nodes')
                .onDelete('CASCADE');
            table.integer('printers_online').defaultTo(0);
            table.integer('printers_offline').defaultTo(0);
            table.integer('jobs_in_queue').defaultTo(0);
            table.integer('active_jobs').defaultTo(0);
            table.string('cpu_usage');
            table.string('memory_usage');
            table.timestamp('recorded_at');
            table.timestamps(true, true);
        });

        console.log('[Migration] Created node_heartbeats table');
    }

    // ============================================
    // Create index for faster queries
    // ============================================
    await knex.schema.alterTable('printers', (table) => {
        table.index('node_id');
    });

    await knex.schema.alterTable('nodes', (table) => {
        table.index('status');
        table.index('last_heartbeat');
    });

    console.log('[Migration] Created indexes for performance');
}

export async function down(knex: Knex): Promise<void> {
    // Drop columns first (order matters due to FK constraints)
    await knex.schema.alterTable('print_jobs', (table) => {
        table.dropColumn('node_id');
    });

    await knex.schema.alterTable('clients', (table) => {
        table.dropColumn('node_id');
    });

    await knex.schema.alterTable('printers', (table) => {
        table.dropColumn('node_id');
    });

    await knex.schema.dropTableIfExists('node_heartbeats');
    await knex.schema.dropTableIfExists('nodes');

    console.log('[Migration] Rolled back multi-node changes');
}