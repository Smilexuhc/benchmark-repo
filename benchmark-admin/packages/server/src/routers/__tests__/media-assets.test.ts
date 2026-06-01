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

  beforeEach(async () => {
    const { resetTestDb } = await import('../../db/__tests__/pglite.js');
    await resetTestDb();
  });

  it('lists all images without dedup', async () => {
    const asset = await caller.assets.create({ kind: 'character', name: 'Dedup Test', data: {} });
    await caller.assets.attachImage({
      id: asset.id,
      objectKey: 'images/shared-key.png',
      source: 'test',
    });
    await caller.assets.attachImage({
      id: asset.id,
      objectKey: 'images/shared-key.png',
      source: 'test',
    });

    const { items } = await caller.mediaAssets.list({ dedup: false });
    const shared = items.filter(
      (r: { objectKey: string }) => r.objectKey === 'images/shared-key.png',
    );
    expect(shared.length).toBe(2);
  });

  it('deduplicates by object_key when dedup=true', async () => {
    const asset = await caller.assets.create({ kind: 'character', name: 'Dedup Test 2', data: {} });
    await caller.assets.attachImage({
      id: asset.id,
      objectKey: 'images/dup-key.png',
      source: 'test',
    });
    await caller.assets.attachImage({
      id: asset.id,
      objectKey: 'images/dup-key.png',
      source: 'test',
    });

    const { items: dedupItems } = await caller.mediaAssets.list({ dedup: true });
    const { items: allItems } = await caller.mediaAssets.list({ dedup: false });

    expect(dedupItems.length).toBeLessThanOrEqual(allItems.length);

    // No duplicate object keys in dedup result
    const keys = dedupItems.map((r: { objectKey: string }) => r.objectKey);
    const uniqueKeys = new Set(keys);
    expect(keys.length).toBe(uniqueKeys.size);
  });

  it('filters by kind', async () => {
    const sceneAsset = await caller.assets.create({ kind: 'scene', name: 'Scene2', data: {} });
    await caller.assets.attachImage({
      id: sceneAsset.id,
      objectKey: 'images/scene-img.png',
      source: 'test',
    });

    const { items } = await caller.mediaAssets.list({ kind: 'scene', dedup: false });
    expect(items.every((r: { assetKind: string | null }) => r.assetKind === 'scene')).toBe(true);
  });

  it('surfaces standalone media (asset_id NULL) in the unfiltered list', async () => {
    const { getTestDb } = await import('../../db/__tests__/pglite.js');
    const testDb = await getTestDb();
    const { media } = await import('@benchmark-admin/shared/db/schema');
    await testDb.insert(media).values({
      assetId: null,
      objectKey: 'audios/standalone.mp3',
      source: 'uploaded',
      mediaType: 'audio',
    });

    const { items } = await caller.mediaAssets.list({ dedup: false });
    const standalone = items.find(
      (r: { objectKey: string }) => r.objectKey === 'audios/standalone.mp3',
    );
    expect(standalone).toBeDefined();
    expect(standalone.assetId).toBeNull();
    expect(standalone.assetKind).toBeNull();
  });

  it('hides media whose parent asset was soft-deleted (Gap B, both branches)', async () => {
    const asset = await caller.assets.create({ kind: 'character', name: 'HiddenParent', data: {} });
    await caller.assets.attachImage({
      id: asset.id,
      objectKey: 'images/hidden-parent-123456789012345678901234.png',
      source: 'uploaded',
    });

    // Visible before the parent is deleted.
    const before = await caller.mediaAssets.list({ dedup: false });
    expect(
      before.items.some(
        (r: { objectKey: string }) => r.objectKey === 'images/hidden-parent-123456789012345678901234.png',
      ),
    ).toBe(true);

    await caller.assets.delete({ id: asset.id });

    const plain = await caller.mediaAssets.list({ dedup: false });
    expect(
      plain.items.some(
        (r: { objectKey: string }) => r.objectKey === 'images/hidden-parent-123456789012345678901234.png',
      ),
    ).toBe(false);

    const dedup = await caller.mediaAssets.list({ dedup: true });
    expect(
      dedup.items.some(
        (r: { objectKey: string }) => r.objectKey === 'images/hidden-parent-123456789012345678901234.png',
      ),
    ).toBe(false);
  });

  it('keeps standalone media visible even though it has no parent asset (Gap B guard)', async () => {
    const { getTestDb } = await import('../../db/__tests__/pglite.js');
    const testDb = await getTestDb();
    const { media } = await import('@benchmark-admin/shared/db/schema');
    await testDb.insert(media).values({
      assetId: null,
      objectKey: 'videos/standalone-vis-123456789012345678901234.mp4',
      source: 'uploaded',
      mediaType: 'video',
    });

    // The parent clause is `asset_id IS NULL OR parent alive` — a NULL parent
    // must NOT be filtered out by the EXISTS subquery.
    const plain = await caller.mediaAssets.list({ dedup: false });
    expect(
      plain.items.some(
        (r: { objectKey: string }) => r.objectKey === 'videos/standalone-vis-123456789012345678901234.mp4',
      ),
    ).toBe(true);

    const dedup = await caller.mediaAssets.list({ dedup: true });
    expect(
      dedup.items.some(
        (r: { objectKey: string }) => r.objectKey === 'videos/standalone-vis-123456789012345678901234.mp4',
      ),
    ).toBe(true);
  });

  it('each row includes a presigned url', async () => {
    const asset = await caller.assets.create({ kind: 'character', name: 'URL Test', data: {} });
    await caller.assets.attachImage({
      id: asset.id,
      objectKey: 'images/url-test.png',
      source: 'test',
    });

    const { items } = await caller.mediaAssets.list({ dedup: false });
    for (const row of items) {
      expect(row.url).toMatch(/^https:\/\//);
    }
  });

  it('paginates with cursor', async () => {
    const asset = await caller.assets.create({ kind: 'prop', name: 'Pagination Asset', data: {} });
    // Create 55 images to exceed the LIMIT of 50
    for (let i = 0; i < 55; i++) {
      await caller.assets.attachImage({
        id: asset.id,
        objectKey: `images/paginated-${String(i).padStart(3, '0')}.png`,
        source: 'test',
      });
    }

    const page1 = await caller.mediaAssets.list({ dedup: false });
    expect(page1.items.length).toBe(50);
    expect(page1.nextCursor).toBeTypeOf('number');

    // biome-ignore lint/style/noNonNullAssertion: asserted toBeTypeOf('number') above
    const page2 = await caller.mediaAssets.list({ dedup: false, cursor: page1.nextCursor! });
    expect(page2.items.length).toBe(5);
    expect(page2.nextCursor).toBeNull();
  });
});
