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
  newObjectKey: vi.fn(() => 'images/test.png'),
  deleteObject: vi.fn(async () => undefined),
  healthCheck: vi.fn(async () => true),
}));

const MOCK_SESSION = { email: 'admin@example.com' };
const CTX = {
  req: { headers: { 'x-trpc-source': 'test' } } as never,
  res: {} as never,
  info: {} as never,
  session: MOCK_SESSION,
};

describe('mediaAssetsRouter', () => {
  // biome-ignore lint/suspicious/noExplicitAny: test helper
  let caller: any;

  beforeAll(async () => {
    const { appRouter } = await import('../../trpc/index.js');
    caller = appRouter.createCaller(CTX);
  });

  it('lists all images without dedup', async () => {
    // Create an asset with two images sharing the same object key
    const asset = await caller.assets.create({ kind: 'character', name: 'Dedup Test', data: {} });
    await caller.assets.attachImage({ id: asset.id, objectKey: 'images/shared-key.png', source: 'test' });
    await caller.assets.attachImage({ id: asset.id, objectKey: 'images/shared-key.png', source: 'test' });

    const result = await caller.mediaAssets.list({ dedup: false });
    const shared = result.filter((r: { objectKey: string }) => r.objectKey === 'images/shared-key.png');
    expect(shared.length).toBe(2);
  });

  it('deduplicates by object_key when dedup=true', async () => {
    const resultDedup = await caller.mediaAssets.list({ dedup: true });
    const resultAll = await caller.mediaAssets.list({ dedup: false });

    // Dedup should have fewer or equal rows than full listing when duplicates exist
    expect(resultDedup.length).toBeLessThanOrEqual(resultAll.length);

    // No duplicate object keys in dedup result
    const keys = resultDedup.map((r: { objectKey: string }) => r.objectKey);
    const uniqueKeys = new Set(keys);
    expect(keys.length).toBe(uniqueKeys.size);
  });

  it('filters by kind', async () => {
    await caller.assets.create({ kind: 'scene', name: 'Scene For Filter', data: {} });
    // attach image to scene
    const sceneAsset = await caller.assets.create({ kind: 'scene', name: 'Scene2', data: {} });
    await caller.assets.attachImage({ id: sceneAsset.id, objectKey: 'images/scene-img.png', source: 'test' });

    const result = await caller.mediaAssets.list({ kind: 'scene', dedup: false });
    expect(result.every((r: { assetKind: string }) => r.assetKind === 'scene')).toBe(true);
  });

  it('each row includes a presigned url', async () => {
    const result = await caller.mediaAssets.list({ dedup: false });
    for (const row of result) {
      expect(row.url).toMatch(/^https:\/\//);
    }
  });
});
