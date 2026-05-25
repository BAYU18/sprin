// Debug startup - isolate which part fails
import('dotenv').config({ path: '/root/serverbot/print/printserver/apps/server/.env' }).then(() => {
  console.log('1. dotenv loaded');
  console.log('   DATABASE_URL:', process.env.DATABASE_URL || 'NOT SET');
  console.log('   REDIS_URL:', process.env.REDIS_URL || 'NOT SET');

  return import('fastify');
}).then(({ default: Fastify }) => {
  console.log('2. fastify loaded');
  console.log('   Fastify version:', Fastify.prototype?.constructor?.name);

  // Build a minimal server to test
  const fastify = Fastify({ logger: false });

  // Test database
  return fastify.register(async (instance) => {
    instance.get('/test-db', async () => {
      try {
        const knex = (await import('knex')).default({
          client: 'pg',
          connection: process.env.DATABASE_URL || 'postgres://printserver:printserver123@localhost:5432/printserver'
        });
        await knex.raw('SELECT 1');
        await knex.destroy();
        return { db: 'ok' };
      } catch (e) {
        return { db: 'fail', error: e.message };
      }
    });
  });
}).then(fastify => {
  console.log('3. fastify plugins registered');
  console.log('All imports successful!');
  process.exit(0);
}).catch(err => {
  console.error('ERROR:', err.message);
  console.error(err.stack);
  process.exit(1);
});