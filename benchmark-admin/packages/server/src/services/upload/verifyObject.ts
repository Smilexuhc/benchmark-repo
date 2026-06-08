// Post-upload object verification (BEN-27).
//
// A presigned PUT URL signs the ContentType the server *expected* (BEN-26), but
// the client can still PUT arbitrary bytes — TOS does not enforce that the body
// matches the signed ContentType. Before persisting a row in `assets`/`media`,
// this verifier:
//
//   1. HeadObject — confirms the stored ContentType's family (`image|audio|video`)
//      matches `mediaType`.
//   2. Ranged GetObject (first 16 bytes) + `detectMimeFromBytes` — confirms the
//      magic bytes don't actively contradict `mediaType`.
//
// Magic-byte detection is best-effort (some valid containers escape the table —
// see validate.ts comment "sniff is best-effort"); a null detection passes,
// only an explicit mismatch fails. HEAD ContentType is strict because TOS
// records it from the signed PUT URL we minted.

import { TRPCError } from '@trpc/server';
import * as storage from '../storage/index.js';
import { type MediaKind, detectMimeFromBytes } from './validate.js';

export async function verifyUploadedObject(objectKey: string, mediaType: MediaKind): Promise<void> {
  const head = await storage.headObject(objectKey);
  const headFamily = head.contentType?.split('/')[0];
  if (headFamily !== mediaType) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'Uploaded object content type mismatch',
    });
  }

  const bytes = await storage.getRange(objectKey, 0, 15);
  const detected = detectMimeFromBytes(bytes);
  if (detected !== null && detected !== mediaType) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'Uploaded object content does not match declared type',
    });
  }
}
