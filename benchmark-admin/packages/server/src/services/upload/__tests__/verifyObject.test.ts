import { TRPCError } from '@trpc/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const MP3 = Buffer.from([0x49, 0x44, 0x33, 0x04, 0x00]);
const MP4 = Buffer.from([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70]);
const WEBM = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x01]);
const UNKNOWN = Buffer.from([0x00, 0x01, 0x02, 0x03, 0x04, 0x05]);

vi.mock('../../storage/index.js', () => ({
  headObject: vi.fn(),
  getRange: vi.fn(),
}));

const expectTRPC = async (
  promise: Promise<unknown>,
  code: string,
  messageMatch: RegExp,
): Promise<void> => {
  try {
    await promise;
  } catch (err) {
    expect(err).toBeInstanceOf(TRPCError);
    const trpc = err as TRPCError;
    expect(trpc.code).toBe(code);
    expect(trpc.message).toMatch(messageMatch);
    return;
  }
  throw new Error('expected promise to reject');
};

describe('verifyUploadedObject', () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  describe('image', () => {
    it('passes when HEAD ContentType is image/* and bytes are a known image magic', async () => {
      const storage = await import('../../storage/index.js');
      vi.mocked(storage.headObject).mockResolvedValue({
        contentType: 'image/png',
        contentLength: 1024,
      });
      vi.mocked(storage.getRange).mockResolvedValue(PNG);

      const { verifyUploadedObject } = await import('../verifyObject.js');
      await expect(verifyUploadedObject('images/x.png', 'image')).resolves.toBeUndefined();

      expect(storage.headObject).toHaveBeenCalledWith('images/x.png');
      expect(storage.getRange).toHaveBeenCalledWith('images/x.png', 0, 15);
    });

    it('rejects when HEAD ContentType family is not image/*', async () => {
      const storage = await import('../../storage/index.js');
      vi.mocked(storage.headObject).mockResolvedValue({
        contentType: 'audio/mpeg',
        contentLength: 1024,
      });
      vi.mocked(storage.getRange).mockResolvedValue(PNG);

      const { verifyUploadedObject } = await import('../verifyObject.js');
      await expectTRPC(
        verifyUploadedObject('images/x.png', 'image'),
        'BAD_REQUEST',
        /content type mismatch/i,
      );
      // Bytes are not even fetched once HEAD already disagrees.
      expect(storage.getRange).not.toHaveBeenCalled();
    });

    it('rejects when magic bytes are a different family (mp3 bytes under image type)', async () => {
      const storage = await import('../../storage/index.js');
      vi.mocked(storage.headObject).mockResolvedValue({
        contentType: 'image/png',
        contentLength: 1024,
      });
      vi.mocked(storage.getRange).mockResolvedValue(MP3);

      const { verifyUploadedObject } = await import('../verifyObject.js');
      await expectTRPC(
        verifyUploadedObject('images/spoof.png', 'image'),
        'BAD_REQUEST',
        /content does not match/i,
      );
    });

    it('accepts a jpeg payload as image', async () => {
      const storage = await import('../../storage/index.js');
      vi.mocked(storage.headObject).mockResolvedValue({
        contentType: 'image/jpeg',
        contentLength: 2048,
      });
      vi.mocked(storage.getRange).mockResolvedValue(JPEG);

      const { verifyUploadedObject } = await import('../verifyObject.js');
      await expect(verifyUploadedObject('images/x.jpg', 'image')).resolves.toBeUndefined();
    });
  });

  describe('audio', () => {
    it('passes when HEAD ContentType is audio/* and bytes are mp3 magic', async () => {
      const storage = await import('../../storage/index.js');
      vi.mocked(storage.headObject).mockResolvedValue({
        contentType: 'audio/mpeg',
        contentLength: 50_000,
      });
      vi.mocked(storage.getRange).mockResolvedValue(MP3);

      const { verifyUploadedObject } = await import('../verifyObject.js');
      await expect(verifyUploadedObject('audios/x.mp3', 'audio')).resolves.toBeUndefined();
    });

    it('rejects when HEAD ContentType family is image/* under audio type', async () => {
      const storage = await import('../../storage/index.js');
      vi.mocked(storage.headObject).mockResolvedValue({
        contentType: 'image/png',
        contentLength: 1024,
      });
      vi.mocked(storage.getRange).mockResolvedValue(MP3);

      const { verifyUploadedObject } = await import('../verifyObject.js');
      await expectTRPC(
        verifyUploadedObject('audios/x.mp3', 'audio'),
        'BAD_REQUEST',
        /content type mismatch/i,
      );
    });

    it('rejects when magic bytes are png under audio type', async () => {
      const storage = await import('../../storage/index.js');
      vi.mocked(storage.headObject).mockResolvedValue({
        contentType: 'audio/mpeg',
        contentLength: 50_000,
      });
      vi.mocked(storage.getRange).mockResolvedValue(PNG);

      const { verifyUploadedObject } = await import('../verifyObject.js');
      await expectTRPC(
        verifyUploadedObject('audios/x.mp3', 'audio'),
        'BAD_REQUEST',
        /content does not match/i,
      );
    });
  });

  describe('video', () => {
    it('passes when HEAD ContentType is video/* and bytes are mp4 ftyp magic', async () => {
      const storage = await import('../../storage/index.js');
      vi.mocked(storage.headObject).mockResolvedValue({
        contentType: 'video/mp4',
        contentLength: 500_000,
      });
      vi.mocked(storage.getRange).mockResolvedValue(MP4);

      const { verifyUploadedObject } = await import('../verifyObject.js');
      await expect(verifyUploadedObject('videos/x.mp4', 'video')).resolves.toBeUndefined();
    });

    it('passes for webm ebml magic under video type', async () => {
      const storage = await import('../../storage/index.js');
      vi.mocked(storage.headObject).mockResolvedValue({
        contentType: 'video/webm',
        contentLength: 500_000,
      });
      vi.mocked(storage.getRange).mockResolvedValue(WEBM);

      const { verifyUploadedObject } = await import('../verifyObject.js');
      await expect(verifyUploadedObject('videos/x.webm', 'video')).resolves.toBeUndefined();
    });

    it('rejects when HEAD ContentType is audio/* under video type', async () => {
      const storage = await import('../../storage/index.js');
      vi.mocked(storage.headObject).mockResolvedValue({
        contentType: 'audio/mpeg',
        contentLength: 50_000,
      });
      vi.mocked(storage.getRange).mockResolvedValue(MP4);

      const { verifyUploadedObject } = await import('../verifyObject.js');
      await expectTRPC(
        verifyUploadedObject('videos/x.mp4', 'video'),
        'BAD_REQUEST',
        /content type mismatch/i,
      );
    });

    it('rejects when magic bytes are jpeg under video type', async () => {
      const storage = await import('../../storage/index.js');
      vi.mocked(storage.headObject).mockResolvedValue({
        contentType: 'video/mp4',
        contentLength: 500_000,
      });
      vi.mocked(storage.getRange).mockResolvedValue(JPEG);

      const { verifyUploadedObject } = await import('../verifyObject.js');
      await expectTRPC(
        verifyUploadedObject('videos/x.mp4', 'video'),
        'BAD_REQUEST',
        /content does not match/i,
      );
    });
  });

  describe('edge cases', () => {
    it('rejects when HEAD returns no ContentType at all', async () => {
      const storage = await import('../../storage/index.js');
      vi.mocked(storage.headObject).mockResolvedValue({
        contentType: undefined,
        contentLength: 1024,
      });
      vi.mocked(storage.getRange).mockResolvedValue(PNG);

      const { verifyUploadedObject } = await import('../verifyObject.js');
      await expectTRPC(
        verifyUploadedObject('images/x.png', 'image'),
        'BAD_REQUEST',
        /content type mismatch/i,
      );
    });

    it('passes when magic bytes are unrecognized — sniff is best-effort (matches validate.ts)', async () => {
      const storage = await import('../../storage/index.js');
      vi.mocked(storage.headObject).mockResolvedValue({
        contentType: 'image/webp',
        contentLength: 4096,
      });
      vi.mocked(storage.getRange).mockResolvedValue(UNKNOWN);

      const { verifyUploadedObject } = await import('../verifyObject.js');
      await expect(verifyUploadedObject('images/x.webp', 'image')).resolves.toBeUndefined();
    });
  });
});
