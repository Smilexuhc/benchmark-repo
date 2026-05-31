import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { mockClient } from 'aws-sdk-client-mock';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

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

// mockClient types diverge between aws-sdk-client-mock@4 (uses @smithy/types Client)
// and @aws-sdk/client-s3@3.1057 (extends @smithy/core Client). Runtime is correct.
const s3Mock = mockClient(S3Client as never);

beforeEach(() => {
  s3Mock.reset();
});

describe('storage service', () => {
  describe('newObjectKey', () => {
    it('generates key with default images/ prefix and .png extension', async () => {
      const { newObjectKey } = await import('../index.js');
      const key = newObjectKey();
      expect(key).toMatch(/^images\/[0-9a-f]{32}\.png$/);
    });

    it('generates key with custom prefix and extension', async () => {
      const { newObjectKey } = await import('../index.js');
      const key = newObjectKey('.mp4', 'videos');
      expect(key).toMatch(/^videos\/[0-9a-f]{32}\.mp4$/);
    });

    it('lowercases the extension', async () => {
      const { newObjectKey } = await import('../index.js');
      const key = newObjectKey('.PNG');
      expect(key).toMatch(/^images\/[0-9a-f]{32}\.png$/);
    });

    it('generates unique keys', async () => {
      const { newObjectKey } = await import('../index.js');
      const keys = Array.from({ length: 5 }, () => newObjectKey());
      const unique = new Set(keys);
      expect(unique.size).toBe(5);
    });
  });

  describe('putObject', () => {
    it('sends PutObjectCommand with correct params', async () => {
      s3Mock.on(PutObjectCommand).resolves({});

      const { putObject } = await import('../index.js');
      await putObject('images/test.png', Buffer.from('data'), 'image/png');

      expect(s3Mock.calls()).toHaveLength(1);
      const call = s3Mock.call(0);
      expect(call.args[0].input).toMatchObject({
        Bucket: 'test-bucket',
        Key: 'images/test.png',
        ContentType: 'image/png',
      });
    });
  });

  describe('getPresignedUrl', () => {
    it('returns a presigned URL string for any key', async () => {
      // getSignedUrl generates the URL locally — no S3 call needed
      const { getPresignedUrl } = await import('../index.js');
      const url = await getPresignedUrl('images/test.png');
      expect(typeof url).toBe('string');
      expect(url.length).toBeGreaterThan(0);
    });

    it('returns a URL even for a missing key (signing is purely local)', async () => {
      const { getPresignedUrl } = await import('../index.js');
      const url = await getPresignedUrl('images/nonexistent.png');
      expect(typeof url).toBe('string');
    });
  });

  describe('deleteObject', () => {
    it('sends DeleteObjectCommand', async () => {
      s3Mock.on(DeleteObjectCommand).resolves({});

      const { deleteObject } = await import('../index.js');
      await deleteObject('images/test.png');

      expect(s3Mock.calls()).toHaveLength(1);
      expect(s3Mock.call(0).args[0].input).toMatchObject({
        Bucket: 'test-bucket',
        Key: 'images/test.png',
      });
    });
  });

  describe('healthCheck', () => {
    it('returns true when bucket is reachable', async () => {
      s3Mock.on(HeadBucketCommand).resolves({});

      const { healthCheck } = await import('../index.js');
      const ok = await healthCheck();
      expect(ok).toBe(true);
    });

    it('returns false when bucket throws', async () => {
      s3Mock.on(HeadBucketCommand).rejects(new Error('access denied'));

      const { healthCheck } = await import('../index.js');
      const ok = await healthCheck();
      expect(ok).toBe(false);
    });
  });

  describe('getBytes', () => {
    it('returns buffer for existing key', async () => {
      const content = 'hello bytes';
      const mockBody = {
        transformToByteArray: async () => Buffer.from(content),
      };
      s3Mock.on(GetObjectCommand).resolves({ Body: mockBody as never });

      const { getBytes } = await import('../index.js');
      const buf = await getBytes('images/test.png');
      expect(buf.toString()).toBe(content);
    });

    it('throws when Body is missing', async () => {
      // Resolve with no Body field (undefined via omission, compatible with exactOptionalPropertyTypes)
      s3Mock.on(GetObjectCommand).resolves({} as never);

      const { getBytes } = await import('../index.js');
      await expect(getBytes('images/missing.png')).rejects.toThrow('No body');
    });
  });
});
