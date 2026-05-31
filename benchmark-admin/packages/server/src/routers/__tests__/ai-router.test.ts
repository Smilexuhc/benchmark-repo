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
  });
});
