import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { env } from '@benchmark-admin/shared/env';

export const COOKIE_NAME = 'session';
const TOKEN_TTL_MS = 4 * 60 * 60 * 1000; // 4h

// ── Token ─────────────────────────────────────────────────────────────────────
// Format: base64url(JSON(payload)).base64url(HMAC-SHA256(base64url(JSON(payload)), SESSION_SECRET))
// payload = { jti, iat, exp }

type Payload = { jti: string; iat: number; exp: number };

export function signToken(): string {
  const payload: Payload = {
    jti: randomBytes(16).toString('hex'),
    iat: Date.now(),
    exp: Date.now() + TOKEN_TTL_MS,
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = createHmac('sha256', env.SESSION_SECRET).update(encodedPayload).digest('base64url');
  return `${encodedPayload}.${sig}`;
}

export function verifyToken(token: string): Payload | null {
  const dotIdx = token.lastIndexOf('.');
  if (dotIdx === -1) return null;
  const encodedPayload = token.slice(0, dotIdx);
  const sig = token.slice(dotIdx + 1);
  if (!encodedPayload || !sig) return null;

  const expectedSig = createHmac('sha256', env.SESSION_SECRET)
    .update(encodedPayload)
    .digest('base64url');

  // constant-time compare — pads differ => length mismatch => not equal
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expectedBuf.length || !timingSafeEqual(sigBuf, expectedBuf)) return null;

  try {
    const raw: unknown = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'));
    if (typeof raw !== 'object' || raw === null) return null;
    const p = raw as Record<string, unknown>;
    if (
      typeof p.jti !== 'string' ||
      typeof p.iat !== 'number' ||
      typeof p.exp !== 'number'
    )
      return null;
    const payload: Payload = { jti: p.jti, iat: p.iat, exp: p.exp };
    if (payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

// ── Revocation set ────────────────────────────────────────────────────────────
// Bounded in-memory set; entries are lazily expired at or after their exp timestamp.
const _revoked = new Map<string, number>(); // jti → exp

export function isRevoked(jti: string): boolean {
  const exp = _revoked.get(jti);
  if (exp === undefined) return false;
  if (exp < Date.now()) {
    _revoked.delete(jti);
    return false;
  }
  return true;
}

export function revokeToken(token: string): void {
  const payload = verifyToken(token);
  if (!payload) return;
  _revoked.set(payload.jti, payload.exp);
}

// Periodic cleanup to keep the set bounded (won't block process exit)
const _cleanup = setInterval(() => {
  const now = Date.now();
  for (const [jti, exp] of _revoked) {
    if (exp < now) _revoked.delete(jti);
  }
}, 60 * 60 * 1000);
_cleanup.unref?.();

// ── Credentials ───────────────────────────────────────────────────────────────

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  // Compare even when lengths differ (avoid short-circuit) to reduce timing leaks
  const maxLen = Math.max(bufA.length, bufB.length);
  const paddedA = Buffer.concat([bufA, Buffer.alloc(maxLen - bufA.length)]);
  const paddedB = Buffer.concat([bufB, Buffer.alloc(maxLen - bufB.length)]);
  const equal = timingSafeEqual(paddedA, paddedB);
  return bufA.length === bufB.length && equal;
}

export function verifyCredentials(email: string, password: string): boolean {
  // Both checks always run — no short-circuit that leaks which field is wrong
  const emailOk = safeEqual(email, env.ADMIN_EMAIL);
  const passOk = safeEqual(password, env.ADMIN_PASSWORD);
  return emailOk && passOk;
}

// ── Session read ──────────────────────────────────────────────────────────────

export function readSessionFromToken(token: string): { email: string } | null {
  const payload = verifyToken(token);
  if (!payload) return null;
  if (isRevoked(payload.jti)) return null;
  return { email: env.ADMIN_EMAIL };
}

// ── requireSession Fastify preHandler ─────────────────────────────────────────
// Reused by every session-gated raw route. Do NOT hand-roll cookie checks in routes.

export async function requireSession(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  // @fastify/cookie augments request.cookies at runtime
  const cookies = (request as FastifyRequest & { cookies?: Record<string, string | undefined> })
    .cookies;
  const token = cookies?.[COOKIE_NAME];
  if (!token || !readSessionFromToken(token)) {
    await reply.status(401).send({ error: 'Unauthorized' });
  }
}
