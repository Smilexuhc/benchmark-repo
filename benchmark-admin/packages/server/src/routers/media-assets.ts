import { type SQL, and, desc, eq, lt, sql } from 'drizzle-orm';
import { z } from 'zod';
import { assetImages, assets } from '@benchmark-admin/shared/db/schema';
import { db } from '../db/index.js';
import * as storage from '../services/storage/index.js';
import { t } from '../trpc/init.js';
import { protectedProcedure } from '../trpc/procedures.js';

type MediaRow = {
  id: number;
  assetId: number;
  objectKey: string;
  source: string;
  mediaType: string;
  createdAt: Date;
  assetKind: string;
};

async function addUrls(rows: MediaRow[]) {
  return Promise.all(
    rows.map(async (row) => ({
      ...row,
      url: await storage.getPresignedUrl(row.objectKey),
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
      const joinConditions: SQL[] = [];
      if (input.kind) joinConditions.push(eq(assets.kind, input.kind));
      if (input.mediaType) joinConditions.push(eq(assetImages.mediaType, input.mediaType));
      if (input.cursor) joinConditions.push(lt(assetImages.id, input.cursor));

      if (input.dedup) {
        // DISTINCT ON (object_key) collapses duplicate object keys — one row per unique file.
        // Drizzle doesn't expose DISTINCT ON, so we use a raw query with sql`` template
        // for safe parameterization.
        const kindClause = input.kind ? sql` AND a.kind = ${input.kind}` : sql``;
        const mtClause = input.mediaType ? sql` AND ai.media_type = ${input.mediaType}` : sql``;
        const cursorClause = input.cursor ? sql` AND ai.id < ${input.cursor}` : sql``;

        const query = sql`
          SELECT DISTINCT ON (ai.object_key)
            ai.id,
            ai.asset_id    AS "assetId",
            ai.object_key  AS "objectKey",
            ai.source,
            ai.media_type  AS "mediaType",
            ai.created_at  AS "createdAt",
            a.kind         AS "assetKind"
          FROM asset_images ai
          JOIN assets a ON a.id = ai.asset_id
          WHERE true${kindClause}${mtClause}${cursorClause}
          ORDER BY ai.object_key, ai.id
          LIMIT ${LIMIT + 1}
        `;

        const raw = await db.execute(query);
        // drizzle-orm/pglite returns { rows, fields }; drizzle-orm/neon returns an array
        const allRows = (Array.isArray(raw) ? raw : (raw as { rows: unknown[] }).rows) as MediaRow[];
        const hasMore = allRows.length > LIMIT;
        const pageRows = allRows.slice(0, LIMIT);
        const nextCursor = hasMore && pageRows.length > 0 ? pageRows[pageRows.length - 1]?.id : null;
        return { items: await addUrls(pageRows), nextCursor: nextCursor ?? null };
      }

      const rawRows = await db
        .select({
          id: assetImages.id,
          assetId: assetImages.assetId,
          objectKey: assetImages.objectKey,
          source: assetImages.source,
          mediaType: assetImages.mediaType,
          createdAt: assetImages.createdAt,
          assetKind: assets.kind,
        })
        .from(assetImages)
        .innerJoin(assets, eq(assetImages.assetId, assets.id))
        .where(joinConditions.length > 0 ? and(...joinConditions) : undefined)
        .orderBy(desc(assetImages.id))
        .limit(LIMIT + 1);

      const hasMore = rawRows.length > LIMIT;
      const pageRows = rawRows.slice(0, LIMIT);
      const nextCursor = hasMore && pageRows.length > 0 ? pageRows[pageRows.length - 1]?.id : null;

      return { items: await addUrls(pageRows), nextCursor: nextCursor ?? null };
    }),
});
