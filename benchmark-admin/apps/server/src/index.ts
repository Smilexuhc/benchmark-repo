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
    db.execute(sql`SELECT 1`).then(() => true).catch(() => false),
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

// Allowlisted extensions and their server-authoritative content types
const EXT_TO_CONTENT_TYPE: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  m4a: 'audio/mp4',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
};

// Magic-byte signatures for quick type validation
const MAGIC_BYTES: { sig: number[]; type: 'image' | 'audio' | 'video' }[] = [
  { sig: [0x89, 0x50, 0x4e, 0x47], type: 'image' }, // PNG
  { sig: [0xff, 0xd8, 0xff], type: 'image' }, // JPEG
  { sig: [0x52, 0x49, 0x46, 0x46], type: 'image' }, // WebP (RIFF container)
  { sig: [0x49, 0x44, 0x33], type: 'audio' }, // MP3 (ID3)
  { sig: [0xff, 0xfb], type: 'audio' }, // MP3 frame
  { sig: [0xff, 0xf3], type: 'audio' }, // MP3 frame
  { sig: [0x52, 0x49, 0x46, 0x46], type: 'audio' }, // WAV (RIFF)
  { sig: [0x66, 0x74, 0x79, 0x70], type: 'video' }, // MP4/MOV (ftyp box at offset 4)
  { sig: [0x1a, 0x45, 0xdf, 0xa3], type: 'video' }, // WebM (EBML)
];

function detectMimeFromBytes(bytes: Buffer): string | null {
  for (const { sig, type } of MAGIC_BYTES) {
    // MP4/MOV ftyp box is at offset 4
    const offset = sig[0] === 0x66 ? 4 : 0;
    if (bytes.length >= offset + sig.length) {
      const match = sig.every((b, i) => bytes[offset + i] === b);
      if (match) {
        if (type === 'image') return 'image';
        if (type === 'audio') return 'audio';
        return 'video';
      }
    }
  }
  return null;
}

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

  // Validate extension is in allowlist
  const serverContentType = EXT_TO_CONTENT_TYPE[rawExt];
  if (!serverContentType) {
    return reply.status(400).send({ error: 'Unsupported file type' });
  }

  // Validate magic bytes to prevent extension spoofing
  const detectedType = detectMimeFromBytes(bytes);
  const expectedType = serverContentType.split('/')[0] as 'image' | 'audio' | 'video';
  if (detectedType !== null && detectedType !== expectedType) {
    return reply.status(400).send({ error: 'File content does not match extension' });
  }

  const prefix: 'images' | 'audios' | 'videos' =
    expectedType === 'image' ? 'images' : expectedType === 'audio' ? 'audios' : 'videos';

  const objectKey = storage.newObjectKey(`.${rawExt}`, prefix);
  // Use server-authoritative content type — never trust client-supplied mimetype
  await storage.putObject(objectKey, bytes, serverContentType);
  return reply.send({ objectKey });
});

// ── Export ZIP ────────────────────────────────────────────────────────────────

// Valid export kinds — validated to prevent Content-Disposition header injection
const VALID_EXPORT_KINDS = new Set(['benchmark']);

server.get<{ Params: { kind: string } }>(
  '/api/export/:kind.zip',
  { preHandler: requireSession },
  async (request, reply) => {
    const { kind } = request.params;

    if (!VALID_EXPORT_KINDS.has(kind)) {
      return reply.status(400).send({ error: 'Invalid export kind' });
    }

    // kind is now validated against the enum — safe to use in header
    reply.header('Content-Type', 'application/zip');
    reply.header('Content-Disposition', `attachment; filename="${kind}.zip"`);

    // Fetch benchmark items and their media links for the export
    const items = await db
      .select()
      .from(videoBenchmarkItems)
      .where(isNull(videoBenchmarkItems.deletedAt));

    const itemIds = items.map((i) => i.id);

    // Include any image-type media link (not just character_image) so items with
    // only scene/prop images still get an image in the export
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
            .where(eq(assetImages.mediaType, 'image'))
        : [];

    // biome-ignore lint/suspicious/noExplicitAny: schema rows are plain objects
    await buildExportZip(kind, items as any[], imageLinks, reply, request);
  },
);

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
