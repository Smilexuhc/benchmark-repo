import { PassThrough } from 'node:stream';
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

vi.mock('../../services/storage/index.js', () => ({
  getPresignedUrl: vi.fn(async (key: string) => `https://cdn.example.com/${key}`),
  getBytes: vi.fn(async () => Buffer.from('PNG\x89fake-image-data')),
  putObject: vi.fn(async () => undefined),
  newObjectKey: vi.fn(() => 'images/test.png'),
  deleteObject: vi.fn(async () => undefined),
  healthCheck: vi.fn(async () => true),
}));

describe('buildExportZip', () => {
  it('produces a zip buffer with XLSX and image entries', async () => {
    const { buildExportZip } = await import('../../services/exports/index.js');

    const items = [
      { id: 1, shotType: 'close', taskType: 'A', questionType: 'Q1', manualTag: '', scene: '古城', screenSize: '16:9', textPrompt: 'a prompt', judgingCriteria: 'good', score: 4, needsRevision: false, createdAt: new Date() },
      { id: 2, shotType: 'wide', taskType: 'B', questionType: 'Q2', manualTag: '', scene: '森林', screenSize: '4:3', textPrompt: 'another prompt', judgingCriteria: 'great', score: 5, needsRevision: false, createdAt: new Date() },
    ];
    const imageLinks = [
      { objectKey: 'images/img1.png', role: 'character_image', itemId: 1 },
      { objectKey: 'images/img2.png', role: 'character_image', itemId: 2 },
    ];

    // Use a PassThrough to capture zip bytes (simulates Fastify reply.raw)
    const sink = new PassThrough();
    const chunks: Buffer[] = [];
    sink.on('data', (chunk: Buffer) => chunks.push(chunk));

    const fakeReply = {
      raw: sink,
    };

    await buildExportZip('benchmark', items, imageLinks, fakeReply as never);

    const zipBuffer = Buffer.concat(chunks);

    // ZIP files start with PK signature (0x50 0x4B)
    expect(zipBuffer[0]).toBe(0x50);
    expect(zipBuffer[1]).toBe(0x4b);
    expect(zipBuffer.length).toBeGreaterThan(100);
  });

  it('skips unavailable images without throwing', async () => {
    const { getBytes } = await import('../../services/storage/index.js');
    (getBytes as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('Not found'));

    const { buildExportZip } = await import('../../services/exports/index.js');

    const items = [{ id: 3, shotType: '', taskType: '', questionType: '', manualTag: '', scene: '', screenSize: '', textPrompt: '', judgingCriteria: '', score: null, needsRevision: false, createdAt: new Date() }];
    const imageLinks = [{ objectKey: 'images/missing.png', role: 'character_image', itemId: 3 }];

    const sink = new PassThrough();
    const fakeReply = { raw: sink };
    sink.resume(); // drain

    await expect(
      buildExportZip('benchmark', items, imageLinks, fakeReply as never),
    ).resolves.toBeUndefined();
  });
});

describe('exportsRouter.getDownloadUrl', () => {
  // biome-ignore lint/suspicious/noExplicitAny: test helper
  let caller: any;

  beforeAll(async () => {
    vi.mock('../../db/index.js', async () => {
      const { getTestDb } = await import('../../db/__tests__/pglite.js');
      const db = await getTestDb();
      return { db };
    });
    const { appRouter } = await import('../../trpc/index.js');
    caller = appRouter.createCaller({
      req: { headers: { 'x-trpc-source': 'test' } } as never,
      res: {} as never,
      info: {} as never,
      session: { email: 'admin@example.com' },
    });
  });

  it('returns the download URL for benchmark kind', async () => {
    const result = await caller.exports.getDownloadUrl({ kind: 'benchmark' });
    expect(result.url).toBe('/api/export/benchmark.zip');
  });
});
