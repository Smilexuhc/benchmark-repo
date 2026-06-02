import { appRouter, createContext, db } from '@benchmark-admin/server';
import {
  COOKIE_NAME,
  readSessionFromToken,
  requireSession,
  revokeToken,
  signToken,
  verifyCredentials,
} from '@benchmark-admin/server/auth';
import {
  type AssetExportItem,
  type AssetExportMedia,
  buildAssetExportZip,
  buildExportZip,
} from '@benchmark-admin/server/services/exports';
import * as storage from '@benchmark-admin/server/services/storage';
import { validateUpload } from '@benchmark-admin/server/services/upload';
import {
  assets,
  media,
  videoBenchmarkItems,
  videoBenchmarkMediaLinks,
} from '@benchmark-admin/shared/db/schema';
import { env } from '@benchmark-admin/shared/env';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import { fastifyTRPCPlugin } from '@trpc/server/adapters/fastify';
import { type SQL, and, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import fastify from 'fastify';

const server = fastify({ logger: true });

// ── Error handler — prevents driver/internal errors from leaking to clients ───

server.setErrorHandler((err: Error & { statusCode?: number }, _request, reply) => {
  server.log.error(err);
  const status = err.statusCode ?? 500;
  const message = status < 500 ? err.message : 'Internal server error';
  reply.status(status).send({ error: message });
});

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
    db
      .execute(sql`SELECT 1`)
      .then(() => true)
      .catch(() => false),
    storage.healthCheck(),
  ]);
  const ai_configured = Boolean(env.OPENROUTER_API_KEY);
  const ok = dbOk && tosOk && ai_configured;
  reply.status(ok ? 200 : 503);
  return { ok, db: dbOk, tos: tosOk, ai_configured };
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

server.get('/api/auth/me', async (request, reply) => {
  const cookies = (request as typeof request & { cookies?: Record<string, string | undefined> })
    .cookies;
  const token = cookies?.[COOKIE_NAME];
  const session = token ? readSessionFromToken(token) : null;
  return reply.send({ session });
});

server.post('/api/auth/logout', { preHandler: requireSession }, async (request, reply) => {
  const cookies = (request as typeof request & { cookies?: Record<string, string | undefined> })
    .cookies;
  const token = cookies?.[COOKIE_NAME];
  if (token) revokeToken(token);
  reply.clearCookie(COOKIE_NAME, { path: '/' });
  return reply.send({ ok: true });
});

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

  // Extension allowlist + magic-byte sniffing (extracted, unit-tested module).
  const validation = validateUpload(data.filename, bytes);
  if (!validation.ok) {
    return reply.status(400).send({ error: validation.error });
  }

  const objectKey = storage.newObjectKey(`.${validation.ext}`, validation.prefix);
  // Use server-authoritative content type — never trust client-supplied mimetype
  await storage.putObject(objectKey, bytes, validation.contentType);
  return reply.send({ objectKey });
});

// ── Export ZIP ────────────────────────────────────────────────────────────────

// Valid export kinds — validated to prevent Content-Disposition header injection
const VALID_EXPORT_KINDS = new Set(['benchmark', 'character', 'scene', 'prop']);
const ASSET_EXPORT_KINDS = new Set(['character', 'scene', 'prop']);
// Asset filters keyed by JSONB data field vs promoted column.
const ASSET_DATA_FILTER_KEYS = ['type', 'gender', 'age', 'scene_type', 'mood', 'category'];

function asArray(v: string | string[] | undefined): string[] {
  if (v === undefined) return [];
  return Array.isArray(v) ? v : [v];
}

