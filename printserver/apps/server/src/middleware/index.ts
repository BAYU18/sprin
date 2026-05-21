import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { logger } from '../utils/logger.js';

export async function setupMiddleware(fastify: FastifyInstance) {
    fastify.addHook('onRequest', async (request, reply) => {
        const start = Date.now();

        reply.addHook('onSend', async (reply, payload) => {
            const duration = Date.now() - start;
            logger.debug({
                method: request.method,
                url: request.url,
                statusCode: reply.statusCode,
                duration: `${duration}ms`
            });
            return payload;
        });
    });

    fastify.addHook('preHandler', async (request, reply) => {
        if (request.url.startsWith('/api/')) {
            if (request.url.startsWith('/api/auth/')) {
                return;
            }

            const publicRoutes = ['/api/health', '/api/ready'];
            if (publicRoutes.includes(request.url)) {
                return;
            }

            try {
                const authHeader = request.headers.authorization;
                if (authHeader && authHeader.startsWith('Bearer ')) {
                    const token = authHeader.substring(7);
                    const decoded = fastify.jwt.verify(token);
                    request.user = decoded;
                }
            } catch (error) {
                logger.debug('[Middleware] JWT verification failed:', (error as Error).message);
            }
        }
    });

    fastify.addHook('errorHandler', async (error, request, reply) => {
        logger.error('[Error]', {
            url: request.url,
            method: request.method,
            error: error.message,
            stack: error.stack
        });

        if (error.validation) {
            return reply.status(400).send({
                error: 'Validation Error',
                details: error.validation
            });
        }

        return reply.status(error.statusCode || 500).send({
            error: error.message || 'Internal Server Error'
        });
    });
}

export function authMiddleware(fastify: FastifyInstance) {
    return async function (request: FastifyRequest, reply: FastifyReply) {
        const authHeader = request.headers.authorization;

        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return reply.status(401).send({ error: 'Authentication required' });
        }

        try {
            const token = authHeader.substring(7);
            const decoded = fastify.jwt.verify(token);
            request.user = decoded;
        } catch (error) {
            return reply.status(403).send({ error: 'Invalid or expired token' });
        }
    };
}

export function requireRole(...roles: string[]) {
    return async function (request: FastifyRequest, reply: FastifyReply) {
        if (!request.user) {
            return reply.status(401).send({ error: 'Authentication required' });
        }

        if (!roles.includes(request.user.role)) {
            return reply.status(403).send({ error: 'Insufficient permissions' });
        }
    };
}