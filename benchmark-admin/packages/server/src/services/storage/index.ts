import { randomBytes } from 'node:crypto';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { env } from '@benchmark-admin/shared/env';

const s3 = new S3Client({
  endpoint: env.TOS_ENDPOINT,
  region: env.TOS_REGION,
  forcePathStyle: true,
  credentials: {
    accessKeyId: env.TOS_ACCESS_KEY_ID,
    secretAccessKey: env.TOS_SECRET_ACCESS_KEY,
  },
  maxAttempts: 3,
});

/**
 * Generates a new object key in the format {prefix}/{uuid4hex}{ext}.
 * Mirrors legacy backend/storage.py key generation.
 * Prefixes: images/, audios/, videos/
 */
export function newObjectKey(
  ext = '.png',
  prefix: 'images' | 'audios' | 'videos' = 'images',
): string {
  const uuid = randomBytes(16).toString('hex');
  return `${prefix}/${uuid}${ext.toLowerCase()}`;
}

export async function putObject(
  key: string,
  bytes: Uint8Array | Buffer,
  contentType: string,
): Promise<void> {
  await s3.send(
    new PutObjectCommand({
      Bucket: env.TOS_BUCKET,
      Key: key,
      Body: bytes,
      ContentType: contentType,
    }),
  );
}

export async function getPresignedUrl(key: string, expires = 3600): Promise<string> {
  const command = new GetObjectCommand({
    Bucket: env.TOS_BUCKET,
    Key: key,
  });
  return getSignedUrl(s3, command, { expiresIn: expires });
}

export async function getPresignedDownloadUrl(
  key: string,
  filename: string,
  expires = 3600,
): Promise<string> {
  const command = new GetObjectCommand({
    Bucket: env.TOS_BUCKET,
    Key: key,
    ResponseContentDisposition: `attachment; filename="${filename}"`,
  });
  return getSignedUrl(s3, command, { expiresIn: expires });
}

export async function deleteObject(key: string): Promise<void> {
  await s3.send(
    new DeleteObjectCommand({
      Bucket: env.TOS_BUCKET,
      Key: key,
    }),
  );
}

export async function getBytes(key: string): Promise<Buffer> {
  const result = await s3.send(
    new GetObjectCommand({
      Bucket: env.TOS_BUCKET,
      Key: key,
    }),
  );
  if (!result.Body) throw new Error(`No body for key: ${key}`);
  const bytes = await result.Body.transformToByteArray();
  return Buffer.from(bytes);
}

export async function healthCheck(): Promise<boolean> {
  try {
    await s3.send(new HeadBucketCommand({ Bucket: env.TOS_BUCKET }));
    return true;
  } catch {
    return false;
  }
}

export { s3 };
