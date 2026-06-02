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
  newObjectKey: vi.fn(() => 'images/test-key.png'),
  deleteObject: vi.fn(async () => undefined),
}));

const MOCK_SESSION = { email: 'admin@example.com' };
const CTX = {
  req: { headers: { 'x-trpc-source': 'test' } } as never,
  res: {} as never,
  info: {} as never,
  session: MOCK_SESSION,
};

describe('assetsRouter', () => {
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

  describe('create → list → get', () => {
    it('creates a character asset and retrieves it', async () => {
      const created = await caller.assets.create({
        kind: 'character',
        name: 'Test Hero',
        era: '古代',
        genre: '奇幻',
        data: { type: '人类', gender: '男', age: '青年' },
      });

      expect(created.id).toBeTypeOf('number');
      expect(created.kind).toBe('character');
      expect(created.name).toBe('Test Hero');
      expect(created.era).toBe('古代');
      expect(created.images).toEqual([]);

      const fetched = await caller.assets.get({ id: created.id });
      expect(fetched.id).toBe(created.id);
      expect(fetched.data).toMatchObject({ type: '人类', gender: '男' });
    });

    it('lists characters with typed variant data', async () => {
      await caller.assets.create({
        kind: 'character',
        name: 'List Test',
        data: { type: '动物' },
      });

      const { items } = await caller.assets.list({ kind: 'character' });
      expect(items.length).toBeGreaterThan(0);
      expect(items.every((i: { kind: string }) => i.kind === 'character')).toBe(true);
    });
  });

  describe('filters', () => {
    it('filters characters by era', async () => {
      // Insert 3 古代 and 2 现代 characters
      for (let i = 0; i < 3; i++) {
        await caller.assets.create({
          kind: 'character',
          name: `古代角色${i}`,
          era: '古代',
          data: {},
        });
      }
      for (let i = 0; i < 2; i++) {
        await caller.assets.create({
          kind: 'character',
          name: `现代角色${i}`,
          era: '现代',
          data: {},
        });
      }

      const { items } = await caller.assets.list({ kind: 'character', filters: { era: ['古代'] } });
      expect(items.every((i: { era: string }) => i.era === '古代')).toBe(true);
    });

    it('filters characters by JSONB type field', async () => {
      await caller.assets.create({ kind: 'character', name: '人类角色', data: { type: '人类' } });
      await caller.assets.create({ kind: 'character', name: '动物角色', data: { type: '动物' } });

      const { items } = await caller.assets.list({
        kind: 'character',
        filters: { type: ['人类'] },
      });
      expect(items.every((i: { data: { type?: string } }) => i.data.type === '人类')).toBe(true);
    });
  });

  describe('cursor pagination', () => {
    it('paginates across pages', async () => {
      // Create 25 scene assets to paginate
      for (let i = 0; i < 25; i++) {
        await caller.assets.create({ kind: 'scene', name: `场景${i}`, data: {} });
      }

      const page1 = await caller.assets.list({ kind: 'scene' });
      expect(page1.items.length).toBe(20);
      expect(page1.nextCursor).toBeTypeOf('number');

      const page2 = await caller.assets.list({ kind: 'scene', cursor: page1.nextCursor });
      expect(page2.items.length).toBeGreaterThanOrEqual(5);
      // IDs should not overlap between pages
      const page1Ids = new Set(page1.items.map((i: { id: number }) => i.id));
      for (const item of page2.items) {
        expect(page1Ids.has(item.id)).toBe(false);
      }
    });
  });

  describe('soft-delete and restore', () => {
    it('soft-deletes, excludes from list, restore brings it back', async () => {
      const created = await caller.assets.create({ kind: 'prop', name: 'DelProp', data: {} });

      await caller.assets.delete({ id: created.id });

      const { items: active } = await caller.assets.list({ kind: 'prop' });
      expect(active.every((i: { id: number }) => i.id !== created.id)).toBe(true);

      const { items: deleted } = await caller.assets.list({ kind: 'prop', deletedOnly: true });
      expect(deleted.some((i: { id: number }) => i.id === created.id)).toBe(true);

      await caller.assets.restore({ id: created.id });

      const { items: restored } = await caller.assets.list({ kind: 'prop' });
      expect(restored.some((i: { id: number }) => i.id === created.id)).toBe(true);
    });
  });

  describe('cover image', () => {
    it('attaches images and sets cover', async () => {
      const asset = await caller.assets.create({ kind: 'character', name: 'CoverTest', data: {} });

      const img1 = await caller.assets.attachImage({
        id: asset.id,
        objectKey: 'images/img1.png',
        source: 'uploaded',
      });
      const img2 = await caller.assets.attachImage({
        id: asset.id,
        objectKey: 'images/img2.png',
        source: 'uploaded',
      });

      expect(img1.url).toContain('img1.png');
      expect(img2.url).toContain('img2.png');

      const withCover = await caller.assets.setCover({ id: asset.id, imageId: img2.id });
      expect(withCover.coverImageId).toBe(img2.id);
      expect(withCover.images.length).toBe(2);
    });

    it('soft-deleting the cover nulls the pointer and list falls back to next alive image (Gap B)', async () => {
      const asset = await caller.assets.create({ kind: 'character', name: 'CoverDelTest', data: {} });
      const img1 = await caller.assets.attachImage({
        id: asset.id,
        objectKey: 'images/cover-del-1-abc123def456789012345678901234.png',
        source: 'uploaded',
      });
      const img2 = await caller.assets.attachImage({
        id: asset.id,
        objectKey: 'images/cover-del-2-abc123def456789012345678901234.png',
        source: 'uploaded',
      });
      await caller.assets.setCover({ id: asset.id, imageId: img2.id });

      // Soft-delete the explicit cover. The dangling pointer must be nulled so the
      // card derives a fallback instead of rendering blank.
      await caller.assets.deleteImage({ imageId: img2.id });

      const { items } = await caller.assets.list({ kind: 'character' });
      const listed = items.find((i: { id: number }) => i.id === asset.id);
      expect(listed).toBeDefined();
      expect(listed.coverImageId).toBeNull();
      expect(listed.images).toHaveLength(1);
      expect(listed.images[0].id).toBe(img1.id);
    });

    it('deleteImage soft-deletes the image and preserves the TOS object bytes', async () => {
      const asset = await caller.assets.create({ kind: 'prop', name: 'DelImgProp', data: {} });
      const img = await caller.assets.attachImage({
        id: asset.id,
        objectKey: 'images/del.png',
        source: 'uploaded',
      });

      const result = await caller.assets.deleteImage({ imageId: img.id });
      expect(result.imageId).toBe(img.id);

      const fetched = await caller.assets.get({ id: asset.id });
      expect(fetched.images.every((i: { id: number }) => i.id !== img.id)).toBe(true);

      // Soft delete must keep the file recoverable — bytes are never removed.
      const storage = await import('../../services/storage/index.js');
      expect(storage.deleteObject).not.toHaveBeenCalledWith('images/del.png');
    });
  });

  describe('options', () => {
    it('returns distinct character options sorted in legacy display order with novel values lexicographic', async () => {
      const { resetTestDb } = await import('../../db/__tests__/pglite.js');
      await resetTestDb();

      // Seed-shaped fixtures: era 古代/现代/未来; ethnicity types like the CSV;
      // gender includes 中性 (novel) which must fall after the ordered set.
      const fixtures = [
        { name: 'A', era: '现代', genre: '现代-职场', data: { type: '亚洲人', gender: '女', age: '青年' } },
        { name: 'B', era: '古代', genre: '中国古代', data: { type: '欧洲人', gender: '男', age: '中年' } },
        { name: 'C', era: '未来', genre: '科幻-星际', data: { type: '机器人', gender: '中性', age: '婴幼儿' } },
        { name: 'D', era: '现代', genre: '现代-校园', data: { type: '非洲人', gender: '其他', age: '老年' } },
        { name: 'E', era: '现代', genre: '现代-都市', data: { type: '混血', gender: '男', age: '少年' } },
      ];
      for (const f of fixtures) {
        await caller.assets.create({ kind: 'character', ...f });
      }

      const opts = await caller.assets.options({ kind: 'character', deletedOnly: false });
      if (opts.kind !== 'character') throw new Error(`expected character, got ${opts.kind}`);

      expect(opts.era).toEqual(['古代', '现代', '未来']);
      // genre — lexicographic; CSV-style values present
      expect(opts.genre).toContain('现代-职场');
      expect(opts.genre).toContain('现代-校园');
      expect(opts.genre).toContain('中国古代');
      expect([...opts.type].sort()).toEqual(['亚洲人', '非洲人', '机器人', '混血', '欧洲人'].sort());
      expect(opts.type).not.toContain('人类');
      // gender — ordered first, novel lexicographic last
      expect(opts.gender).toEqual(['男', '女', '其他', '中性']);
      // age — youngest-first ordered set
      expect(opts.age).toEqual(['婴幼儿', '少年', '青年', '中年', '老年']);
    });

    it('returns scene options including 氛围时段 (mood) distinct from 题材 (genre) with seed-shaped values', async () => {
      const { resetTestDb } = await import('../../db/__tests__/pglite.js');
      await resetTestDb();

      const fixtures = [
        { name: '金銮殿', era: '古代', genre: '中国古代', data: { scene_type: '室内', mood: '白天' } },
        { name: '废墟街道', era: '未来', genre: '末世废土', data: { scene_type: '室外', mood: '白天' } },
        { name: '霓虹街道', era: '未来', genre: '科幻-赛博朋克', data: { scene_type: '室外', mood: '夜晚' } },
        { name: '咖啡馆', era: '现代', genre: '现代-都市', data: { scene_type: '室内', mood: '黄昏' } },
      ];
      for (const f of fixtures) {
        await caller.assets.create({ kind: 'scene', ...f });
      }

      const opts = await caller.assets.options({ kind: 'scene', deletedOnly: false });
      if (opts.kind !== 'scene') throw new Error(`expected scene, got ${opts.kind}`);

      // genre = the legacy 题材 set; mood = 氛围时段; they are distinct fields.
      expect([...opts.genre].sort()).toEqual(['中国古代', '末世废土', '现代-都市', '科幻-赛博朋克'].sort());
      // mood is sorted lexicographically (zh-Hans-CN); contents matter more than order here.
      expect([...opts.mood].sort()).toEqual(['白天', '夜晚', '黄昏'].sort());
      // scene_type — both 室内 and 室外 present (admin was missing these).
      expect(opts.scene_type).toContain('室内');
      expect(opts.scene_type).toContain('室外');
      expect(opts.era).toEqual(['古代', '现代', '未来']);
    });

    it('returns prop options with only category populated', async () => {
      const { resetTestDb } = await import('../../db/__tests__/pglite.js');
      await resetTestDb();

      await caller.assets.create({ kind: 'prop', name: '宝剑', data: { category: '武器' } });
      await caller.assets.create({ kind: 'prop', name: '茶壶', data: { category: '日用品' } });
      await caller.assets.create({ kind: 'prop', name: '药瓶', data: { category: '医疗' } });

      const opts = await caller.assets.options({ kind: 'prop', deletedOnly: false });
      if (opts.kind !== 'prop') throw new Error(`expected prop, got ${opts.kind}`);

      expect([...opts.category].sort()).toEqual(['医疗', '日用品', '武器'].sort());
      // 'prop' variant only carries `category` — no era/genre keys on the wire.
      expect(Object.keys(opts).sort()).toEqual(['category', 'kind']);
    });

    it('deletedOnly:true reflects only soft-deleted rows', async () => {
      const { resetTestDb } = await import('../../db/__tests__/pglite.js');
      await resetTestDb();

      await caller.assets.create({
        kind: 'character',
        name: 'Alive',
        era: '现代',
        data: { type: '亚洲人' },
      });
      const dead = await caller.assets.create({
        kind: 'character',
        name: 'Dead',
        era: '古代',
        data: { type: '机器人' },
      });
      await caller.assets.delete({ id: dead.id });

      const liveOpts = await caller.assets.options({ kind: 'character', deletedOnly: false });
      if (liveOpts.kind !== 'character') throw new Error('expected character');
      expect(liveOpts.era).toEqual(['现代']);
      expect(liveOpts.type).toEqual(['亚洲人']);

      const trashOpts = await caller.assets.options({ kind: 'character', deletedOnly: true });
      if (trashOpts.kind !== 'character') throw new Error('expected character');
      expect(trashOpts.era).toEqual(['古代']);
      expect(trashOpts.type).toEqual(['机器人']);
    });

    it('empty kind returns empty arrays, not error', async () => {
      const { resetTestDb } = await import('../../db/__tests__/pglite.js');
      await resetTestDb();

      const opts = await caller.assets.options({ kind: 'scene', deletedOnly: false });
      if (opts.kind !== 'scene') throw new Error(`expected scene, got ${opts.kind}`);
      expect(opts.era).toEqual([]);
      expect(opts.genre).toEqual([]);
      expect(opts.scene_type).toEqual([]);
      expect(opts.mood).toEqual([]);
    });

    it('rejects anonymous calls (protectedProcedure)', async () => {
      const { appRouter } = await import('../../trpc/index.js');
      const anonCaller = appRouter.createCaller({
        req: { headers: { 'x-trpc-source': 'test' } } as never,
        res: {} as never,
        info: {} as never,
        session: null,
      });
      await expect(
        anonCaller.assets.options({ kind: 'character', deletedOnly: false }),
      ).rejects.toThrow(/UNAUTHORIZED/);
    });
  });

  describe('list payload trimming', () => {
    it('list returns only the cover image per asset while get returns all images', async () => {
      const asset = await caller.assets.create({
        kind: 'character',
        name: 'ManyImagesAsset',
        data: {},
      });

      const attached = [];
      for (let i = 0; i < 5; i++) {
        attached.push(
          await caller.assets.attachImage({
            id: asset.id,
            objectKey: `images/many-${i}-abc123def456789012345678901234.png`,
            source: 'generated',
          }),
        );
      }
      await caller.assets.setCover({ id: asset.id, imageId: attached[2].id });

      const { items } = await caller.assets.list({ kind: 'character' });
      const listed = items.find((i: { id: number }) => i.id === asset.id);
      expect(listed).toBeDefined();
      expect(listed.images).toHaveLength(1);
      expect(listed.images[0].id).toBe(attached[2].id);
      expect(listed.coverImageId).toBe(attached[2].id);

      const fetched = await caller.assets.get({ id: asset.id });
      expect(fetched.images).toHaveLength(5);
    });

    it('list falls back to the lowest-id image when no cover is set', async () => {
      const asset = await caller.assets.create({
        kind: 'prop',
        name: 'NoCoverAsset',
        data: {},
      });

      const first = await caller.assets.attachImage({
        id: asset.id,
        objectKey: 'images/no-cover-1-abc123def456789012345678901234.png',
        source: 'generated',
      });
      await caller.assets.attachImage({
        id: asset.id,
        objectKey: 'images/no-cover-2-abc123def456789012345678901234.png',
        source: 'generated',
      });

      const { items } = await caller.assets.list({ kind: 'prop' });
      const listed = items.find((i: { id: number }) => i.id === asset.id);
      expect(listed.coverImageId).toBeNull();
      expect(listed.images).toHaveLength(1);
      expect(listed.images[0].id).toBe(first.id);
    });
  });
});
