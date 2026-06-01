import { type SQL, and, desc, eq, lt, sql } from 'drizzle-orm';
import { z } from 'zod';
import { assets, media } from '@benchmark-admin/shared/db/schema';
import { db } from '../db/index.js';
import { mediaVisible } from '../db/soft-delete.js';
import * as storage from '../services/storage/index.js';
import { t } from '../trpc/init.js';
import { protectedProcedure } from '../trpc/procedures.js';

type MediaRow = {
  id: number;
  assetId: number | null;
  objectKey: string;
  source: string;
  mediaType: string;
  createdAt: Date;
  assetKind: string | null;
};

async function addUrls(rows: MediaRow[]) {
  // Presign independently — one TOS failure must not reject the whole page.
  // A failed presign degrades to an empty url rather than a 500.
  return Promise.all(
    rows.map(async (row) => ({
      ...row,
      url: await storage.getPresignedUrl(row.objectKey).catch(() => ''),
    })),
  );
}

const LIMIT = 50;

export const mediaAssetsRouter = t.router({
  list: protectedProcedure
    .input(
      z.object({
        kind: z.enum(['character', 'scene', 'prop']).optional(),
        mediaType: z.enum(['image', 'audio', 'video']).optional(),
        dedup: z.boolean().default(false),
        cursor: z.number().int().positive().optional(),
      }),
    )
    .query(async ({ input }) => {
      // mediaVisible() hides a file whose own deleted_at is set OR whose parent
      // asset was soft-deleted (the dormant asset_id cascade, re-homed in app
      // code). A kind filter constrains assets.kind, which (under the LEFT JOIN)
      // also excludes standalone media (asset_id NULL) — intended, since a
      // standalone file has no asset taxonomy to match.
      const joinConditions: SQL[] = [mediaVisible()];
      if (input.kind) joinConditions.push(eq(assets.kind, input.kind));
      if (input.mediaType) joinConditions.push(eq(media.mediaType, input.mediaType));
      if (input.cursor) joinConditions.push(lt(media.id, input.cursor));

      if (input.dedup) {
        // DISTINCT ON (object_key) collapses duplicate object keys — one row per unique file.
        // Drizzle doesn't expose DISTINCT ON, so we use a raw query with sql`` template
        // for safe parameterization.
        //
        // The dedup runs in an inner subquery (DISTINCT ON requires ORDER BY to lead
        // with object_key); the OUTER query then paginates by id so the cursor
        // (id < cursor, ORDER BY id DESC) is consistent with what we advance on —
        // otherwise pages keyed on id but ordered by object_key skip/duplicate rows.
        // LEFT JOIN keeps standalone media (asset_id NULL); a kind filter still
        // narrows to that asset taxonomy (and thus drops standalone rows).
        const kindClause = input.kind ? sql` AND a.kind = ${input.kind}` : sql``;
        const mtClause = input.mediaType ? sql` AND ai.media_type = ${input.mediaType}` : sql``;
        const cursorClause = input.cursor ? sql` WHERE dedup.id < ${input.cursor}` : sql``;

        const query = sql`
          SELECT * FROM (
            SELECT DISTINCT ON (ai.object_key)
              ai.id,
              ai.asset_id    AS "assetId",
              ai.object_key  AS "objectKey",
              ai.source,
              ai.media_type  AS "mediaType",
              ai.created_at  AS "createdAt",
              a.kind         AS "assetKind"
            FROM media ai
            LEFT JOIN assets a ON a.id = ai.asset_id
            WHERE ai.deleted_at IS NULL
              -- inlined mediaVisible(): hide media whose parent asset is soft-deleted
              -- (standalone media has asset_id NULL → the LEFT JOIN yields a.* NULL → kept)
              AND (ai.asset_id IS NULL OR a.deleted_at IS NULL)${kindClause}${mtClause}
            ORDER BY ai.object_key, ai.id
          ) dedup
          ${cursorClause}
          ORDER BY dedup.id DESC
          LIMIT ${LIMIT + 1}
        `;

        const raw = await db.execute(query);
        // drizzle-orm/pglite returns { rows, fields }; drizzle-orm/neon returns an array
        const allRows = (
          Array.isArray(raw) ? raw : (raw as { rows: unknown[] }).rows
        ) as MediaRow[];
        const hasMore = allRows.length > LIMIT;
        const pageRows = allRows.slice(0, LIMIT);
        const nextCursor =
          hasMore && pageRows.length > 0 ? pageRows[pageRows.length - 1]?.id : null;
        return { items: await addUrls(pageRows), nextCursor: nextCursor ?? null };
      }

      const rawRows = await db
        .select({
          id: media.id,
          assetId: media.assetId,
          objectKey: media.objectKey,
          source: media.source,
          mediaType: media.mediaType,
          createdAt: media.createdAt,
          assetKind: assets.kind,
        })
        .from(media)
        .leftJoin(assets, eq(media.assetId, assets.id))
        .where(and(...joinConditions))
        .orderBy(desc(media.id))
        .limit(LIMIT + 1);

      const hasMore = rawRows.length > LIMIT;
      const pageRows = rawRows.slice(0, LIMIT);
      const nextCursor = hasMore && pageRows.length > 0 ? pageRows[pageRows.length - 1]?.id : null;

      return { items: await addUrls(pageRows), nextCursor: nextCursor ?? null };
    }),
});
