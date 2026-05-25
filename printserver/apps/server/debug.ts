// Test the setup functions step by step - use tsx to handle TS imports
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

    // Now test setupDatabase - use tsx to handle .ts
    console.log('8. Testing setupDatabase...');
    // We need to use dynamic import with tsx loader
    const knexModule = await import('./src/db/knex.ts');
    await knexModule.setupDatabase(fastify);
    console.log('9. setupDatabase succeeded');

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