/**
 * PrintServer Pro - Database Migration 003
 * Add `role` column to users table
 *
 * Reason: routes/users.ts queries 'role' but original schema omitted it.
 * Auth system also assigns role on register (admin/user/etc).
 */

import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
    const hasRole = await knex.schema.hasColumn('users', 'role');
    if (!hasRole) {
        await knex.schema.alterTable('users', (table) => {
            table.string('role').defaultTo('user');  // user, admin, operator
        });
        console.log('[Migration 003] Added role column to users table');
    }
}

export async function down(knex: Knex): Promise<void> {
    const hasRole = await knex.schema.hasColumn('users', 'role');
    if (hasRole) {
        await knex.schema.alterTable('users', (table) => {
            table.dropColumn('role');
        });
        console.log('[Migration 003] Dropped role column from users table');
    }
}