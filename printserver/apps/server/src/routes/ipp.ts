import { FastifyInstance } from 'fastify';

export async function setupIPPRoutes(fastify: FastifyInstance) {
    // IPP Print routes placeholder
    // IPP (Internet Printing Protocol) server is handled in services/ipp-server.ts
    fastify.get('/ipp', async (request, reply) => {
        return { status: 'IPP server active', port: 631 };
    });
}