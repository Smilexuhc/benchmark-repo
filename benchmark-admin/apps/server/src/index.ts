import { appRouter, createContext, db } from '@benchmark-admin/server';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import { COOKIE_NAME, requireSession, revokeToken, signToken, verifyCredentials } from '@benchmark-admin/server/auth';
import { buildExportZip } from '@benchmark-admin/server/services/exports';
import * as storage from '@benchmark-admin/server/services/storage';
import { env } from '@benchmark-admin/shared/env';
import { videoBenchmarkItems, videoBenchmarkMediaLinks, assetImages } from '@benchmark-admin/shared/db/schema';
import { fastifyTRPCPlugin } from '@trpc/server/adapters/fastify';
import { sql, isNull, eq } from 'drizzle-orm';
import fastify from 'fastify';

const server = fastify({ logger: true });

await server.register(cors, {
  origin: process.env.WEB_URL ?? 'http://localhost:5173',
  credentials: true,
});

await server.register(cookie);
await server.register(multipart);

// Rate limiting — disabled globally; enabled per-route where needed
await server.register(rateLimit, { global: false });

await server.register(fastifyTRPCPlugin, {
  prefix: '/api/trpc',
  trpcOptions: {
    router: appRouter,
    createContext,
  },
});

// ── Health (R25) ──────────────────────────────────────────────────────────────
// Returns per-dependency booleans; non-200 when any dep is down. Public — no secrets.

server.get('/health', async (_request, reply) => {
  const [dbOk, tosOk] = await Promise.all([
    db.execute(sql`SELECT 1`).then(() => true).catch(() => false),
    storage.healthCheck(),
  ]);
  const aiOk = Boolean(env.OPENROUTER_API_KEY);
  const ok = dbOk && tosOk && aiOk;
  reply.status(ok ? 200 : 503);
  return { ok, db: dbOk, tos: tosOk, ai: aiOk };
});

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

// ── Upload ────────────────────────────────────────────────────────────────────

const MAX_UPLOAD_BYTES = 50 * 1024 * 1024; // 50 MB

server.post('/api/upload', { preHandler: requireSession }, async (request, reply) => {
  const contentLength = request.headers['content-length'];
  if (contentLength && Number(contentLength) > MAX_UPLOAD_BYTES) {
    return reply.status(413).send({ error: 'File too large' });
  }

  const data = await request.file({ limits: { fileSize: MAX_UPLOAD_BYTES } });
  if (!data) return reply.status(400).send({ error: 'No file' });

  const chunks: Buffer[] = [];
  let totalBytes = 0;
  for await (const chunk of data.file) {
    totalBytes += chunk.length;
    if (totalBytes > MAX_UPLOAD_BYTES) {
      return reply.status(413).send({ error: 'File too large' });
    }
    chunks.push(chunk as Buffer);
  }

  const bytes = Buffer.concat(chunks);
  const rawExt = (data.filename.split('.').pop() ?? 'bin').toLowerCase();
  const prefix: 'images' | 'audios' | 'videos' =
    rawExt === 'png' || rawExt === 'jpg' || rawExt === 'jpeg' || rawExt === 'webp'
      ? 'images'
      : rawExt === 'mp3' || rawExt === 'wav' || rawExt === 'm4a'
        ? 'audios'
        : 'videos';

  const objectKey = storage.newObjectKey(`.${rawExt}`, prefix);
  await storage.putObject(objectKey, bytes, data.mimetype);
  return reply.send({ objectKey });
});

// ── Export ZIP ────────────────────────────────────────────────────────────────

server.get<{ Params: { kind: string } }>(
  '/api/export/:kind.zip',
  { preHandler: requireSession },
  async (request, reply) => {
    const { kind } = request.params;

    reply.header('Content-Type', 'application/zip');
    reply.header('Content-Disposition', `attachment; filename="${kind}.zip"`);

    // Fetch benchmark items and their media links for the export
    const items = await db
      .select()
      .from(videoBenchmarkItems)
      .where(isNull(videoBenchmarkItems.deletedAt));

    const itemIds = items.map((i) => i.id);

    const imageLinks =
      itemIds.length > 0
        ? await db
            .select({
              objectKey: assetImages.objectKey,
              role: videoBenchmarkMediaLinks.role,
              itemId: videoBenchmarkMediaLinks.itemId,
            })
            .from(videoBenchmarkMediaLinks)
            .innerJoin(assetImages, eq(videoBenchmarkMediaLinks.mediaId, assetImages.id))
            .where(eq(videoBenchmarkMediaLinks.role, 'character_image'))
        : [];

    // biome-ignore lint/suspicious/noExplicitAny: schema rows are plain objects
    await buildExportZip(kind, items as any[], imageLinks, reply);
  },
);

const port = Number(process.env.PORT ?? 3000);
await server.listen({ port, host: '0.0.0.0' });
