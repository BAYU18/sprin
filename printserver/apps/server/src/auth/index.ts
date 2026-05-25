import { Request, Response, FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { logger } from '../utils/logger.js';
import { z } from 'zod';

const loginSchema = z.object({
    username: z.string().min(3),
    password: z.string().min(6)
});

const registerSchema = z.object({
    username: z.string().min(3),
    email: z.string().email(),
    password: z.string().min(6),
    full_name: z.string().optional(),
    department: z.string().optional()
});

export async function setupAuth(fastify: FastifyInstance) {
    fastify.post('/api/auth/login', async (request: Request, reply: Response) => {
        try {
            const body = loginSchema.parse(request.body);
            const { username, password } = body;

            const user = await fastify.knex('users').where({ username }).first();

            if (!user) {
                return reply.status(401).send({ error: 'Invalid credentials' });
            }

            const validPassword = await bcrypt.compare(password, user.password_hash);

            if (!validPassword) {
                return reply.status(401).send({ error: 'Invalid credentials' });
            }

            if (!user.is_active) {
                return reply.status(403).send({ error: 'Account is disabled' });
            }

            await fastify.knex('users').where({ id: user.id }).update({ last_login: new Date() });

            const token = fastify.jwt.sign({
                id: user.id,
                username: user.username,
                role: user.role || 'user'
            });

            const refreshToken = fastify.jwt.sign(
                { id: user.id, type: 'refresh' },
                { expiresIn: '7d' }
            );

            return {
                token,
                refreshToken,
                user: {
                    id: user.id,
                    username: user.username,
                    email: user.email,
                    full_name: user.full_name,
                    role: user.role || 'user'
                }
            };
        } catch (error) {
            logger.error('[Auth] Login error:', error?.message || error, error?.stack);
            console.error('[Auth] Full error:', JSON.stringify(error, Object.getOwnPropertyNames(error)));
            return reply.status(500).send({ error: 'Login failed', details: error?.message });
        }
    });

    fastify.post('/api/auth/register', async (request: Request, reply: Response) => {
        try {
            const body = registerSchema.parse(request.body);

            const existing = await fastify.knex('users')
                .where('username', body.username)
                .orWhere('email', body.email)
                .first();

            if (existing) {
                return reply.status(409).send({ error: 'Username or email already exists' });
            }

            const bcrypt = await import('bcryptjs');
            const password_hash = await bcrypt.hash(body.password, 12);

            const [user] = await fastify.knex('users')
                .insert({
                    username: body.username,
                    email: body.email,
                    password_hash,
                    full_name: body.full_name,
                    department: body.department
                })
                .returning('*');

            const token = fastify.jwt.sign({
                id: user.id,
                username: user.username,
                role: 'user'
            });

            return {
                token,
                user: {
                    id: user.id,
                    username: user.username,
                    email: user.email
                }
            };
        } catch (error) {
            logger.error('[Auth] Register error:', error);
            return reply.status(500).send({ error: 'Registration failed' });
        }
    });

    fastify.post('/api/auth/refresh', async (request: Request, reply: Response) => {
        try {
            const { refreshToken } = request.body as { refreshToken?: string };

            if (!refreshToken) {
                return reply.status(401).send({ error: 'Refresh token required' });
            }

            const decoded = fastify.jwt.verify(refreshToken);

            if (decoded.type !== 'refresh') {
                return reply.status(401).send({ error: 'Invalid refresh token' });
            }

            const user = await fastify.knex('users').where({ id: decoded.id }).first();

            if (!user || !user.is_active) {
                return reply.status(401).send({ error: 'User not found or disabled' });
            }

            const token = fastify.jwt.sign({
                id: user.id,
                username: user.username,
                role: user.role || 'user'
            });

            return { token };
        } catch (error) {
            return reply.status(401).send({ error: 'Invalid refresh token' });
        }
    });

    fastify.post('/api/auth/logout', async (request: Request, reply: Response) => {
        return { success: true };
    });
}