server.get<{
  Params: { kind: string };
  Querystring: {
    search?: string;
    shotType?: string;
    questionType?: string;
    needsRevision?: string;
    deletedOnly?: string;
    era?: string | string[];
    genre?: string | string[];
    type?: string | string[];
    gender?: string | string[];
    age?: string | string[];
    scene_type?: string | string[];
    mood?: string | string[];
    category?: string | string[];
  };
}>('/api/export/:kind.zip', { preHandler: requireSession }, async (request, reply) => {
  const { kind } = request.params;

  if (!VALID_EXPORT_KINDS.has(kind)) {
    return reply.status(400).send({ error: 'Invalid export kind' });
  }

  // ── Asset library export (character / scene / prop) ──
  if (ASSET_EXPORT_KINDS.has(kind)) {
    const aq = request.query;
    const assetConditions: SQL[] = [
      eq(assets.kind, kind),
      aq.deletedOnly === 'true' ? isNotNull(assets.deletedAt) : isNull(assets.deletedAt),
    ];
    if (aq.search?.trim()) {
      const term = `%${aq.search.trim()}%`;
      assetConditions.push(
        sql`(${assets.name} ILIKE ${term} OR cast(${assets.data} as text) ILIKE ${term})`,
      );
    }
    const eraVals = asArray(aq.era);
    if (eraVals.length) assetConditions.push(inArray(assets.era, eraVals));
    const genreVals = asArray(aq.genre);
    if (genreVals.length) assetConditions.push(inArray(assets.genre, genreVals));
    for (const dataKey of ASSET_DATA_FILTER_KEYS) {
      const vals = asArray(aq[dataKey as keyof typeof aq] as string | string[] | undefined);
      if (vals.length) {
        assetConditions.push(inArray(sql<string>`(${assets.data}->>${dataKey})`, vals));
      }
    }

    const assetRows = await db
      .select()
      .from(assets)
      .where(and(...assetConditions));
    const assetIds = assetRows.map((a) => a.id);

    const assetImages =
      assetIds.length > 0
        ? await db
            .select({ id: media.id, assetId: media.assetId, objectKey: media.objectKey })
            .from(media)
            .where(and(inArray(media.assetId, assetIds), isNull(media.deletedAt)))
            .orderBy(media.id)
        : [];

    const coverByAsset = new Map<number, number>();
    for (const a of assetRows) {
      if (a.coverImageId != null) coverByAsset.set(a.id, a.coverImageId);
    }
    const exportMedia: AssetExportMedia[] = assetImages
      .filter((img): img is typeof img & { assetId: number } => img.assetId !== null)
      .map((img) => ({
        assetId: img.assetId,
        objectKey: img.objectKey,
        isCover: coverByAsset.get(img.assetId) === img.id,
      }));

    const exportItems: AssetExportItem[] = assetRows.map((a) => ({
      id: a.id,
      kind: a.kind as 'character' | 'scene' | 'prop',
      name: a.name,
      era: a.era,
      genre: a.genre,
      data: (a.data ?? {}) as Record<string, unknown>,
    }));

    reply.hijack();
    reply.raw.writeHead(200, {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${kind}.zip"`,
    });

    await buildAssetExportZip(
      kind as 'character' | 'scene' | 'prop',
      exportItems,
      exportMedia,
      reply,
      request,
    );
    return;
  }

  // Apply the same filter predicates the benchmark list uses, so an export
  // reflects the slice the reviewer is looking at rather than always the full bank.
  const q = request.query;
  const conditions: SQL[] = [
    q.deletedOnly === 'true'
      ? isNotNull(videoBenchmarkItems.deletedAt)
      : isNull(videoBenchmarkItems.deletedAt),
  ];
  if (q.search?.trim()) {
    const term = `%${q.search.trim()}%`;
    // Mirror benchmark.list: search spans every scalar text field.
    conditions.push(
      sql`(${videoBenchmarkItems.textPrompt} ILIKE ${term}
        OR ${videoBenchmarkItems.scene} ILIKE ${term}
        OR ${videoBenchmarkItems.shotType} ILIKE ${term}
        OR ${videoBenchmarkItems.taskType} ILIKE ${term}
        OR ${videoBenchmarkItems.questionType} ILIKE ${term}
        OR ${videoBenchmarkItems.manualTag} ILIKE ${term}
        OR ${videoBenchmarkItems.screenSize} ILIKE ${term}
        OR ${videoBenchmarkItems.judgingCriteria} ILIKE ${term})`,
    );
  }
  if (q.shotType) conditions.push(eq(videoBenchmarkItems.shotType, q.shotType));
  if (q.questionType) conditions.push(eq(videoBenchmarkItems.questionType, q.questionType));
  if (q.needsRevision === 'true') conditions.push(eq(videoBenchmarkItems.needsRevision, true));

  // Fetch benchmark items and their media links for the export.
  // Data is fetched BEFORE hijacking the reply so a query error still routes
  // through Fastify's error handler instead of corrupting a started stream.
  const items = await db
    .select()
    .from(videoBenchmarkItems)
    .where(and(...conditions));

  const itemIds = items.map((i) => i.id);

  // Pull every media role (image + audio + video) for the exported items so the
  // ZIP carries multi-image, audio, and video inputs/outputs — not just one image.
  const mediaLinks =
    itemIds.length > 0
      ? await db
          .select({
            objectKey: media.objectKey,
            role: videoBenchmarkMediaLinks.role,
            itemId: videoBenchmarkMediaLinks.itemId,
            mediaType: media.mediaType,
          })
          .from(videoBenchmarkMediaLinks)
          .innerJoin(media, eq(videoBenchmarkMediaLinks.mediaId, media.id))
          .where(and(inArray(videoBenchmarkMediaLinks.itemId, itemIds), isNull(media.deletedAt)))
          .orderBy(videoBenchmarkMediaLinks.sortOrder)
      : [];

  // Take over the response: stop Fastify from trying to send its own reply on
  // the socket we're about to pipe the archive into (prevents double-send /
  // corrupted ZIP), then write the headers ourselves.
  reply.hijack();
  reply.raw.writeHead(200, {
    'Content-Type': 'application/zip',
    'Content-Disposition': `attachment; filename="${kind}.zip"`,
  });

  await buildExportZip(
    kind,
    items as Record<string, unknown>[],
    mediaLinks as {
      objectKey: string;
      role: string;
      itemId: number;
      mediaType: 'image' | 'audio' | 'video';
    }[],
    reply,
    request,
  );
});

// ── Graceful shutdown ─────────────────────────────────────────────────────────

async function shutdown(signal: string) {
  server.log.info({ signal }, 'Shutting down');
  try {
    await server.close();
  } catch (err) {
    server.log.error(err, 'Error during shutdown');
    process.exit(1);
  }
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', (reason) => {
  server.log.error({ reason }, 'Unhandled promise rejection');
});
process.on('uncaughtException', (err) => {
  server.log.error(err, 'Uncaught exception');
  process.exit(1);
});

const port = Number(process.env.PORT ?? 3000);
try {
  await server.listen({ port, host: '0.0.0.0' });
} catch (err) {
  server.log.error(err, 'Failed to start server');
  process.exit(1);
}
