import { TRPCError } from '@trpc/server';
import { type SQL, and, desc, eq, inArray, isNotNull, isNull, lt, sql } from 'drizzle-orm';
import { z } from 'zod';
import { assets, media } from '@benchmark-admin/shared/db/schema';
import { AssetInsert, AssetUpdate } from '@benchmark-admin/shared/schemas/assets';
import { db } from '../db/index.js';
import { softDeleteMedia } from '../db/soft-delete.js';
import * as storage from '../services/storage/index.js';
import { t } from '../trpc/init.js';
import { protectedProcedure } from '../trpc/procedures.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

async function fetchAssetWithImages(id: number) {
  const [asset] = await db.select().from(assets).where(eq(assets.id, id)).limit(1);
  if (!asset) return null;

  const imageRows = await db
    .select()
    .from(media)
    .where(and(eq(media.assetId, id), isNull(media.deletedAt)));

  // Presign independently — one TOS failure degrades to an empty url, never a 500.
  const imagesWithUrls = await Promise.all(
    imageRows.map(async (img) => ({
      ...img,
      url: await storage.getPresignedUrl(img.objectKey).catch(() => ''),
    })),
  );

  return { ...asset, images: imagesWithUrls, coverImageId: asset.coverImageId ?? null };
}

// List payloads only render the cover image per asset (AssetCard picks
// `images.find(id===coverImageId) ?? images[0]`). Returning every media
// row + presigning every URL inflates payloads and signs N URLs per card when
// exactly one is needed. Detail fetches still go through `fetchAssetWithImages`
// and keep the full image set.
async function fetchPageWithCoverImage(ids: number[]) {
  if (ids.length === 0) return [];

  const assetRows = await db.select().from(assets).where(inArray(assets.id, ids));

  // Single-pass derived cover. Fetch every alive image for the page's assets in
  // one query (id ascending), then per asset choose: the explicit cover if it is
  // still alive, otherwise the lowest-id alive image (matches AssetCard's
  // `images[0]` fallback). Deriving from the live set — rather than bucketing on
  // coverImageId up front — is what fixes the soft-deleted-cover blank card: a
  // dangling cover pointer no longer suppresses the fallback, because we never
  // trust the pointer without confirming the row is alive.
  const imageRows =
    assetRows.length > 0
      ? await db
          .select()
          .from(media)
          .where(and(inArray(media.assetId, ids), isNull(media.deletedAt)))
          .orderBy(media.id)
      : [];

  const coverPointerByAssetId = new Map<number, number>();
  for (const a of assetRows) {
    if (a.coverImageId !== null && a.coverImageId !== undefined) {
      coverPointerByAssetId.set(a.id, a.coverImageId);
    }
  }

  // imageRows are asset-bound (queried by media.assetId) and ordered by id asc,
  // so assetId is non-null and the first row seen per asset is its lowest-id
  // alive image. An alive image matching the explicit cover pointer always wins;
  // otherwise the lowest-id alive image is the fallback. Iterating ascending,
  // a later (higher-id) row can never displace either choice.
  const coverByAssetId = new Map<number, typeof media.$inferSelect>();
  for (const img of imageRows) {
    if (img.assetId === null) continue;
    const pointer = coverPointerByAssetId.get(img.assetId);
    const existing = coverByAssetId.get(img.assetId);
    if (pointer !== undefined && img.id === pointer) {
      coverByAssetId.set(img.assetId, img); // explicit cover, still alive → wins
    } else if (!existing) {
      coverByAssetId.set(img.assetId, img); // first (lowest-id) alive fallback
    }
  }

  const selected = [...coverByAssetId.values()];
  const urls = await Promise.all(
    selected.map((img) => storage.getPresignedUrl(img.objectKey).catch(() => '')),
  );
  const imageWithUrlByAssetId = new Map<number, (typeof selected)[number] & { url: string }>();
  selected.forEach((img, i) => {
    const url = urls[i];
    if (url !== undefined && img.assetId !== null) {
      imageWithUrlByAssetId.set(img.assetId, { ...img, url });
    }
  });

  // Preserve the order of ids (for cursor pagination ordering)
  const assetMap = new Map(assetRows.map((a) => [a.id, a]));
  return ids
    .map((id) => {
      const asset = assetMap.get(id);
      if (!asset) return null;
      const cover = imageWithUrlByAssetId.get(id);
      return {
        ...asset,
        images: cover ? [cover] : [],
        coverImageId: asset.coverImageId ?? null,
      };
    })
    .filter((a): a is NonNullable<typeof a> => a !== null);
}

