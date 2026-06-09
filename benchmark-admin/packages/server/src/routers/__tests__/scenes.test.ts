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

const mockGetPresignedUrl = vi.fn(async (key: string) => `https://cdn.example.com/${key}`);
const mockGetBytes = vi.fn(async () => Buffer.from('fake-cover-bytes'));
const mockPutObject = vi.fn(async () => undefined);
const mockNewObjectKey = vi.fn(() => 'images/generated.png');

vi.mock('../../services/storage/index.js', () => ({
  getPresignedUrl: mockGetPresignedUrl,
  getBytes: mockGetBytes,
  putObject: mockPutObject,
  newObjectKey: mockNewObjectKey,
  deleteObject: vi.fn(async () => undefined),
}));

const mockGenerateImage = vi.fn(async () => ({ objectKey: 'images/generated.png' }));

vi.mock('../../services/ai/index.js', () => ({
  generateImage: mockGenerateImage,
  generatePrompt: vi.fn(async () => 'a test prompt'),
  extractFields: vi.fn(async () => ({})),
  AiError: class AiError extends Error {
    constructor(public code: string, message: string) {
      super(message);
    }
  },
}));

const MOCK_SESSION = { email: 'admin@example.com' };
const CTX = {
  req: { headers: { 'x-trpc-source': 'test' } } as never,
  res: {} as never,
  info: {} as never,
  session: MOCK_SESSION,
};

describe('scenesRouter', () => {
  // biome-ignore lint/suspicious/noExplicitAny: test helper
  let caller: any;

  beforeAll(async () => {
    const { appRouter } = await import('../../trpc/index.js');
    caller = appRouter.createCaller(CTX);
  });

  it('generateView(reverse) calls AI with cover bytes and persists with source:reverse', async () => {
    // Create a scene asset
    const scene = await caller.assets.create({ kind: 'scene', name: 'Test Scene', data: {} });

    // Attach a cover image
    const img = await caller.assets.attachImage({
      id: scene.id,
      objectKey: 'images/cover.png',
      source: 'uploaded',
    });
    await caller.assets.setCover({ id: scene.id, imageId: img.id });

    mockGenerateImage.mockClear();

    const result = await caller.scenes.generateView({ id: scene.id, mode: 'reverse' });

    expect(result.source).toBe('reverse');
    expect(result.assetId).toBe(scene.id);
    expect(result.url).toContain('generated.png');
    expect(mockGenerateImage).toHaveBeenCalledOnce();
    // AI should have been called with the cover bytes (wrapped in an array
    // after the multi-ref signature change — see services/ai/index.ts)
    const [, refBytes] = mockGenerateImage.mock.calls[0] as unknown as [string, Buffer[]];
    expect(refBytes).toBeDefined();
    expect(refBytes).toHaveLength(1);
  });

  it('generateView(multiview) persists with source:multiview', async () => {
    const scene = await caller.assets.create({ kind: 'scene', name: 'Multi Scene', data: {} });
    const img = await caller.assets.attachImage({
      id: scene.id,
      objectKey: 'images/cover2.png',
      source: 'uploaded',
    });
    await caller.assets.setCover({ id: scene.id, imageId: img.id });

    const result = await caller.scenes.generateView({ id: scene.id, mode: 'multiview' });
    expect(result.source).toBe('multiview');
  });

  it('throws BAD_REQUEST when scene has no cover image', async () => {
    const scene = await caller.assets.create({ kind: 'scene', name: 'NoCover Scene', data: {} });

    await expect(
      caller.scenes.generateView({ id: scene.id, mode: 'reverse' }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });
});
