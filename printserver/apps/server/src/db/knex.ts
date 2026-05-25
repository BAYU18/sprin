import Knex from 'knex';
import type { Knex as KnexType } from 'knex';
import { logger } from '../utils/logger.js';

let knex: KnexType | null = null;

export async function setupDatabase(fastify: any) {
    const config: Knex.Config = {
        client: 'pg',
        connection: process.env.DATABASE_URL || {
            host: 'localhost',
            port: 5432,
            database: 'printserver',
            user: 'printserver',
            password: 'printserver'
        },
        pool: {
            min: 2,
            max: 20,
            acquireTimeoutMillis: 30000,
            idleTimeoutMillis: 30000
        },
        migrations: {
            directory: './db/migrations',
            tableName: 'knex_migrations'
        },
        debug: process.env.NODE_ENV === 'development'
    };

    knex = Knex(config);

    fastify.decorate('knex', knex);

    try {
        await knex.raw('SELECT 1');
        logger.info('Database connected successfully');

        await runMigrations(knex);
    } catch (error) {
        logger.error('Database connection failed:', error);
        throw error;
    }

    return knex;
}

async function runMigrations(knex: KnexType) {
    const exists = await knex.schema.hasTable('users');
    if (!exists) {
        logger.info('Running initial migration...');

        await knex.schema.createTable('users', (table) => {
            table.increments('id').primary();
            table.string('username').unique().notNullable();
            table.string('email').unique().notNullable();
            table.string('password_hash').notNullable();
            table.string('full_name');
            table.string('department');
            table.integer('quota_pages').defaultTo(1000);
            table.integer('quota_used').defaultTo(0);
            table.timestamp('quota_reset_at');
            table.boolean('is_active').defaultTo(true);
            table.boolean('is_verified').defaultTo(false);
            table.timestamp('last_login');
            table.timestamps(true, true);
        });

        await knex.schema.createTable('clients', (table) => {
            table.increments('id').primary();
            table.string('hostname').unique().notNullable();
            table.string('ip_address');
            table.string('mac_address');
            table.string('os_version');
            table.string('client_version').defaultTo('1.0.0');
            table.string('secret_key').unique();
            table.boolean('is_online').defaultTo(false);
            table.timestamp('last_seen');
            table.jsonb('metadata');
            table.timestamps(true, true);
        });

        await knex.schema.createTable('printer_groups', (table) => {
            table.increments('id').primary();
            table.string('name').unique().notNullable();
            table.string('description');
            table.jsonb('settings');
            table.timestamps(true, true);
        });

        await knex.schema.createTable('printers', (table) => {
            table.increments('id').primary();
            table.string('name').notNullable();
            table.string('driver');
            table.string('port');
            table.string('type').defaultTo('network');
            table.boolean('is_shared').defaultTo(true);
            table.string('share_name');
            table.boolean('is_default').defaultTo(false);
            table.string('status').defaultTo('offline');
            table.string('capabilities');
            table.jsonb('config');
            table.integer('group_id').unsigned().references('id').inTable('printer_groups');
            table.integer('priority').defaultTo(0);
            table.timestamps(true, true);
        });

        await knex.schema.createTable('print_jobs', (table) => {
            table.increments('id').primary();
            table.uuid('job_id').unique().defaultTo(knex.raw('gen_random_uuid()'));
            table.integer('user_id').unsigned().references('id').inTable('users').onDelete('SET NULL');
            table.integer('client_id').unsigned().references('id').inTable('clients').onDelete('SET NULL');
            table.integer('printer_id').unsigned().references('id').inTable('printers').onDelete('SET NULL');
            table.integer('queued_printer_id').unsigned().references('id').inTable('printers').onDelete('SET NULL');
            table.string('job_name');
            table.string('source_app');
            table.string('file_name');
            table.string('file_path');
            table.string('file_type');
            table.integer('file_size');
            table.integer('pages');
            table.integer('copies').defaultTo(1);
            table.string('status').defaultTo('queued');
            table.string('priority').defaultTo('normal');
            table.text('error_message');
            table.integer('attempts').defaultTo(0);
            table.timestamp('started_at');
            table.timestamp('completed_at');
            table.timestamps(true, true);
        });

        await knex.schema.createTable('queues', (table) => {
            table.increments('id').primary();
            table.integer('print_job_id').unsigned().references('id').inTable('print_jobs').onDelete('CASCADE');
            table.integer('printer_id').unsigned().references('id').inTable('printers').onDelete('CASCADE');
            table.integer('position').defaultTo(0);
            table.string('status').defaultTo('waiting');
            table.timestamp('scheduled_at');
            table.timestamp('started_at');
            table.timestamp('completed_at');
            table.timestamps(true, true);
        });

        await knex.schema.createTable('alerts', (table) => {
            table.increments('id').primary();
            table.integer('client_id').unsigned().references('id').inTable('clients').onDelete('SET NULL');
            table.integer('printer_id').unsigned().references('id').inTable('printers').onDelete('SET NULL');
            table.string('type');
            table.string('severity').defaultTo('info');
            table.string('title');
            table.text('message');
            table.boolean('is_resolved').defaultTo(false);
            table.timestamp('resolved_at');
            table.timestamps(true, true);
        });

        await knex.schema.createTable('retries', (table) => {
            table.increments('id').primary();
            table.integer('print_job_id').unsigned().references('id').inTable('print_jobs').onDelete('CASCADE');
            table.integer('printer_id').unsigned().references('id').inTable('printers').onDelete('SET NULL');
            table.string('reason');
            table.string('status').defaultTo('pending');
            table.integer('attempt_number');
            table.timestamps(true, true);
        });

        await knex.schema.createTable('printer_health', (table) => {
            table.increments('id').primary();
            table.integer('printer_id').unsigned().references('id').inTable('printers').onDelete('CASCADE');
            table.string('metric_name');
            table.string('metric_value');
            table.timestamp('recorded_at');
        });

        await knex.schema.createTable('audit_logs', (table) => {
            table.increments('id').primary();
            table.integer('user_id').unsigned().references('id').inTable('users').onDelete('SET NULL');
            table.string('action');
            table.string('resource_type');
            table.integer('resource_id');
            table.jsonb('details');
            table.string('ip_address');
            table.timestamps(true, true);
        });

        await knex.schema.createTable('quotas', (table) => {
            table.increments('id').primary();
            table.integer('user_id').unsigned().references('id').inTable('users').onDelete('CASCADE');
            table.string('quota_type');
            table.integer('limit_pages');
            table.integer('used_pages');
            table.string('period');
            table.timestamp('reset_at');
            table.timestamps(true, true);
        });

        await knex.schema.createTable('api_keys', (table) => {
            table.increments('id').primary();
            table.integer('user_id').unsigned().references('id').inTable('users').onDelete('CASCADE');
            table.string('name');
            table.string('key_hash').unique();
            table.string('permissions');
            table.boolean('is_active').defaultTo(true);
            table.timestamp('expires_at');
            table.timestamp('last_used_at');
            table.timestamps(true, true);
        });

        await knex.schema.createTable('notifications', (table) => {
            table.increments('id').primary();
            table.integer('user_id').unsigned().references('id').inTable('users').onDelete('CASCADE');
            table.string('channel');
            table.string('type');
            table.string('title');
            table.text('message');
            table.jsonb('data');
            table.boolean('is_sent').defaultTo(false);
            table.timestamp('sent_at');
            table.timestamps(true, true);
        });

        await knex.schema.createTable('windows_nodes', (table) => {
            table.increments('id').primary();
            table.string('node_name').notNullable();
            table.string('hostname');
            table.string('ip_address');
            table.string('secret_key').unique();
            table.string('status').defaultTo('offline');
            table.timestamp('last_seen');
            table.string('os_version');
            table.string('agent_version');
            table.timestamps(true, true);
        });

        await knex.schema.createTable('published_printers', (table) => {
            table.increments('id').primary();
            table.string('display_name').notNullable();
            table.string('printer_slug').unique().notNullable();
            table.string('windows_printer_name').notNullable();
            table.integer('node_id').unsigned().references('id').inTable('windows_nodes').onDelete('SET NULL');
            table.boolean('color_support').defaultTo(false);
            table.boolean('duplex_support').defaultTo(false);
            table.string('max_paper_size').defaultTo('A4');
            table.specificType('supported_formats', 'TEXT[]').defaultTo('{application/pdf}');
            table.boolean('is_published').defaultTo(true);
            table.string('location');
            table.text('description');
            table.timestamps(true, true);
        });

        await knex.schema.alterTable('print_jobs', (table) => {
            table.string('source_device');
            table.string('document_format');
            table.integer('ipp_job_id');
            table.integer('pages_total');
            table.integer('pages_printed');
            table.bigInteger('file_size_bytes');
            table.string('converted_format');
        });

        await knex.schema.alterTable('printers', (table) => {
            table.integer('node_id').unsigned().references('id').inTable('windows_nodes').onDelete('SET NULL');
        });

        await knex.schema.alterTable('clients', (table) => {
            table.integer('node_id').unsigned().references('id').inTable('windows_nodes').onDelete('SET NULL');
        });

        logger.info('Mobility Print migration completed');

        logger.info('Initial migration completed');
    }
}

export function getKnex() {
    return knex;
}

export { knex };