// ── Filter input ──────────────────────────────────────────────────────────────

const FiltersInput = z.object({
  era: z.array(z.string()).optional(),
  genre: z.array(z.string()).optional(),
  type: z.array(z.string()).optional(),
  gender: z.array(z.string()).optional(),
  age: z.array(z.string()).optional(),
  scene_type: z.array(z.string()).optional(),
  mood: z.array(z.string()).optional(),
  category: z.array(z.string()).optional(),
});

// ── Router ────────────────────────────────────────────────────────────────────

export const assetsRouter = t.router({
  list: protectedProcedure
    .input(
      z.object({
        kind: z.enum(['character', 'scene', 'prop']),
        cursor: z.number().int().positive().optional(),
        deletedOnly: z.boolean().default(false),
        search: z.string().optional(),
        filters: FiltersInput.optional(),
      }),
    )
    .query(async ({ input }) => {
      const LIMIT = 20;
      const conditions: SQL[] = [eq(assets.kind, input.kind)];

      if (input.deletedOnly) {
        conditions.push(isNotNull(assets.deletedAt));
      } else {
        conditions.push(isNull(assets.deletedAt));
      }

      if (input.cursor) {
        conditions.push(lt(assets.id, input.cursor));
      }

      if (input.search?.trim()) {
        const term = `%${input.search.trim()}%`;
        conditions.push(
          sql`(${assets.name} ILIKE ${term} OR cast(${assets.data} as text) ILIKE ${term})`,
        );
      }

      const { filters } = input;
      if (filters) {
        if (filters.era?.length) conditions.push(inArray(assets.era, filters.era));
        if (filters.genre?.length) conditions.push(inArray(assets.genre, filters.genre));
        if (filters.type?.length)
          conditions.push(inArray(sql<string>`(${assets.data}->>'type')`, filters.type));
        if (filters.gender?.length)
          conditions.push(inArray(sql<string>`(${assets.data}->>'gender')`, filters.gender));
        if (filters.age?.length)
          conditions.push(inArray(sql<string>`(${assets.data}->>'age')`, filters.age));
        if (filters.scene_type?.length)
          conditions.push(
            inArray(sql<string>`(${assets.data}->>'scene_type')`, filters.scene_type),
          );
        if (filters.mood?.length)
          conditions.push(inArray(sql<string>`(${assets.data}->>'mood')`, filters.mood));
        if (filters.category?.length)
          conditions.push(inArray(sql<string>`(${assets.data}->>'category')`, filters.category));
      }

      const rows = await db
        .select({ id: assets.id })
        .from(assets)
        .where(and(...conditions))
        .orderBy(desc(assets.id))
        .limit(LIMIT + 1);

      const hasMore = rows.length > LIMIT;
      const pageIds = rows.slice(0, LIMIT).map((r) => r.id);
      const nextCursor =
        hasMore && pageIds.length > 0 ? (pageIds[pageIds.length - 1] ?? null) : null;

      const items = await fetchPageWithCoverImage(pageIds);
      return { items, nextCursor };
    }),

  get: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ input }) => {
      const result = await fetchAssetWithImages(input.id);
      if (!result) throw new TRPCError({ code: 'NOT_FOUND' });
      return result;
    }),

  create: protectedProcedure.input(AssetInsert).mutation(async ({ input }) => {
    const [created] = await db
      .insert(assets)
      .values({
        kind: input.kind,
        name: input.name ?? '',
        era: input.era ?? null,
        genre: input.genre ?? null,
        data: input.data ?? {},
      })
      .returning();
    if (!created) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });
    return { ...created, images: [], coverImageId: created.coverImageId ?? null };
  }),

  update: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }).and(AssetUpdate))
    .mutation(async ({ input }) => {
      const { id, kind: _kind, ...fields } = input;

      const updateSet: Record<string, unknown> = { updatedAt: new Date() };
      if (fields.name !== undefined) updateSet.name = fields.name;
      if ('era' in fields) updateSet.era = fields.era;
      if ('genre' in fields) updateSet.genre = fields.genre;
      if (fields.data !== undefined) updateSet.data = fields.data;

      const [updated] = await db.update(assets).set(updateSet).where(eq(assets.id, id)).returning();

      if (!updated) throw new TRPCError({ code: 'NOT_FOUND' });

      const result = await fetchAssetWithImages(id);
      if (!result) throw new TRPCError({ code: 'NOT_FOUND' });
      return result;
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      const [deleted] = await db
        .update(assets)
        .set({ deletedAt: new Date() })
        .where(and(eq(assets.id, input.id), isNull(assets.deletedAt)))
        .returning({ id: assets.id });
      if (!deleted) throw new TRPCError({ code: 'NOT_FOUND' });
      return { id: deleted.id };
    }),

  restore: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      const [restored] = await db
        .update(assets)
        .set({ deletedAt: null })
        .where(and(eq(assets.id, input.id), isNotNull(assets.deletedAt)))
        .returning({ id: assets.id });
      if (!restored) throw new TRPCError({ code: 'NOT_FOUND' });

      const result = await fetchAssetWithImages(input.id);
      if (!result) throw new TRPCError({ code: 'NOT_FOUND' });
      return result;
    }),

  attachImage: protectedProcedure
    .input(
      z.object({
        id: z.number().int().positive(),
        objectKey: z
          .string()
          .regex(
            /^(images|audios|videos)\/[a-zA-Z0-9][a-zA-Z0-9._-]*\.[a-zA-Z0-9]+$/,
            'objectKey must match system prefix pattern',
          ),
        source: z.string().default('uploaded'),
      }),
    )
    .mutation(async ({ input }) => {
      const [asset] = await db
        .select({ id: assets.id })
        .from(assets)
        .where(eq(assets.id, input.id))
        .limit(1);
      if (!asset) throw new TRPCError({ code: 'NOT_FOUND' });

      const [img] = await db
        .insert(media)
        .values({
          assetId: input.id,
          objectKey: input.objectKey,
          source: input.source,
          mediaType: 'image',
        })
        .returning();
      if (!img) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });

      const url = await storage.getPresignedUrl(img.objectKey);
      return { ...img, url };
    }),

  deleteImage: protectedProcedure
    .input(z.object({ imageId: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      // Soft delete (deletedAt set, TOS bytes preserved for recovery) plus the
      // referential reconciliation a physical DELETE used to do via FK rules:
      // null any asset cover pointing here, hard-delete derived links. All in one
      // transaction so a half-applied delete can't leave a dangling cover/link.
      const imageId = await db.transaction((tx) => softDeleteMedia(tx, input.imageId));
      if (imageId === null) throw new TRPCError({ code: 'NOT_FOUND' });
      return { imageId };
    }),

  setCover: protectedProcedure
    .input(
      z.object({
        id: z.number().int().positive(),
        imageId: z.number().int().positive(),
      }),
    )
    .mutation(async ({ input }) => {
      // Verify image belongs to this asset
      const [img] = await db
        .select({ id: media.id })
        .from(media)
        .where(
          and(eq(media.id, input.imageId), eq(media.assetId, input.id), isNull(media.deletedAt)),
        )
        .limit(1);
      if (!img) throw new TRPCError({ code: 'NOT_FOUND', message: 'Image not found on asset' });

      await db.update(assets).set({ coverImageId: input.imageId }).where(eq(assets.id, input.id));

      const result = await fetchAssetWithImages(input.id);
      if (!result) throw new TRPCError({ code: 'NOT_FOUND' });
      return result;
    }),
});
