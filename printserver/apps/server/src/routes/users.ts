import { FastifyInstance } from 'fastify';
import { z } from 'zod';

const userSchema = z.object({
    username: z.string().min(3),
    email: z.string().email(),
    password: z.string().min(6).optional(),
    full_name: z.string().optional(),
    department: z.string().optional(),
    role: z.enum(['super_admin', 'admin', 'operator', 'user']).default('user'),
    quota_pages: z.number().default(1000),
    is_active: z.boolean().default(true)
});

export async function setupUsersRoutes(fastify: FastifyInstance) {
    fastify.get('/', async (request, reply) => {
        const users = await fastify.knex('users')
            .select('id', 'username', 'email', 'full_name', 'department', 'role', 'quota_pages', 'quota_used', 'is_active', 'last_login', 'created_at')
            .orderBy('username');

        return users;
    });

    fastify.get('/:id', async (request, reply) => {
        const { id } = request.params as { id: string };

        const user = await fastify.knex('users')
            .select('id', 'username', 'email', 'full_name', 'department', 'role', 'quota_pages', 'quota_used', 'is_active', 'last_login', 'created_at')
            .where({ id })
            .first();

        if (!user) {
            return reply.status(404).send({ error: 'User not found' });
        }

        const stats = await fastify.knex('print_jobs')
            .where({ user_id: id })
            .select(
                fastify.knex.raw('COUNT(*) as total_jobs'),
                fastify.knex.raw('SUM(pages * copies) as total_pages'),
                fastify.knex.raw("SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed")
            )
            .first();

        return { ...user, stats };
    });

    fastify.post('/', async (request, reply) => {
        const body = userSchema.parse(request.body);

        const existing = await fastify.knex('users')
            .where('username', body.username)
            .orWhere('email', body.email)
            .first();

        if (existing) {
            return reply.status(409).send({ error: 'Username or email already exists' });
        }

        const bcrypt = await import('bcryptjs');
        const password_hash = await bcrypt.hash(body.password || 'changeme123', 12);

        const [user] = await fastify.knex('users')
            .insert({
                username: body.username,
                email: body.email,
                password_hash,
                full_name: body.full_name,
                department: body.department,
                role: body.role,
                quota_pages: body.quota_pages,
                is_active: body.is_active
            })
            .returning('*');

        delete user.password_hash;
        return user;
    });

    fastify.put('/:id', async (request, reply) => {
        const { id } = request.params as { id: string };
        const body = userSchema.partial().parse(request.body);

        if (body.password) {
            const bcrypt = await import('bcryptjs');
            body.password_hash = await bcrypt.hash(body.password, 12);
            delete body.password;
        }

        const [user] = await fastify.knex('users')
            .where({ id })
            .update(body)
            .returning('*');

        if (!user) {
            return reply.status(404).send({ error: 'User not found' });
        }

        delete user.password_hash;
        return user;
    });

    fastify.delete('/:id', async (request, reply) => {
        const { id } = request.params as { id: string };

        await fastify.knex('users')
            .where({ id })
            .delete();

        return { success: true };
    });

    fastify.get('/:id/quota', async (request, reply) => {
        const { id } = request.params as { id: string };

        const user = await fastify.knex('users')
            .where({ id })
            .select('quota_pages', 'quota_used', 'quota_reset_at')
            .first();

        if (!user) {
            return reply.status(404).send({ error: 'User not found' });
        }

        const thisMonth = new Date();
        thisMonth.setDate(1);
        thisMonth.setHours(0, 0, 0, 0);

        const monthUsage = await fastify.knex('print_jobs')
            .where({ user_id: id })
            .where('status', 'completed')
            .where('completed_at', '>=', thisMonth)
            .select(fastify.knex.raw('SUM(pages * copies) as pages'))
            .first();

        return {
            ...user,
            this_month_usage: monthUsage?.pages || 0,
            remaining: user.quota_pages - (monthUsage?.pages || 0)
        };
    });
}