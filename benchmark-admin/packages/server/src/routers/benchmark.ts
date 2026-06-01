import {
  benchmarkItemComments,
  media,
  videoBenchmarkItems,
  videoBenchmarkMediaLinks,
} from '@benchmark-admin/shared/db/schema';
import {
  MediaBundleInput,
  type MediaByRoleType,
  type MediaLinkOutType,
} from '@benchmark-admin/shared/schemas/benchmark';
import { TRPCError } from '@trpc/server';
import { type SQL, and, desc, eq, gte, inArray, isNotNull, isNull, lt, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db/index.js';
import * as storage from '../services/storage/index.js';
import { t } from '../trpc/init.js';
import { protectedProcedure } from '../trpc/procedures.js';

// ── Types ─────────────────────────────────────────────────────────────────────

type LinkRow = {
  itemId: number;
  mediaId: number;
  role: string;
  sortOrder: number;
};

// Output shapes are single-sourced from the shared zod schema so the server
// payload and the client-facing contract cannot drift.

// ── Helpers ───────────────────────────────────────────────────────────────────

// UNIQUE(item_id, role, media_id) rejects the same file filling the same role
// twice. A constraint violation (PG 23505) is a client conflict — map it to
// 409 CONFLICT rather than letting it surface as an opaque 500.
function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === '23505';
}

function buildLinkRows(
  itemId: number,
  bundle: {
    characterImageIds: number[];
    sceneImageIds: number[];
    propImageIds: number[];
    audioInputIds: number[];
    videoInputIds: number[];
    videoOutputIds: number[];
  },
): LinkRow[] {
  const rows: LinkRow[] = [];
  // All six roles are multi-cardinality. Dedup each array to avoid duplicate
  // link inserts, then emit one row per file with an incrementing sortOrder.
  const roleArrays: [string, number[]][] = [
    ['character_image', bundle.characterImageIds],
    ['scene_image', bundle.sceneImageIds],
    ['prop_image', bundle.propImageIds],
    ['audio_input', bundle.audioInputIds],
    ['video_input', bundle.videoInputIds],
    ['video_output', bundle.videoOutputIds],
  ];
  for (const [role, ids] of roleArrays) {
    [...new Set(ids)].forEach((mediaId, i) => {
      rows.push({ itemId, mediaId, role, sortOrder: i });
    });
  }
  return rows;
}

async function fetchItemWithMedia(id: number) {
  const [item] = await db
    .select()
    .from(videoBenchmarkItems)
    .where(eq(videoBenchmarkItems.id, id))
    .limit(1);
  if (!item) return null;

  const links = await db
    .select()
    .from(videoBenchmarkMediaLinks)
    .where(eq(videoBenchmarkMediaLinks.itemId, id))
    .orderBy(videoBenchmarkMediaLinks.sortOrder);

  const comments = await db
    .select()
    .from(benchmarkItemComments)
    .where(and(eq(benchmarkItemComments.itemId, id), isNull(benchmarkItemComments.deletedAt)))
    .orderBy(benchmarkItemComments.createdAt);

  const mediaByRole: MediaByRoleType = {
    character_image: [],
    scene_image: [],
    prop_image: [],
    audio_input: [],
    video_input: [],
    video_output: [],
  };

  await Promise.allSettled(
    links.map(async (link) => {
      const [mediaRow] = await db
        .select()
        .from(media)
        .where(and(eq(media.id, link.mediaId), isNull(media.deletedAt)))
        .limit(1);
      // A soft-deleted media file yields no row; skip the link rather than
      // surfacing a dangling reference.
      if (!mediaRow) return;
      const url = await storage.getPresignedUrl(mediaRow.objectKey).catch(() => '');
      const linkOut: MediaLinkOutType = { ...link, url };

      switch (link.role) {
        case 'character_image':
          mediaByRole.character_image.push(linkOut);
          break;
        case 'scene_image':
          mediaByRole.scene_image.push(linkOut);
          break;
        case 'prop_image':
          mediaByRole.prop_image.push(linkOut);
          break;
        case 'audio_input':
          mediaByRole.audio_input.push(linkOut);
          break;
        case 'video_input':
          mediaByRole.video_input.push(linkOut);
          break;
        case 'video_output':
          mediaByRole.video_output.push(linkOut);
          break;
      }
    }),
  );

  return { ...item, media: mediaByRole, comments };
}

// List rows render only scalar columns (id, shotType, questionType, scene,
// score, needsRevision); media + comments are unused on the table view, so
// shipping them inflates payload, serialization, and per-page presigned-URL
// signing. Detail fetches still call `fetchItemWithMedia` and return the full
// shape.
async function fetchPageItemsBare(ids: number[]) {
  if (ids.length === 0) return [];

  const itemRows = await db
    .select()
    .from(videoBenchmarkItems)
    .where(inArray(videoBenchmarkItems.id, ids));

  const itemMap = new Map(itemRows.map((i) => [i.id, i]));
  return ids
    .map((id) => itemMap.get(id) ?? null)
    .filter((i): i is NonNullable<typeof i> => i !== null);
}

