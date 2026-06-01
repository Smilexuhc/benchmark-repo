/**
 * Tests the (batchKey, id) idempotency backstop on ai.batchRegenerate (P0-2,
 * server half from JUJ-22).
 *
 * Scenario: the SSE connection drops *after* the server has inserted the
 * generated image row but *before* the client receives the `done` event. The
 * client resubscribes with the still-pending id under the SAME batchKey.
 * Without the backstop, the server would re-generate + re-insert, producing
 * a duplicate media row and a duplicate paid OpenRouter call.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.DATABASE_URL = 'postgresql://user:pass@host/db';
  process.env.OPENROUTER_API_KEY = 'test-key';
  process.env.OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
  process.env.TEXT_MODEL = 'openai/gpt-4o-mini';
  process.env.IMAGE_MODEL = 'openai/dall-e-3';
  process.env.TOS_BUCKET = 'test-bucket';
  process.env.TOS_REGION = 'us-east-1';
  process.env.TOS_ENDPOINT = 'https://tos.example.com';
  process.env.TOS_ACCESS_KEY_ID = 'test-key-id';
  process.env.TOS_SECRET_ACCESS_KEY = 'test-secret';
  process.env.SESSION_SECRET = '0'.repeat(64);
  process.env.ADMIN_EMAIL = 'admin@example.com';
  process.env.ADMIN_PASSWORD = 'password';
});

vi.mock('../../db/index.js', async () => {
  const { getTestDb } = await import('../../db/__tests__/pglite.js');
  const db = await getTestDb();
  return { db };
});

vi.mock('../../services/storage/index.js', () => ({
  getPresignedUrl: vi.fn(async (key: string) => `https://cdn.example.com/${key}`),
  getBytes: vi.fn(async () => Buffer.from('fake-bytes')),
  putObject: vi.fn(async () => undefined),
  newObjectKey: vi.fn(() => 'images/dedup.png'),
  deleteObject: vi.fn(async () => undefined),
  healthCheck: vi.fn(async () => true),
}));

const mockGenerateImage = vi.fn(async () => ({ objectKey: 'images/dedup.png' }));
const mockGeneratePrompt = vi.fn(async () => 'dedup prompt');

vi.mock('../../services/ai/index.js', () => ({
  generatePrompt: mockGeneratePrompt,
  generateImage: mockGenerateImage,
  AiError: class AiError extends Error {},
}));

const CTX = {
  req: { headers: { 'x-trpc-source': 'test' } } as never,
  res: {} as never,
  info: {} as never,
  session: { email: 'admin@example.com' },
};

// biome-ignore lint/suspicious/noExplicitAny: tRPC caller type
let caller: any;
// biome-ignore lint/suspicious/noExplicitAny: test db
let testDb: any;
let resetCompletions: () => void;

beforeAll(async () => {
  const { getTestDb } = await import('../../db/__tests__/pglite.js');
  testDb = await getTestDb();
  const { appRouter } = await import('../../trpc/index.js');
  caller = appRouter.createCaller(CTX);
  const aiModule = await import('../ai.js');
  resetCompletions = aiModule.__resetBatchCompletionsForTests;
});

beforeEach(() => {
  mockGenerateImage.mockReset().mockResolvedValue({ objectKey: 'images/dedup.png' });
  mockGeneratePrompt.mockReset().mockResolvedValue('dedup prompt');
  resetCompletions();
});

describe('ai.batchRegenerate (batchKey, id) dedup', () => {
  it('resubscribe with same batchKey does NOT re-generate or re-insert', async () => {
    const a = await caller.assets.create({ kind: 'character', name: 'Dedup A', data: {} });
    const b = await caller.assets.create({ kind: 'character', name: 'Dedup B', data: {} });

    const batchKey = 'fixed-test-batch-key';

    // First subscribe — drains both events normally so both ids complete.
    const firstSub = await caller.ai.batchRegenerate({ ids: [a.id, b.id], batchKey });
    for await (const _ of firstSub) {
      // consume
    }

    expect(mockGenerateImage.mock.calls.length).toBe(2);

    // Now simulate the dropped-connection retry: client resubscribes with the
    // same batchKey, asking for the same ids again (it didn't know they were
    // done because the `done` events were lost on the wire).
    const secondSub = await caller.ai.batchRegenerate({ ids: [a.id, b.id], batchKey });
    const replayed: { id: number; status: string; imageKey?: string }[] = [];
    for await (const ev of secondSub) {
      replayed.push(ev);
    }

    // Each id should emit pending + done (replayed from cache).
    expect(replayed.filter((e) => e.status === 'done').length).toBe(2);

    // CRITICAL: no second generateImage call.
    expect(mockGenerateImage.mock.calls.length).toBe(2);

    // CRITICAL: only one media row per asset.
    const { media } = await import('@benchmark-admin/shared/db/schema');
    const { eq } = await import('drizzle-orm');
    const rowsForA = await testDb.select().from(media).where(eq(media.assetId, a.id));
    const rowsForB = await testDb.select().from(media).where(eq(media.assetId, b.id));
    expect(rowsForA.length).toBe(1);
    expect(rowsForB.length).toBe(1);
  });

  it('a DIFFERENT batchKey (e.g. retryFailed) is NOT deduped — fresh regenerate', async () => {
    const a = await caller.assets.create({ kind: 'character', name: 'Fresh A', data: {} });

    const firstKey = 'first-key';
    const firstSub = await caller.ai.batchRegenerate({ ids: [a.id], batchKey: firstKey });
    for await (const _ of firstSub) {
      // consume
    }
    expect(mockGenerateImage.mock.calls.length).toBe(1);

    // A separate run (e.g. user clicks retry, or starts a new batch) uses a
    // fresh batchKey — must NOT be deduped against the prior batch.
    const secondKey = 'second-key';
    const secondSub = await caller.ai.batchRegenerate({ ids: [a.id], batchKey: secondKey });
    for await (const _ of secondSub) {
      // consume
    }
    expect(mockGenerateImage.mock.calls.length).toBe(2);

    const { media } = await import('@benchmark-admin/shared/db/schema');
    const { eq } = await import('drizzle-orm');
    const rows = await testDb.select().from(media).where(eq(media.assetId, a.id));
    // Assets legitimately accumulate multiple generated images across separate
    // runs — each run gets its own row.
    expect(rows.length).toBe(2);
  });

  it('a partially-completed batch only re-runs the still-pending ids', async () => {
    const a = await caller.assets.create({ kind: 'character', name: 'Partial A', data: {} });
    const b = await caller.assets.create({ kind: 'character', name: 'Partial B', data: {} });
    const c = await caller.assets.create({ kind: 'character', name: 'Partial C', data: {} });

    const batchKey = 'partial-batch';
    const firstSub = await caller.ai.batchRegenerate({ ids: [a.id, b.id, c.id], batchKey });
    for await (const _ of firstSub) {
      // consume — all three complete
    }
    expect(mockGenerateImage.mock.calls.length).toBe(3);

    // Client thinks only `c` is still pending (it received `done` for a, b
    // before the connection dropped, but lost the `done` for c — and the
    // client decided to resubscribe with c only).
    const secondSub = await caller.ai.batchRegenerate({ ids: [c.id], batchKey });
    for await (const _ of secondSub) {
      // consume
    }

    // `c` is replayed from cache; no fresh generation.
    expect(mockGenerateImage.mock.calls.length).toBe(3);
  });
});
