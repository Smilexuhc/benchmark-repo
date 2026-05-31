import fastify from 'fastify';
import cors from '@fastify/cors';
import { fastifyTRPCPlugin } from '@trpc/server/adapters/fastify';
import { appRouter, createContext } from '@benchmark-admin/server';

const server = fastify({ logger: true });

await server.register(cors, {
  origin: process.env.WEB_URL ?? 'http://localhost:5173',
  credentials: true,
});

await server.register(fastifyTRPCPlugin, {
  prefix: '/api/trpc',
  trpcOptions: {
    router: appRouter,
    createContext,
  },
});

server.get('/health', async () => ({ ok: true }));

const port = Number(process.env.PORT ?? 3000);
await server.listen({ port, host: '0.0.0.0' });