// Scalar fields accepted by create/update
const ItemScalars = z.object({
  shotType: z.string().default(''),
  taskType: z.string().default(''),
  questionType: z.string().default(''),
  manualTag: z.string().default(''),
  scene: z.string().default(''),
  screenSize: z.string().default(''),
  textPrompt: z.string().default(''),
  judgingCriteria: z.string().default(''),
  score: z.number().int().min(0).max(5).nullable().default(null),
  needsRevision: z.boolean().default(false),
});

// ── Router ────────────────────────────────────────────────────────────────────

export const benchmarkRouter = t.router({
  list: protectedProcedure
    .input(
      z.object({
        cursor: z.number().int().positive().optional(),
        deletedOnly: z.boolean().default(false),
        search: z.string().optional(),
        filters: z
          .object({
            shotType: z.string().optional(),
            questionType: z.string().optional(),
          })
          .optional(),
      }),
    )
    .query(async ({ input }) => {
      const LIMIT = 20;

      // Build shared filter predicates (no cursor — used for both count and page query)
      const baseConditions: SQL[] = [];
      if (input.deletedOnly) {
        baseConditions.push(isNotNull(videoBenchmarkItems.deletedAt));
      } else {
        baseConditions.push(isNull(videoBenchmarkItems.deletedAt));
      }
      if (input.search?.trim()) {
        const term = `%${input.search.trim()}%`;
        baseConditions.push(
          sql`(${videoBenchmarkItems.textPrompt} ILIKE ${term} OR ${videoBenchmarkItems.scene} ILIKE ${term})`,
        );
      }
      if (input.filters?.shotType) {
        baseConditions.push(eq(videoBenchmarkItems.shotType, input.filters.shotType));
      }
      if (input.filters?.questionType) {
        baseConditions.push(eq(videoBenchmarkItems.questionType, input.filters.questionType));
      }

      const baseWhere = baseConditions.length > 0 ? and(...baseConditions) : undefined;

      // Count uses the same predicates as the page query (minus cursor)
      const totalRow = await db
        .select({ total: sql<number>`count(*)::int` })
        .from(videoBenchmarkItems)
        .where(baseWhere);
      const total = totalRow[0]?.total ?? 0;

      // Page query adds cursor on top of base conditions
      const pageConditions = [...baseConditions];
      if (input.cursor) {
        pageConditions.push(lt(videoBenchmarkItems.id, input.cursor));
      }
      const pageWhere = pageConditions.length > 0 ? and(...pageConditions) : undefined;

      const rows = await db
        .select({ id: videoBenchmarkItems.id })
        .from(videoBenchmarkItems)
        .where(pageWhere)
        .orderBy(desc(videoBenchmarkItems.id))
        .limit(LIMIT + 1);

      const hasMore = rows.length > LIMIT;
      const pageIds = rows.slice(0, LIMIT).map((r) => r.id);
      const nextCursor =
        hasMore && pageIds.length > 0 ? (pageIds[pageIds.length - 1] ?? null) : null;

      const items = await fetchPageItemsBare(pageIds);

      return {
        items,
        total,
        nextCursor,
      };
    }),

  get: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ input }) => {
      const result = await fetchItemWithMedia(input.id);
      if (!result) throw new TRPCError({ code: 'NOT_FOUND' });
      return result;
    }),

  create: protectedProcedure
    .input(ItemScalars.extend({ media: MediaBundleInput }))
    .mutation(async ({ input }) => {
      const { media, ...scalars } = input;

      let item: typeof videoBenchmarkItems.$inferSelect;
      try {
        item = await db.transaction(async (tx) => {
          const [created] = await tx
            .insert(videoBenchmarkItems)
            .values({
              ...scalars,
              score: scalars.score,
            })
            .returning();
          if (!created) throw new Error('Failed to create item');

          const linkRows = buildLinkRows(created.id, media);
          if (linkRows.length > 0) {
            await tx.insert(videoBenchmarkMediaLinks).values(linkRows);
          }

          return created;
        });
      } catch (err) {
        if (isUniqueViolation(err)) {
          throw new TRPCError({ code: 'CONFLICT', message: '同一角色的媒体已存在' });
        }
        throw err;
      }

      const result = await fetchItemWithMedia(item.id);
      if (!result) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });
      return result;
    }),

  update: protectedProcedure
    .input(
      z
        .object({ id: z.number().int().positive() })
        .merge(ItemScalars.partial())
        .extend({ media: MediaBundleInput }),
    )
    .mutation(async ({ input }) => {
      const { id, media, ...scalars } = input;

      let item: typeof videoBenchmarkItems.$inferSelect;
      try {
        item = await db.transaction(async (tx) => {
          const updateSet: Record<string, unknown> = { updatedAt: new Date() };
          for (const [key, value] of Object.entries(scalars)) {
            if (value !== undefined) updateSet[key] = value;
          }

          const [updated] = await tx
            .update(videoBenchmarkItems)
            .set(updateSet)
            .where(eq(videoBenchmarkItems.id, id))
            .returning();
          if (!updated) throw new TRPCError({ code: 'NOT_FOUND' });

          // Replace all media links
          await tx.delete(videoBenchmarkMediaLinks).where(eq(videoBenchmarkMediaLinks.itemId, id));

          const linkRows = buildLinkRows(id, media);
          if (linkRows.length > 0) {
            await tx.insert(videoBenchmarkMediaLinks).values(linkRows);
          }

          return updated;
        });
      } catch (err) {
        if (isUniqueViolation(err)) {
          throw new TRPCError({ code: 'CONFLICT', message: '同一角色的媒体已存在' });
        }
        throw err;
      }

      const result = await fetchItemWithMedia(item.id);
      if (!result) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });
      return result;
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      const [deleted] = await db
        .update(videoBenchmarkItems)
        .set({ deletedAt: new Date() })
        .where(and(eq(videoBenchmarkItems.id, input.id), isNull(videoBenchmarkItems.deletedAt)))
        .returning({ id: videoBenchmarkItems.id });
      if (!deleted) throw new TRPCError({ code: 'NOT_FOUND' });
      return { id: deleted.id };
    }),

  restore: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      const [restored] = await db
        .update(videoBenchmarkItems)
        .set({ deletedAt: null })
        .where(and(eq(videoBenchmarkItems.id, input.id), isNotNull(videoBenchmarkItems.deletedAt)))
        .returning({ id: videoBenchmarkItems.id });
      if (!restored) throw new TRPCError({ code: 'NOT_FOUND' });

      const result = await fetchItemWithMedia(input.id);
      if (!result) throw new TRPCError({ code: 'NOT_FOUND' });
      return result;
    }),

  setNeedsRevision: protectedProcedure
    .input(z.object({ id: z.number().int().positive(), needsRevision: z.boolean() }))
    .mutation(async ({ input }) => {
      const [updated] = await db
        .update(videoBenchmarkItems)
        .set({ needsRevision: input.needsRevision, updatedAt: new Date() })
        .where(eq(videoBenchmarkItems.id, input.id))
        .returning({ id: videoBenchmarkItems.id });
      if (!updated) throw new TRPCError({ code: 'NOT_FOUND' });

      const result = await fetchItemWithMedia(input.id);
      if (!result) throw new TRPCError({ code: 'NOT_FOUND' });
      return result;
    }),

  stats: protectedProcedure.query(async () => {
    const groups = await db
      .select({
        shotType: videoBenchmarkItems.shotType,
        questionType: videoBenchmarkItems.questionType,
        count: sql<number>`count(*)::int`,
      })
      .from(videoBenchmarkItems)
      .where(isNull(videoBenchmarkItems.deletedAt))
      .groupBy(videoBenchmarkItems.shotType, videoBenchmarkItems.questionType);

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [todayRow] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(videoBenchmarkItems)
      .where(and(isNull(videoBenchmarkItems.deletedAt), gte(videoBenchmarkItems.createdAt, today)));

    return {
      groups: groups.map((g) => ({
        shotType: g.shotType,
        questionType: g.questionType,
        count: g.count,
      })),
      todayNew: todayRow?.count ?? 0,
    };
  }),

  comments: t.router({
    list: protectedProcedure
      .input(z.object({ itemId: z.number().int().positive() }))
      .query(async ({ input }) => {
        return db
          .select()
          .from(benchmarkItemComments)
          .where(
            and(
              eq(benchmarkItemComments.itemId, input.itemId),
              isNull(benchmarkItemComments.deletedAt),
            ),
          )
          .orderBy(benchmarkItemComments.createdAt);
      }),

    add: protectedProcedure
      .input(z.object({ itemId: z.number().int().positive(), body: z.string().min(1) }))
      .mutation(async ({ input, ctx }) => {
        const [comment] = await db
          .insert(benchmarkItemComments)
          .values({
            itemId: input.itemId,
            body: input.body,
            author: ctx.session?.email ?? '',
          })
          .returning();
        if (!comment) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });
        return comment;
      }),

    delete: protectedProcedure
      .input(z.object({ commentId: z.number().int().positive() }))
      .mutation(async ({ input }) => {
        const [deleted] = await db
          .update(benchmarkItemComments)
          .set({ deletedAt: new Date() })
          .where(
            and(
              eq(benchmarkItemComments.id, input.commentId),
              isNull(benchmarkItemComments.deletedAt),
            ),
          )
          .returning({ commentId: benchmarkItemComments.id });
        if (!deleted) throw new TRPCError({ code: 'NOT_FOUND' });
        return { commentId: deleted.commentId };
      }),
  }),
});
