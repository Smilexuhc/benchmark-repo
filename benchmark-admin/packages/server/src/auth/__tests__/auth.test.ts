import type { FastifyReply, FastifyRequest } from 'fastify';
import { beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

beforeAll(() => {
  process.env.DATABASE_URL = 'postgresql://user:pass@host/db';
  process.env.OPENROUTER_API_KEY = 'test-key';
  process.env.OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
  process.env.TEXT_MODEL = 'openai/gpt-4o-mini';
  process.env.IMAGE_MODEL = 'openai/dall-e-3';
  process.env.TOS_BUCKET = 'test-bucket';
  process.env.TOS_REGION = 'us-east-1';
  process.env.TOS_ENDPOINT = 'https://tos.example.com';
  process.env.TOS_ACCESS_KEY_ID = 'test-key-id';
  process.env.TOS_SECRET_ACCESS_KEY = 'test-secret-key';
  process.env.SESSION_SECRET = '0'.repeat(64);
  process.env.ADMIN_EMAIL = 'admin@example.com';
  process.env.ADMIN_PASSWORD = 'correct-password';
});

describe('SESSION_SECRET schema', () => {
  it('accepts a valid 64-hex-char secret', () => {
    const schema = z.string().regex(/^[0-9a-f]+$/i).min(64);
    expect(schema.parse('a'.repeat(64))).toBe('a'.repeat(64));
    expect(schema.parse('0'.repeat(64))).toBe('0'.repeat(64));
    expect(schema.parse('deadbeef'.repeat(8))).toBe('deadbeef'.repeat(8));
  });

  it('rejects empty string', () => {
    const schema = z.string().regex(/^[0-9a-f]+$/i).min(64);
    expect(() => schema.parse('')).toThrow();
  });

  it('rejects fewer than 64 chars', () => {
    const schema = z.string().regex(/^[0-9a-f]+$/i).min(64);
    expect(() => schema.parse('a'.repeat(63))).toThrow();
  });

  it('rejects non-hex characters', () => {
    const schema = z.string().regex(/^[0-9a-f]+$/i).min(64);
    expect(() => schema.parse('x'.repeat(64))).toThrow();
  });
});

describe('signToken / verifyToken', () => {
  it('sign then verify returns a valid payload', async () => {
    const { signToken, verifyToken } = await import('../index.js');
    const token = signToken();
    const payload = verifyToken(token);
    expect(payload).not.toBeNull();
    expect(typeof payload?.jti).toBe('string');
    expect(payload?.jti.length).toBe(32);
    expect(typeof payload?.iat).toBe('number');
    expect(typeof payload?.exp).toBe('number');
    expect((payload?.exp ?? 0) > (payload?.iat ?? 0)).toBe(true);
  });

  it('verify returns null for a tampered token', async () => {
    const { signToken, verifyToken } = await import('../index.js');
    const token = signToken();
    const [encoded, sig] = token.split('.');
    const tampered = `${encoded}.${sig?.slice(0, -2)}XX`;
    expect(verifyToken(tampered)).toBeNull();
  });

  it('verify returns null for a token with wrong payload', async () => {
    const { signToken, verifyToken } = await import('../index.js');
    const token = signToken();
    const [, sig] = token.split('.');
    // Replace payload with a different encoded string
    const fakePayload = Buffer.from('{"jti":"x","iat":0,"exp":0}').toString('base64url');
    expect(verifyToken(`${fakePayload}.${sig}`)).toBeNull();
  });

  it('verify returns null for an expired token', async () => {
    const { verifyToken } = await import('../index.js');
    const pastExp = Date.now() - 1000;
    const payload = { jti: 'test', iat: pastExp - 1000, exp: pastExp };
    const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const { createHmac } = await import('node:crypto');
    const sig = createHmac('sha256', process.env.SESSION_SECRET ?? '')
      .update(encoded)
      .digest('base64url');
    expect(verifyToken(`${encoded}.${sig}`)).toBeNull();
  });

  it('verify returns null for a missing token', async () => {
    const { verifyToken } = await import('../index.js');
    expect(verifyToken('')).toBeNull();
    expect(verifyToken('notadottoken')).toBeNull();
  });
});

describe('verifyCredentials', () => {
  it('returns true for correct credentials', async () => {
    const { verifyCredentials } = await import('../index.js');
    expect(verifyCredentials('admin@example.com', 'correct-password')).toBe(true);
  });

  it('returns false for wrong password', async () => {
    const { verifyCredentials } = await import('../index.js');
    expect(verifyCredentials('admin@example.com', 'wrong-password')).toBe(false);
  });

  it('returns false for wrong email', async () => {
    const { verifyCredentials } = await import('../index.js');
    expect(verifyCredentials('other@example.com', 'correct-password')).toBe(false);
  });

  it('returns false for empty credentials', async () => {
    const { verifyCredentials } = await import('../index.js');
    expect(verifyCredentials('', '')).toBe(false);
  });
});

describe('readSessionFromToken', () => {
  it('returns session for a valid token', async () => {
    const { signToken, readSessionFromToken } = await import('../index.js');
    const token = signToken();
    const session = readSessionFromToken(token);
    expect(session).not.toBeNull();
    expect(session?.email).toBe('admin@example.com');
  });

  it('returns null for an invalid token', async () => {
    const { readSessionFromToken } = await import('../index.js');
    expect(readSessionFromToken('invalid.token')).toBeNull();
  });

  it('returns null for an empty token', async () => {
    const { readSessionFromToken } = await import('../index.js');
    expect(readSessionFromToken('')).toBeNull();
  });
});

describe('revokeToken / revocation', () => {
  it('token is valid before revocation', async () => {
    const { signToken, readSessionFromToken } = await import('../index.js');
    const token = signToken();
    expect(readSessionFromToken(token)).not.toBeNull();
  });

  it('token is invalid after revocation (post-logout)', async () => {
    const { signToken, revokeToken, readSessionFromToken } = await import('../index.js');
    const token = signToken();
    expect(readSessionFromToken(token)).not.toBeNull();
    revokeToken(token);
    expect(readSessionFromToken(token)).toBeNull();
  });

  it('revoking an invalid token is a no-op', async () => {
    const { revokeToken } = await import('../index.js');
    expect(() => revokeToken('bad.token')).not.toThrow();
  });
});

describe('requireSession preHandler', () => {
  it('rejects request without session cookie (401)', async () => {
    const { requireSession } = await import('../index.js');
    const request = { cookies: {} } as FastifyRequest & {
      cookies: Record<string, string | undefined>;
    };
    let statusCode = 0;
    const reply = {
      status: (code: number) => {
        statusCode = code;
        return reply;
      },
      send: async (_body: unknown) => {},
    } as unknown as FastifyReply;

    await requireSession(request, reply);
    expect(statusCode).toBe(401);
  });

  it('rejects request with invalid session cookie (401)', async () => {
    const { requireSession, COOKIE_NAME } = await import('../index.js');
    const request = {
      cookies: { [COOKIE_NAME]: 'invalid.token' },
    } as unknown as FastifyRequest & { cookies: Record<string, string | undefined> };
    let statusCode = 0;
    const reply = {
      status: (code: number) => {
        statusCode = code;
        return reply;
      },
      send: async (_body: unknown) => {},
    } as unknown as FastifyReply;

    await requireSession(request, reply);
    expect(statusCode).toBe(401);
  });

  it('does not set status 401 for a valid session cookie', async () => {
    const { requireSession, signToken, COOKIE_NAME } = await import('../index.js');
    const token = signToken();
    const request = {
      cookies: { [COOKIE_NAME]: token },
    } as unknown as FastifyRequest & { cookies: Record<string, string | undefined> };
    let statusCode = 0;
    const reply = {
      status: (code: number) => {
        statusCode = code;
        return reply;
      },
      send: async (_body: unknown) => {},
    } as unknown as FastifyReply;

    await requireSession(request, reply);
    expect(statusCode).toBe(0); // preHandler did not call reply.status(401)
  });
});

describe('protectedProcedure', () => {
  it('allows a call when session is present', async () => {
    const { t } = await import('../../trpc/init.js');
    const { protectedProcedure } = await import('../../trpc/procedures.js');
    const router = t.router({ ping: protectedProcedure.query(() => 'pong') });
    const caller = router.createCaller({
      req: { headers: {} } as never,
      res: {} as never,
      info: {} as never,
      session: { email: 'admin@example.com' },
    });
    await expect(caller.ping()).resolves.toBe('pong');
  });

  it('throws UNAUTHORIZED when session is null', async () => {
    const { t } = await import('../../trpc/init.js');
    const { protectedProcedure } = await import('../../trpc/procedures.js');
    const router = t.router({ ping: protectedProcedure.query(() => 'pong') });
    const caller = router.createCaller({
      req: { headers: {} } as never,
      res: {} as never,
      info: {} as never,
      session: null,
    });
    await expect(caller.ping()).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('throws FORBIDDEN on mutation without x-trpc-source header', async () => {
    const { t } = await import('../../trpc/init.js');
    const { protectedProcedure } = await import('../../trpc/procedures.js');
    const router = t.router({ doThing: protectedProcedure.mutation(() => 'done') });
    const caller = router.createCaller({
      req: { headers: {} } as never,
      res: {} as never,
      info: {} as never,
      session: { email: 'admin@example.com' },
    });
    await expect(caller.doThing()).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('allows mutation with x-trpc-source header', async () => {
    const { t } = await import('../../trpc/init.js');
    const { protectedProcedure } = await import('../../trpc/procedures.js');
    const router = t.router({ doThing: protectedProcedure.mutation(() => 'done') });
    const caller = router.createCaller({
      req: { headers: { 'x-trpc-source': 'web' } } as never,
      res: {} as never,
      info: {} as never,
      session: { email: 'admin@example.com' },
    });
    await expect(caller.doThing()).resolves.toBe('done');
  });
});
