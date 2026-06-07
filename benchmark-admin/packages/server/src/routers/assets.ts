import { TRPCError } from '@trpc/server';
import { type SQL, and, eq, gt, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { assets, media } from '@benchmark-admin/shared/db/schema';
import {
  AssetInsert,
  AssetOptionsInput,
  AssetUpdate,
} from '@benchmark-admin/shared/schemas/assets';
import { db } from '../db/index.js';
import { softDeleteMedia } from '../db/soft-delete.js';
import * as storage from '../services/storage/index.js';
import { verifyUploadedObject } from '../services/upload/verifyObject.js';
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

// List payloads return every alive image per asset. The card needs them for
// the "共 N 张" count + lightbox prev/next; presigning N URLs per page (≈ 3×
// page size in practice) is acceptable for the workload. Detail fetches still
// go through `fetchAssetWithImages` for the per-asset detail view.
async function fetchPageWithCoverImage(ids: number[]) {
  if (ids.length === 0) return [];

  const assetRows = await db.select().from(assets).where(inArray(assets.id, ids));

  const imageRows =
    assetRows.length > 0
      ? await db
          .select()
          .from(media)
          .where(and(inArray(media.assetId, ids), isNull(media.deletedAt)))
          .orderBy(media.id)
      : [];

  // Presign every alive image once, in parallel.
  const urls = await Promise.all(
    imageRows.map((img) => storage.getPresignedUrl(img.objectKey).catch(() => '')),
  );
  const imagesByAssetId = new Map<number, Array<(typeof imageRows)[number] & { url: string }>>();
  imageRows.forEach((img, i) => {
    if (img.assetId === null) return;
    const url = urls[i] ?? '';
    const arr = imagesByAssetId.get(img.assetId) ?? [];
    arr.push({ ...img, url });
    imagesByAssetId.set(img.assetId, arr);
  });

  // Preserve the order of ids (for cursor pagination ordering)
  const assetMap = new Map(assetRows.map((a) => [a.id, a]));
  return ids
    .map((id) => {
      const asset = assetMap.get(id);
      if (!asset) return null;
      return {
        ...asset,
        images: imagesByAssetId.get(id) ?? [],
        coverImageId: asset.coverImageId ?? null,
      };
    })
    .filter((a): a is NonNullable<typeof a> => a !== null);
}

// ── Filter option ordering ────────────────────────────────────────────────────
// Legacy display order; novel values (anything not in the list) sort
// lexicographically after the ordered ones.
const ERA_ORDER = ['古代', '近代', '现代', '未来', '奇幻', '科幻'] as const;
const GENDER_ORDER = ['男', '女', '其他'] as const;
const AGE_ORDER = ['婴幼儿', '儿童', '少年', '青年', '中年', '老年'] as const;

function sortWithFallback(values: string[], order?: readonly string[]): string[] {
  const rank = order ? new Map(order.map((v, i) => [v, i])) : null;
  return [...values].sort((a, b) => {
    if (rank) {
      const ra = rank.get(a);
      const rb = rank.get(b);
      if (ra !== undefined && rb !== undefined) return ra - rb;
      if (ra !== undefined) return -1;
      if (rb !== undefined) return 1;
    }
    return a.localeCompare(b, 'zh-Hans-CN');
  });
}

type JsonbField = 'type' | 'gender' | 'age' | 'scene_type' | 'mood' | 'category';
type AssetKind = 'character' | 'scene' | 'prop';

async function distinctColumn(
  kind: AssetKind,
  column: 'era' | 'genre',
  deletedOnly: boolean,
): Promise<string[]> {
  const col = assets[column];
  const rows = await db
    .selectDistinct({ value: col })
    .from(assets)
    .where(
      and(
        eq(assets.kind, kind),
        deletedOnly ? isNotNull(assets.deletedAt) : isNull(assets.deletedAt),
        isNotNull(col),
        sql`${col} <> ''`,
      ),
    );
  return rows.map((r) => r.value).filter((v): v is string => v !== null && v !== '');
}

async function distinctJsonbField(
  kind: AssetKind,
  field: JsonbField,
  deletedOnly: boolean,
): Promise<string[]> {
  const expr = sql<string | null>`(${assets.data}->>${field})`;
  const rows = await db
    .selectDistinct({ value: expr })
    .from(assets)
    .where(
      and(
        eq(assets.kind, kind),
        deletedOnly ? isNotNull(assets.deletedAt) : isNull(assets.deletedAt),
        sql`${expr} IS NOT NULL`,
        sql`${expr} <> ''`,
      ),
    );
  return rows.map((r) => r.value).filter((v): v is string => v !== null && v !== '');
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
  // Distinct filter values per kind, replacing the static FIELDS arrays the
  // admin used to ship. Source of truth is the data itself, so newly-imported
  // values (e.g. CSV ethnicities `亚洲人/欧洲人/非洲人/机器人`) show up
  // without a frontend change.
  options: protectedProcedure.input(AssetOptionsInput).query(async ({ input }) => {
    const { kind, deletedOnly } = input;

    if (kind === 'character') {
      const [era, genre, type, gender, age] = await Promise.all([
        distinctColumn(kind, 'era', deletedOnly),
        distinctColumn(kind, 'genre', deletedOnly),
        distinctJsonbField(kind, 'type', deletedOnly),
        distinctJsonbField(kind, 'gender', deletedOnly),
        distinctJsonbField(kind, 'age', deletedOnly),
      ]);
      return {
        kind: 'character' as const,
        era: sortWithFallback(era, ERA_ORDER),
        genre: sortWithFallback(genre),
        type: sortWithFallback(type),
        gender: sortWithFallback(gender, GENDER_ORDER),
        age: sortWithFallback(age, AGE_ORDER),
      };
    }

    if (kind === 'scene') {
      const [era, genre, sceneType, mood] = await Promise.all([
        distinctColumn(kind, 'era', deletedOnly),
        distinctColumn(kind, 'genre', deletedOnly),
        distinctJsonbField(kind, 'scene_type', deletedOnly),
        distinctJsonbField(kind, 'mood', deletedOnly),
      ]);
      return {
        kind: 'scene' as const,
        era: sortWithFallback(era, ERA_ORDER),
        genre: sortWithFallback(genre),
        scene_type: sortWithFallback(sceneType),
        mood: sortWithFallback(mood),
      };
    }

    const category = await distinctJsonbField(kind, 'category', deletedOnly);
    return {
      kind: 'prop' as const,
      category: sortWithFallback(category),
    };
  }),

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
      // baseConditions excludes the cursor — they're what `total` is computed
      // against. pageConditions adds the cursor on top to walk one page.
      const baseConditions: SQL[] = [eq(assets.kind, input.kind)];

      if (input.deletedOnly) {
        baseConditions.push(isNotNull(assets.deletedAt));
      } else {
        baseConditions.push(isNull(assets.deletedAt));
      }

      if (input.search?.trim()) {
        const term = `%${input.search.trim()}%`;
        baseConditions.push(
          sql`(${assets.name} ILIKE ${term} OR cast(${assets.data} as text) ILIKE ${term})`,
        );
      }

      const { filters } = input;
      if (filters) {
        if (filters.era?.length) baseConditions.push(inArray(assets.era, filters.era));
        if (filters.genre?.length) baseConditions.push(inArray(assets.genre, filters.genre));
        if (filters.type?.length)
          baseConditions.push(inArray(sql<string>`(${assets.data}->>'type')`, filters.type));
        if (filters.gender?.length)
          baseConditions.push(inArray(sql<string>`(${assets.data}->>'gender')`, filters.gender));
        if (filters.age?.length)
          baseConditions.push(inArray(sql<string>`(${assets.data}->>'age')`, filters.age));
        if (filters.scene_type?.length)
          baseConditions.push(
            inArray(sql<string>`(${assets.data}->>'scene_type')`, filters.scene_type),
          );
        if (filters.mood?.length)
          baseConditions.push(inArray(sql<string>`(${assets.data}->>'mood')`, filters.mood));
        if (filters.category?.length)
          baseConditions.push(
            inArray(sql<string>`(${assets.data}->>'category')`, filters.category),
          );
      }

      const baseWhere = and(...baseConditions);

      // Count of all rows matching the filter (independent of cursor).
      // Surfaces the "命中 N 个" total in the FilterPanel.
      const totalRow = await db
        .select({ total: sql<number>`count(*)::int` })
        .from(assets)
        .where(baseWhere);
      const total = totalRow[0]?.total ?? 0;

      // Legacy parity (backend/db.py list_assets): `ORDER BY id` ASC. This
      // surfaces seeded characters (with proper personas like 草原雄狮 / 北极熊)
      // ahead of recent uploads (which often have no persona and a UUID/filename
      // for `name`). Cursor walks forward via `id > cursor`; nextCursor is the
      // last (largest) id on the page.
      const pageConditions = [...baseConditions];
      if (input.cursor) {
        pageConditions.push(gt(assets.id, input.cursor));
      }

      const rows = await db
        .select({ id: assets.id })
        .from(assets)
        .where(and(...pageConditions))
        .orderBy(assets.id)
        .limit(LIMIT + 1);

      const hasMore = rows.length > LIMIT;
      const pageIds = rows.slice(0, LIMIT).map((r) => r.id);
      const nextCursor =
        hasMore && pageIds.length > 0 ? (pageIds[pageIds.length - 1] ?? null) : null;

      const items = await fetchPageWithCoverImage(pageIds);
      return { items, total, nextCursor };
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
      // BEN-27: verify the just-uploaded object before persisting any DB row.
      // Any throw — verify failure, missing parent asset, or DB failure — must
      // delete the TOS object so a failed attach cannot leave an orphan blob.
      try {
        await verifyUploadedObject(input.objectKey, 'image');

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
      } catch (err) {
        await storage.deleteObject(input.objectKey).catch(() => undefined);
        throw err;
      }
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
