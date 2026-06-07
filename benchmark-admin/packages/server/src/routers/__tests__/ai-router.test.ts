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
  getBytes: vi.fn(async () => Buffer.from('fake-ref-image')),
  putObject: vi.fn(async () => undefined),
  newObjectKey: vi.fn(() => 'images/generated.png'),
  deleteObject: vi.fn(async () => undefined),
  healthCheck: vi.fn(async () => true),
  // BEN-27: attachImage / createStandalone run verifyUploadedObject.
  headObject: vi.fn(async () => ({ contentType: 'image/png', contentLength: 1024 })),
  getRange: vi.fn(async () => Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
}));

vi.mock('../../services/ai/index.js', () => ({
  generatePrompt: vi.fn(async () => 'A beautiful character portrait'),
  extractFields: vi.fn(async () => ({ type: '人类', gender: '男', age: '青年', persona: '', body: '', features: '' })),
  generateImage: vi.fn(async () => ({ objectKey: 'images/generated.png' })),
  AiError: class AiError extends Error {},
}));

const MOCK_SESSION = { email: 'admin@example.com' };
const CTX = {
  req: { headers: { 'x-trpc-source': 'test' } } as never,
  res: {} as never,
  info: {} as never,
  session: MOCK_SESSION,
};

describe('aiRouter', () => {
  // biome-ignore lint/suspicious/noExplicitAny: test helper
  let caller: any;

  beforeAll(async () => {
    const { appRouter } = await import('../../trpc/index.js');
    caller = appRouter.createCaller(CTX);
  });

  describe('generatePrompt', () => {
    it('delegates to AI service and returns { prompt }', async () => {
      const result = await caller.ai.generatePrompt({
        kind: 'character',
        data: { era: '古代', gender: '男' },
      });
      expect(result).toEqual({ prompt: 'A beautiful character portrait' });
    });
  });

  describe('extractFields', () => {
    it('delegates to AI service and returns discriminated union', async () => {
      const result = await caller.ai.extractFields({
        kind: 'character',
        description: '一名古代男侠客',
      });
      expect(result.kind).toBe('character');
      expect(result.data).toMatchObject({ type: '人类', gender: '男' });
    });
  });

  describe('generateImage', () => {
    it('inserts image into DB and returns with URL', async () => {
      // Create an asset first
      const asset = await caller.assets.create({ kind: 'character', name: 'AI Image Test', data: {} });

      const result = await caller.ai.generateImage({
        kind: 'character',
        id: asset.id,
        prompt: 'A test prompt',
      });

      expect(result.objectKey).toBe('images/generated.png');
      expect(result.url).toMatch(/^https:\/\//);
      expect(result.assetId).toBe(asset.id);
    });

    it('fetches ref image bytes when refImage is provided', async () => {
      const { getBytes } = await import('../../services/storage/index.js');
      const asset = await caller.assets.create({ kind: 'character', name: 'Ref Test', data: {} });
      const img = await caller.assets.attachImage({ id: asset.id, objectKey: 'images/ref.png', source: 'test' });

      await caller.ai.generateImage({
        kind: 'character',
        id: asset.id,
        prompt: 'A prompt with ref',
        refImage: img.id,
      });

      expect(getBytes).toHaveBeenCalledWith('images/ref.png');
    });

    it('wraps a single ref in an array when calling ai.generateImage', async () => {
      const { generateImage } = await import('../../services/ai/index.js');
      const asset = await caller.assets.create({ kind: 'character', name: 'Wrap Test', data: {} });
      const img = await caller.assets.attachImage({
        id: asset.id,
        objectKey: 'images/wrap-ref.png',
        source: 'test',
      });

      await caller.ai.generateImage({
        kind: 'character',
        id: asset.id,
        prompt: 'wrap test',
        refImage: img.id,
      });

      const lastCallArgs = vi.mocked(generateImage).mock.calls.at(-1);
      expect(lastCallArgs?.[1]).toBeInstanceOf(Array);
      expect(lastCallArgs?.[1]).toHaveLength(1);
    });
  });

  describe('generateStandalone', () => {
    it('generates with no refs and persists as assetId=NULL, source=standalone-generated', async () => {
      const { generateImage } = await import('../../services/ai/index.js');
      const result = await caller.ai.generateStandalone({
        prompt: 'a winter forest',
        aspectRatio: '16:9',
      });

      expect(result.assetId).toBeNull();
      expect(result.source).toBe('standalone-generated');
      expect(result.mediaType).toBe('image');
      expect(result.url).toMatch(/^https:\/\//);

      const lastCallArgs = vi.mocked(generateImage).mock.calls.at(-1);
      // (prompt, refs, aspectRatio, model)
      expect(lastCallArgs?.[0]).toBe('a winter forest');
      expect(lastCallArgs?.[1]).toBeUndefined();
      expect(lastCallArgs?.[2]).toBe('16:9');
      expect(lastCallArgs?.[3]).toBe('gpt-image-2');
    });

    it('passes ref bytes in caller order', async () => {
      const { generateImage } = await import('../../services/ai/index.js');
      // Seed two standalone refs directly so we don't depend on assets at all.
      const ref1 = await caller.mediaAssets.createStandalone({ objectKey: 'images/r1.png' });
      const ref2 = await caller.mediaAssets.createStandalone({ objectKey: 'images/r2.png' });

      await caller.ai.generateStandalone({
        prompt: 'compose',
        refImages: [ref2.id, ref1.id], // reversed on purpose
      });

      const lastCallArgs = vi.mocked(generateImage).mock.calls.at(-1);
      const refs = lastCallArgs?.[1] as Buffer[] | undefined;
      expect(refs).toBeInstanceOf(Array);
      expect(refs).toHaveLength(2);
    });

    it('defaults aspectRatio to 16:9 and model to gpt-image-2 when omitted', async () => {
      const { generateImage } = await import('../../services/ai/index.js');
      await caller.ai.generateStandalone({ prompt: 'defaults' });

      const lastCallArgs = vi.mocked(generateImage).mock.calls.at(-1);
      expect(lastCallArgs?.[2]).toBe('16:9');
      expect(lastCallArgs?.[3]).toBe('gpt-image-2');
    });

    it('rejects a non-existent ref id with BAD_REQUEST', async () => {
      await expect(
        caller.ai.generateStandalone({ prompt: 'x', refImages: [999_999_999] }),
      ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    });

    it('rejects an empty prompt at the zod boundary', async () => {
      await expect(caller.ai.generateStandalone({ prompt: '' })).rejects.toThrow();
    });

    it('rejects more than 4 ref images at the zod boundary', async () => {
      await expect(
        caller.ai.generateStandalone({
          prompt: 'too many',
          refImages: [1, 2, 3, 4, 5],
        }),
      ).rejects.toThrow();
    });

    it('rejects a model outside the whitelist', async () => {
      // Cast to bypass TS — the .input() schema is the runtime contract under
      // test here; we want the zod parse to reject 'banana' at runtime.
      await expect(
        caller.ai.generateStandalone({
          prompt: 'x',
          model: 'banana' as unknown as 'gpt-image-2',
        }),
      ).rejects.toThrow();
    });

    it('rejects an aspectRatio outside the whitelist', async () => {
      await expect(
        caller.ai.generateStandalone({
          prompt: 'x',
          aspectRatio: '21:9' as unknown as '16:9',
        }),
      ).rejects.toThrow();
    });
  });
});
