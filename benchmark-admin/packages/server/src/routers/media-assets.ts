import path from 'node:path';
import { type SQL, and, desc, eq, inArray, lt, sql } from 'drizzle-orm';
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
  title: string;
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
        search: z.string().optional(),
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
      const searchTerm = input.search?.trim();
      if (searchTerm) {
        const like = `%${searchTerm}%`;
        // Match the file's display title, its object key, or the source label.
        joinConditions.push(
          sql`(${media.title} ILIKE ${like} OR ${media.objectKey} ILIKE ${like} OR ${media.source} ILIKE ${like})`,
        );
      }
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
        const searchClause = searchTerm
          ? sql` AND (ai.title ILIKE ${`%${searchTerm}%`} OR ai.object_key ILIKE ${`%${searchTerm}%`} OR ai.source ILIKE ${`%${searchTerm}%`})`
          : sql``;
        const cursorClause = input.cursor ? sql` WHERE dedup.id < ${input.cursor}` : sql``;

        const query = sql`
          SELECT * FROM (
            SELECT DISTINCT ON (ai.object_key)
              ai.id,
              ai.asset_id    AS "assetId",
              ai.title,
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
          title: media.title,
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

  // Fetch media rows by id list — used by MediaPicker to render the
  // already-selected thumbnails + names even when the picker drawer is closed
  // (the list query is gated by `enabled: open`, so it wouldn't otherwise have
  // anything to display for those ids).
  byIds: protectedProcedure
    .input(z.object({ ids: z.array(z.number().int().positive()).max(200) }))
    .query(async ({ input }) => {
      if (input.ids.length === 0) return [];
      // Mirror the `list` query's join so `addUrls` gets the `assetKind` field
      // it expects on `MediaRow`.
      const rows = await db
        .select({
          id: media.id,
          assetId: media.assetId,
          title: media.title,
          objectKey: media.objectKey,
          source: media.source,
          mediaType: media.mediaType,
          createdAt: media.createdAt,
          assetKind: assets.kind,
        })
        .from(media)
        .leftJoin(assets, eq(assets.id, media.assetId))
        .where(inArray(media.id, input.ids));
      return addUrls(rows);
    }),

  getUploadUrl: protectedProcedure
    .input(
      z.object({
        mediaType: z.enum(['image', 'audio', 'video']),
        filename: z.string().min(1),
        contentType: z.string().min(1),
      }),
    )
    .mutation(async ({ input }) => {
      const prefixMap = { image: 'images', audio: 'audios', video: 'videos' } as const;
      const ext = path.extname(input.filename).toLowerCase() || '.bin';
      const objectKey = storage.newObjectKey(ext, prefixMap[input.mediaType]);
      const uploadUrl = await storage.getPresignedPutUrl(objectKey, input.contentType);
      return { uploadUrl, objectKey };
    }),

  create: protectedProcedure
    .input(
      z.object({
        objectKey: z.string().min(1),
        mediaType: z.enum(['image', 'audio', 'video']),
        assetKind: z.enum(['character', 'scene', 'prop']).default('character'),
        filename: z.string().default(''),
      }),
    )
    .mutation(async ({ input }) => {
      const [asset] = await db
        .insert(assets)
        .values({ kind: input.assetKind, name: input.filename || input.objectKey })
        .returning();
      if (!asset) throw new Error('Failed to create asset');

      const [img] = await db
        .insert(media)
        .values({
          assetId: asset.id,
          objectKey: input.objectKey,
          source: 'uploaded',
          mediaType: input.mediaType,
        })
        .returning();
      if (!img) throw new Error('Failed to create asset image');

      const url = await storage.getPresignedUrl(img.objectKey).catch(() => '');
      return { ...img, url, assetKind: asset.kind };
    }),
});
