// Test the setup functions step by step
import('dotenv').then(dotenv => {
  dotenv.config({ path: '/root/serverbot/print/printserver/apps/server/.env' });
  console.log('1. dotenv loaded');
});

async function main() {
  try {
    const Fastify = (await import('fastify')).default;
    console.log('2. fastify loaded');

    const fastify = Fastify({
      logger: {
        level: 'info',
        transport: { target: 'pino-pretty', options: { colorize: true } }
      }
    });
    console.log('3. fastify instance created');

    await fastify.register((await import('@fastify/cors')).default);
    console.log('4. cors registered');

    await fastify.register((await import('@fastify/helmet')).default);
    console.log('5. helmet registered');

    await fastify.register((await import('@fastify/jwt')).default, {
      secret: 'test-secret'
    });
    console.log('6. jwt registered');

    await fastify.register((await import('@fastify/websocket')).default);
    console.log('7. websocket registered');

    // Now test setupDatabase
    console.log('8. Testing setupDatabase...');
    const { setupDatabase } = await import('./src/db/knex.js');
    await setupDatabase(fastify);
    console.log('9. setupDatabase succeeded');

    // Test setupRedis
    console.log('10. Testing setupRedis...');
    const { setupRedis } = await import('./src/services/redis.js');
    await setupRedis(fastify);
    console.log('11. setupRedis succeeded');

    console.log('All setup functions work!');
    await fastify.close();
    process.exit(0);
  } catch (err) {
    console.error('Error:', err.message);
    console.error(err.stack);
    process.exit(1);
  }
}

main();