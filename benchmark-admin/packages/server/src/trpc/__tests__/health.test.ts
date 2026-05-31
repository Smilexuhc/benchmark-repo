import { beforeAll, describe, expect, it, vi } from 'vitest';

// Set required env vars before any module imports
beforeAll(() => {
  process.env.DATABASE_URL = 'postgresql://user:pass@host/db';
  process.env.OPENROUTER_API_KEY = 'test-key';
  process.env.OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
  process.env.TEXT_MODEL = 'openai/gpt-4o-mini';
  process.env.IMAGE_MODEL = 'openai/dall-e-3';
  process.env.TOS_BUCKET = 'test-bucket';
  process.env.TOS_REGION = 'us-east-1';
  process.env.TOS_ENDPOINT = 'https://tos.example.com';
  process.env.TOS_ACCESS_KEY_ID = 'test-key-id';
  process.env.TOS_SECRET_ACCESS_KEY = 'test-secret-key';
  process.env.SESSION_SECRET = '0'.repeat(64);
  process.env.ADMIN_EMAIL = 'admin@example.com';
  process.env.ADMIN_PASSWORD = 'password';
});

vi.mock('../../../db/index.js', () => ({ db: {} }));

describe('health procedure', () => {
  it('returns ok:true and a Date', async () => {
    const { appRouter } = await import('../index.js');
    const caller = appRouter.createCaller({
      req: {} as never,
      res: {} as never,
      info: {} as never,
      session: null,
    });
    const result = await caller.health();
    expect(result.ok).toBe(true);
    expect(result.ts).toBeInstanceOf(Date);
  });
});
