require('dotenv').config();

async function test() {
  console.log('Testing imports...');

  try {
    const { setupDatabase } = require('./dist/db/knex.js');
    console.log('DB module found');
  } catch (e) {
    console.log('No dist folder, using tsx directly');
  }

  // Test fastify imports
  try {
    const Fastify = require('fastify');
    console.log('Fastify version:', Fastify.prototype?.constructor?.name || 'loaded');
  } catch (e) {
    console.error('Fastify error:', e.message);
  }

  // Try running index directly with tsx
  console.log('Running index.ts with tsx...');
}

test();