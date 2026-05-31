import { beforeAll, describe, expect, it, vi } from 'vitest';

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
  newObjectKey: vi.fn(() => 'images/batch.png'),
  deleteObject: vi.fn(async () => undefined),
  healthCheck: vi.fn(async () => true),
}));

const mockGenerateImage = vi.fn(async () => ({ objectKey: 'images/batch.png' }));
const mockGeneratePrompt = vi.fn(async () => 'batch prompt');

vi.mock('../../services/ai/index.js', () => ({
  generatePrompt: mockGeneratePrompt,
  generateImage: mockGenerateImage,
  AiError: class AiError extends Error {},
}));

const MOCK_SESSION = { email: 'admin@example.com' };
const CTX = {
  req: { headers: { 'x-trpc-source': 'test' } } as never,
  res: {} as never,
  info: {} as never,
  session: MOCK_SESSION,
};

// Helper to collect all events from a subscription async generator
async function collectBatch(
  // biome-ignore lint/suspicious/noExplicitAny: tRPC caller type
  caller: any,
  ids: number[],
  batchKey = `test-${Math.random().toString(36).slice(2)}`,
): Promise<{ id: number; status: string; imageKey?: string; error?: string }[]> {
  const events: { id: number; status: string; imageKey?: string; error?: string }[] = [];
  const sub = await caller.ai.batchRegenerate({ ids, batchKey });
  for await (const event of sub) {
    events.push(event);
  }
  return events;
}

describe('aiRouter.batchRegenerate', () => {
  // biome-ignore lint/suspicious/noExplicitAny: test helper
  let caller: any;
  // biome-ignore lint/suspicious/noExplicitAny: test db
  let testDb: any;

  beforeAll(async () => {
    const { getTestDb } = await import('../../db/__tests__/pglite.js');
    testDb = await getTestDb();
    const { appRouter } = await import('../../trpc/index.js');
    caller = appRouter.createCaller(CTX);
    mockGenerateImage.mockReset();
    mockGeneratePrompt.mockReset();
    mockGenerateImage.mockResolvedValue({ objectKey: 'images/batch.png' });
    mockGeneratePrompt.mockResolvedValue('batch prompt');
  });

  it('yields pending then done for each id', async () => {
    const asset1 = await caller.assets.create({ kind: 'character', name: 'Batch1', data: {} });
    const asset2 = await caller.assets.create({ kind: 'character', name: 'Batch2', data: {} });
    const asset3 = await caller.assets.create({ kind: 'character', name: 'Batch3', data: {} });

    const events = await collectBatch(caller, [asset1.id, asset2.id, asset3.id]);

    const pending = events.filter((e) => e.status === 'pending');
    const done = events.filter((e) => e.status === 'done');

    expect(pending.length).toBe(3);
    expect(done.length).toBe(3);
    for (const d of done) {
      expect(d.imageKey).toBe('images/batch.png');
    }
  });

  it('per-item failure does not abort the rest', async () => {
    mockGenerateImage
      .mockReset()
      .mockRejectedValueOnce(new Error('AI timeout'))
      .mockResolvedValue({ objectKey: 'images/batch.png' });
    mockGeneratePrompt.mockResolvedValue('batch prompt');

    const asset1 = await caller.assets.create({ kind: 'character', name: 'FailTest1', data: {} });
    const asset2 = await caller.assets.create({ kind: 'character', name: 'FailTest2', data: {} });
    const asset3 = await caller.assets.create({ kind: 'character', name: 'FailTest3', data: {} });

    const events = await collectBatch(caller, [asset1.id, asset2.id, asset3.id]);

    const failed = events.filter((e) => e.status === 'failed');
    const done = events.filter((e) => e.status === 'done');

    expect(failed.length).toBe(1);
    expect(done.length).toBe(2);
    expect(failed[0]?.error).toMatch(/AI timeout/);
  });

  it('DB write is observable before the done yield', async () => {
    mockGenerateImage.mockReset().mockResolvedValue({ objectKey: 'images/observable.png' });
    mockGeneratePrompt.mockReset().mockResolvedValue('test prompt');

    const asset = await caller.assets.create({ kind: 'character', name: 'ObservableTest', data: {} });

    const { assetImages } = await import('@benchmark-admin/shared/db/schema');
    const { eq } = await import('drizzle-orm');

    const sub = await caller.ai.batchRegenerate({ ids: [asset.id], batchKey: 'test-observable' });
    let dbRowFoundBeforeDone = false;

    for await (const event of sub) {
      if (event.status === 'done') {
        // Check DB — the row should already exist since write happens before yield
        const rows = await testDb
          .select()
          .from(assetImages)
          .where(eq(assetImages.assetId, asset.id));
        dbRowFoundBeforeDone = rows.some(
          (r: { objectKey: string }) => r.objectKey === 'images/observable.png',
        );
      }
    }

    expect(dbRowFoundBeforeDone).toBe(true);
  });

  it('non-existent id yields failed, does not throw', async () => {
    mockGenerateImage.mockReset().mockResolvedValue({ objectKey: 'images/batch.png' });
    mockGeneratePrompt.mockReset().mockResolvedValue('test prompt');

    const events = await collectBatch(caller, [999999]);
    const failed = events.filter((e) => e.status === 'failed');
    expect(failed.length).toBe(1);
    expect(failed[0]?.error).toMatch(/not found/i);
  });
});
