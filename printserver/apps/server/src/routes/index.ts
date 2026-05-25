import { FastifyInstance } from 'fastify';
import { setupAuth } from '../auth/index.js';
import { setupPrintersRoutes } from './printers.js';
import { setupJobsRoutes } from './jobs.js';
import { setupClientsRoutes } from './clients.js';
import { setupUsersRoutes } from './users.js';
import { setupAlertsRoutes } from './alerts.js';
import { setupAnalyticsRoutes } from './analytics.js';
import { setupSettingsRoutes } from './settings.js';
import { setupNodeInternalRoutes } from './node-internal.js';
import { setupNodesRoutes } from './nodes.js';
import { setupDiscoveryRoutes } from './discovery.js';
import { setupSetupRoutes } from './setup.js';
import { setupIPPRoutes } from './ipp.js';

export async function setupRoutes(fastify: FastifyInstance) {
    await fastify.register(setupAuth);

    await fastify.register(setupPrintersRoutes, { prefix: '/api/printers' });
    await fastify.register(setupJobsRoutes, { prefix: '/api/jobs' });
    await fastify.register(setupClientsRoutes, { prefix: '/api/clients' });
    await fastify.register(setupUsersRoutes, { prefix: '/api/users' });
    await fastify.register(setupAlertsRoutes, { prefix: '/api/alerts' });
    await fastify.register(setupAnalyticsRoutes, { prefix: '/api/analytics' });
    await fastify.register(setupSettingsRoutes, { prefix: '/api/settings' });

    const IS_NODE = process.env.IS_NODE === 'true';
    if (IS_NODE) {
        await fastify.register(setupNodeInternalRoutes);
        fastify.log.info('[Routes] Node internal routes registered');
    }

    const IS_CENTRAL = process.env.IS_CENTRAL !== 'false';
    if (IS_CENTRAL) {
        await fastify.register(setupDiscoveryRoutes, { prefix: '/api' });
        await fastify.register(setupNodesRoutes, { prefix: '/api/nodes' });
        fastify.log.info('[Routes] Discovery and Nodes routes registered');
    }

    await fastify.register(setupSetupRoutes);
    await fastify.register(setupIPPRoutes);
    fastify.log.info('[Routes] Setup and IPP routes registered');
}