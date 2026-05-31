import { appRouter, createContext } from '@benchmark-admin/server';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { COOKIE_NAME, requireSession, revokeToken, signToken, verifyCredentials } from '@benchmark-admin/server/auth';
import { fastifyTRPCPlugin } from '@trpc/server/adapters/fastify';
import fastify from 'fastify';

const server = fastify({ logger: true });

await server.register(cors, {
  origin: process.env.WEB_URL ?? 'http://localhost:5173',
  credentials: true,
});

await server.register(cookie);

// Rate limiting — disabled globally; enabled per-route where needed
await server.register(rateLimit, { global: false });

await server.register(fastifyTRPCPlugin, {
  prefix: '/api/trpc',
  trpcOptions: {
    router: appRouter,
    createContext,
  },
});

server.get('/health', async () => ({ ok: true }));

// ── Auth routes ───────────────────────────────────────────────────────────────

server.post(
  '/api/auth/login',
  {
    config: {
      rateLimit: {
        max: 10,
        timeWindow: '1 minute',
      },
    },
  },
  async (request, reply) => {
    const { email, password } = request.body as { email?: string; password?: string };
    if (!email || !password) {
      return reply.status(400).send({ error: 'email and password required' });
    }
    if (!verifyCredentials(email, password)) {
      return reply.status(401).send({ error: 'Invalid credentials' });
    }
    const token = signToken();
    reply.setCookie(COOKIE_NAME, token, {
      httpOnly: true,
      sameSite: 'strict',
      secure: process.env.NODE_ENV !== 'development',
      path: '/',
    });
    return reply.send({ ok: true });
  },
);

server.post(
  '/api/auth/logout',
  { preHandler: requireSession },
  async (request, reply) => {
    const cookies = (request as typeof request & { cookies?: Record<string, string | undefined> })
      .cookies;
    const token = cookies?.[COOKIE_NAME];
    if (token) revokeToken(token);
    reply.clearCookie(COOKIE_NAME, { path: '/' });
    return reply.send({ ok: true });
  },
);

const port = Number(process.env.PORT ?? 3000);
await server.listen({ port, host: '0.0.0.0' });
