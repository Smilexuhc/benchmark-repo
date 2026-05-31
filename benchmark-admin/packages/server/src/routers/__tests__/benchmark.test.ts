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
}));

const MOCK_SESSION = { email: 'admin@example.com' };
const CTX = {
  req: { headers: { 'x-trpc-source': 'test' } } as never,
  res: {} as never,
  info: {} as never,
  session: MOCK_SESSION,
};

// Helper to create image assets for media linking
async function createImageAsset(
  // biome-ignore lint/suspicious/noExplicitAny: test helper
  caller: any,
  objectKey: string,
): Promise<number> {
  const asset = await caller.assets.create({ kind: 'character', name: 'MediaAsset', data: {} });
  const img = await caller.assets.attachImage({ id: asset.id, objectKey, source: 'uploaded' });
  return img.id;
}

const emptyMedia = {
  characterImageIds: [],
  sceneImageIds: [],
  propImageIds: [],
  audioInputId: null,
  videoInputId: null,
  videoOutputId: null,
};

describe('benchmarkRouter', () => {
  // biome-ignore lint/suspicious/noExplicitAny: test helper
  let caller: any;
  // biome-ignore lint/suspicious/noExplicitAny: test db
  let testDb: any;

  beforeAll(async () => {
    const { getTestDb } = await import('../../db/__tests__/pglite.js');
    testDb = await getTestDb();
    const { appRouter } = await import('../../trpc/index.js');
    caller = appRouter.createCaller(CTX);
  });

  beforeEach(async () => {
    const { resetTestDb } = await import('../../db/__tests__/pglite.js');
    await resetTestDb();
  });

  describe('create with media bundle → get', () => {
    it('creates item with mixed media and all links are present grouped by role', async () => {
      const charImgId1 = await createImageAsset(caller, 'images/char1abc123def456789012345678901.png');
      const charImgId2 = await createImageAsset(caller, 'images/char2abc123def456789012345678901.png');
      const charImgId3 = await createImageAsset(caller, 'images/char3abc123def456789012345678901.png');
      const sceneImgId = await createImageAsset(caller, 'images/sceneabc123def456789012345678901.png');
      const videoOutId = await createImageAsset(caller, 'videos/outaabc123def456789012345678901.mp4');

      const item = await caller.benchmark.create({
        shotType: 'close-up',
        taskType: 'generate',
        questionType: 'quality',
        media: {
          characterImageIds: [charImgId1, charImgId2, charImgId3],
          sceneImageIds: [sceneImgId],
          propImageIds: [],
          audioInputId: null,
          videoInputId: null,
          videoOutputId: videoOutId,
        },
      });

      expect(item.id).toBeTypeOf('number');
      expect(item.media.character_image.length).toBe(3);
      expect(item.media.scene_image.length).toBe(1);
      expect(item.media.video_output).not.toBeNull();
      expect(item.media.video_output?.mediaId).toBe(videoOutId);

      // Verify via get
      const fetched = await caller.benchmark.get({ id: item.id });
      expect(fetched.media.character_image.length).toBe(3);
    });
  });

  describe('list total respects search/filters', () => {
    it('total matches filtered item count, not overall count', async () => {
      // Create items with two distinct shotTypes
      for (let i = 0; i < 3; i++) {
        await caller.benchmark.create({ shotType: 'wide', media: emptyMedia });
      }
      for (let i = 0; i < 2; i++) {
        await caller.benchmark.create({ shotType: 'close', media: emptyMedia });
      }

      const wideResult = await caller.benchmark.list({ filters: { shotType: 'wide' } });
      expect(wideResult.total).toBe(3);
      expect(wideResult.items.length).toBe(3);

      const closeResult = await caller.benchmark.list({ filters: { shotType: 'close' } });
      expect(closeResult.total).toBe(2);

      // Unfiltered total should be 5
      const allResult = await caller.benchmark.list({});
      expect(allResult.total).toBe(5);
    });

    it('total reflects search predicate', async () => {
      await caller.benchmark.create({ textPrompt: 'unique-search-term-xyz', media: emptyMedia });
      await caller.benchmark.create({ textPrompt: 'other prompt', media: emptyMedia });

      const { total } = await caller.benchmark.list({ search: 'unique-search-term-xyz' });
      expect(total).toBe(1);
    });
  });

  describe('dedup in buildLinkRows', () => {
    it('duplicate characterImageIds are deduplicated before insert', async () => {
      const imgId = await createImageAsset(caller, 'images/dupabc123def456789012345678901234.png');

      const item = await caller.benchmark.create({
        media: {
          characterImageIds: [imgId, imgId, imgId], // 3× same id
          sceneImageIds: [],
          propImageIds: [],
          audioInputId: null,
          videoInputId: null,
          videoOutputId: null,
        },
      });

      // Should have only 1 character_image, not 3
      expect(item.media.character_image.length).toBe(1);
    });
  });

  describe('RF-2 single-cardinality constraint', () => {
    it('DB rejects a second audio_input for the same item (partial unique index)', async () => {
      const imgId1 = await createImageAsset(caller, 'audios/a1abc123def456789012345678901234.mp3');
      const imgId2 = await createImageAsset(caller, 'audios/a2abc123def456789012345678901234.mp3');

      const item = await caller.benchmark.create({
        media: { ...emptyMedia, audioInputId: imgId1 },
      });

      // Direct DB insert of a second audio_input should violate the partial unique index
      const { videoBenchmarkMediaLinks } = await import('@benchmark-admin/shared/db/schema');
      await expect(
        testDb.insert(videoBenchmarkMediaLinks).values({
          itemId: item.id,
          mediaId: imgId2,
          role: 'audio_input',
          sortOrder: 0,
        }),
      ).rejects.toThrow();
    });

    it('DB allows multiple character_images for the same item', async () => {
      const imgId1 = await createImageAsset(caller, 'images/c1abc123def456789012345678901234.png');
      const imgId2 = await createImageAsset(caller, 'images/c2abc123def456789012345678901234.png');

      const item = await caller.benchmark.create({
        media: { ...emptyMedia, characterImageIds: [imgId1, imgId2] },
      });

      expect(item.media.character_image.length).toBe(2);
    });
  });

  describe('stats', () => {
    it('returns group counts by shot_type × question_type and todayNew', async () => {
      for (let i = 0; i < 2; i++) {
        await caller.benchmark.create({ shotType: 'wide', questionType: 'qa', media: emptyMedia });
      }
      for (let i = 0; i < 2; i++) {
        await caller.benchmark.create({ shotType: 'close', questionType: 'score', media: emptyMedia });
      }

      const { groups, todayNew } = await caller.benchmark.stats();

      expect(groups.length).toBeGreaterThanOrEqual(2);
      expect(typeof todayNew).toBe('number');
      expect(todayNew).toBeGreaterThanOrEqual(4);
    });
  });

  describe('comments', () => {
    it('add and list comments; delete removes comment', async () => {
      const item = await caller.benchmark.create({ media: emptyMedia });

      const comment = await caller.benchmark.comments.add({
        itemId: item.id,
        body: 'Test comment body',
      });

      expect(comment.author).toBe('admin@example.com');
      expect(comment.body).toBe('Test comment body');

      const comments = await caller.benchmark.comments.list({ itemId: item.id });
      expect(comments.some((c: { id: number }) => c.id === comment.id)).toBe(true);

      await caller.benchmark.comments.delete({ commentId: comment.id });

      const after = await caller.benchmark.comments.list({ itemId: item.id });
      expect(after.every((c: { id: number }) => c.id !== comment.id)).toBe(true);
    });
  });

  describe('soft-delete and restore', () => {
    it('delete hides item from default list; restore brings it back', async () => {
      const item = await caller.benchmark.create({ media: emptyMedia });

      await caller.benchmark.delete({ id: item.id });

      const { items: active } = await caller.benchmark.list({});
      expect(active.every((i: { id: number }) => i.id !== item.id)).toBe(true);

      const { items: deleted } = await caller.benchmark.list({ deletedOnly: true });
      expect(deleted.some((i: { id: number }) => i.id === item.id)).toBe(true);

      await caller.benchmark.restore({ id: item.id });

      const { items: restored } = await caller.benchmark.list({});
      expect(restored.some((i: { id: number }) => i.id === item.id)).toBe(true);
    });
  });

  describe('pagination', () => {
    it('paginates correctly and total stays stable across pages', async () => {
      // Create 25 items
      for (let i = 0; i < 25; i++) {
        await caller.benchmark.create({ shotType: 'page-test', media: emptyMedia });
      }

      const page1 = await caller.benchmark.list({ filters: { shotType: 'page-test' } });
      expect(page1.items.length).toBe(20);
      expect(page1.total).toBe(25);
      expect(page1.nextCursor).toBeTypeOf('number');

      const page2 = await caller.benchmark.list({
        filters: { shotType: 'page-test' },
        // biome-ignore lint/style/noNonNullAssertion: asserted toBeTypeOf('number') above
        cursor: page1.nextCursor!,
      });
      expect(page2.items.length).toBe(5);
      // Total remains the same regardless of cursor
      expect(page2.total).toBe(25);

      // No ID overlap between pages
      const page1Ids = new Set(page1.items.map((i: { id: number }) => i.id));
      for (const item of page2.items) {
        expect(page1Ids.has(item.id)).toBe(false);
      }
    });

    it('empty page returns total=0', async () => {
      const { items, total, nextCursor } = await caller.benchmark.list({
        filters: { shotType: 'no-such-type-xyz' },
      });
      expect(items.length).toBe(0);
      expect(total).toBe(0);
      expect(nextCursor).toBeNull();
    });
  });

  describe('list payload trimming', () => {
    it('list omits media and comments; get still returns them', async () => {
      const charImgId = await createImageAsset(
        caller,
        'images/list-trim-abc123def456789012345678901234.png',
      );

      const item = await caller.benchmark.create({
        shotType: 'trim',
        questionType: 'check',
        media: { ...emptyMedia, characterImageIds: [charImgId] },
      });
      await caller.benchmark.comments.add({ itemId: item.id, body: 'a comment' });

      const { items } = await caller.benchmark.list({ filters: { shotType: 'trim' } });
      const listed = items.find((i: { id: number }) => i.id === item.id);
      expect(listed).toBeDefined();
      expect((listed as Record<string, unknown>).media).toBeUndefined();
      expect((listed as Record<string, unknown>).comments).toBeUndefined();

      const fetched = await caller.benchmark.get({ id: item.id });
      expect(fetched.media.character_image.length).toBe(1);
      expect(fetched.comments.length).toBe(1);
    });
  });
});
