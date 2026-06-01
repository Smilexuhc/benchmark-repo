import { type SQL, and, eq, isNull, sql } from 'drizzle-orm';
import { assets, media, videoBenchmarkMediaLinks } from '@benchmark-admin/shared/db/schema';
import type { Db } from './index.js';

// Switching media/asset/comment deletes from physical DELETE to soft delete
// (deleted_at) silently deactivated the FK-declared referential graph: every
// onDelete rule (assets.cover_image_id → set null, media.asset_id → cascade)
// only fires on a real DELETE, so none of them run anymore. This module re-homes
// that graph in the application as a single authoritative pair:
//   - mediaVisible(): the read-side visibility rule (composed parent-derivation)
//   - softDeleteMedia(): the write-side reconciliation a real DELETE used to do.

// A media row is visible iff its own deleted_at IS NULL AND either it is
// standalone (asset_id NULL) or its parent asset is itself visible. The parent
// clause replaces the dormant media.asset_id cascade: hiding an asset hides its
// media without touching each child row. Written as a correlated EXISTS so it
// drops into any query that has `media` in its FROM — no JOIN required, and it
// composes with an existing LEFT JOIN without double-filtering.
//
// The `asset_id IS NULL OR ...` order matters: a standalone file has no parent,
// and an EXISTS over a NULL asset_id yields false, which would wrongly hide it.
export function mediaVisible(): SQL {
  // and() with two defined args is always SQL here; assert to keep callers
  // (which spread into SQL[] / pass to where()) free of an undefined branch.
  return and(
    isNull(media.deletedAt),
    sql`(${media.assetId} IS NULL OR EXISTS (
      SELECT 1 FROM ${assets}
      WHERE ${assets.id} = ${media.assetId} AND ${assets.deletedAt} IS NULL
    ))`,
  ) as SQL;
}

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

// The reconciliation a physical DELETE of a media row used to perform, now that
// the delete is a soft delete. Caller passes the surrounding transaction so the
// flag, the cover-pointer null, and the link hard-delete commit atomically.
// Returns the soft-deleted media id, or null if it was already gone/deleted.
// Object-storage bytes are intentionally NOT touched — soft delete keeps the
// file recoverable.
export async function softDeleteMedia(tx: Tx, mediaId: number): Promise<number | null> {
  const [deleted] = await tx
    .update(media)
    .set({ deletedAt: new Date() })
    .where(and(eq(media.id, mediaId), isNull(media.deletedAt)))
    .returning({ id: media.id });
  if (!deleted) return null;

  // Stand in for the dormant assets.cover_image_id → SET NULL FK rule: any asset
  // pointing its cover at this file would otherwise keep a dangling pointer that
  // the visibility-filtered cover query can't resolve, blanking the card.
  await tx.update(assets).set({ coverImageId: null }).where(eq(assets.coverImageId, mediaId));

  // Links are derived wiring, not content, so they are hard-deleted (matching
  // the dormant media_links.media_id → CASCADE rule), not soft-deleted.
  await tx
    .delete(videoBenchmarkMediaLinks)
    .where(eq(videoBenchmarkMediaLinks.mediaId, mediaId));

  return deleted.id;
}
