import { TRPCError } from '@trpc/server';
import { type SQL, and, desc, eq, gte, inArray, isNotNull, isNull, lt, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  assetImages,
  benchmarkItemComments,
  videoBenchmarkItems,
  videoBenchmarkMediaLinks,
} from '@benchmark-admin/shared/db/schema';
import { MediaBundleInput } from '@benchmark-admin/shared/schemas/benchmark';
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

type MediaLinkOut = typeof videoBenchmarkMediaLinks.$inferSelect & { url: string };

type MediaByRole = {
  character_image: MediaLinkOut[];
  scene_image: MediaLinkOut[];
  prop_image: MediaLinkOut[];
  audio_input: MediaLinkOut | null;
  video_input: MediaLinkOut | null;
  video_output: MediaLinkOut | null;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildLinkRows(
  itemId: number,
  bundle: {
    characterImageIds: number[];
    sceneImageIds: number[];
    propImageIds: number[];
    audioInputId: number | null;
    videoInputId: number | null;
    videoOutputId: number | null;
  },
): LinkRow[] {
  const rows: LinkRow[] = [];
  bundle.characterImageIds.forEach((mediaId, i) => {
    rows.push({ itemId, mediaId, role: 'character_image', sortOrder: i });
  });
  bundle.sceneImageIds.forEach((mediaId, i) => {
    rows.push({ itemId, mediaId, role: 'scene_image', sortOrder: i });
  });
  bundle.propImageIds.forEach((mediaId, i) => {
    rows.push({ itemId, mediaId, role: 'prop_image', sortOrder: i });
  });
  if (bundle.audioInputId !== null)
    rows.push({ itemId, mediaId: bundle.audioInputId, role: 'audio_input', sortOrder: 0 });
  if (bundle.videoInputId !== null)
    rows.push({ itemId, mediaId: bundle.videoInputId, role: 'video_input', sortOrder: 0 });
  if (bundle.videoOutputId !== null)
    rows.push({ itemId, mediaId: bundle.videoOutputId, role: 'video_output', sortOrder: 0 });
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
    .where(eq(benchmarkItemComments.itemId, id))
    .orderBy(benchmarkItemComments.createdAt);

  const media: MediaByRole = {
    character_image: [],
    scene_image: [],
    prop_image: [],
    audio_input: null,
    video_input: null,
    video_output: null,
  };

  await Promise.all(
    links.map(async (link) => {
      const [imgRow] = await db
        .select()
        .from(assetImages)
        .where(eq(assetImages.id, link.mediaId))
        .limit(1);
      const url = imgRow ? await storage.getPresignedUrl(imgRow.objectKey) : '';
      const linkOut: MediaLinkOut = { ...link, url };

      switch (link.role) {
        case 'character_image':
          media.character_image.push(linkOut);
          break;
        case 'scene_image':
          media.scene_image.push(linkOut);
          break;
        case 'prop_image':
          media.prop_image.push(linkOut);
          break;
        case 'audio_input':
          media.audio_input = linkOut;
          break;
        case 'video_input':
          media.video_input = linkOut;
          break;
        case 'video_output':
          media.video_output = linkOut;
          break;
      }
    }),
  );

  return { ...item, media, comments };
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
      const conditions: SQL[] = [];

      if (input.deletedOnly) {
        conditions.push(isNotNull(videoBenchmarkItems.deletedAt));
      } else {
        conditions.push(isNull(videoBenchmarkItems.deletedAt));
      }

      if (input.cursor) {
        conditions.push(lt(videoBenchmarkItems.id, input.cursor));
      }

      if (input.search?.trim()) {
        const term = `%${input.search.trim()}%`;
        conditions.push(
          sql`(${videoBenchmarkItems.textPrompt} ILIKE ${term} OR ${videoBenchmarkItems.scene} ILIKE ${term})`,
        );
      }

      if (input.filters?.shotType) {
        conditions.push(eq(videoBenchmarkItems.shotType, input.filters.shotType));
      }
      if (input.filters?.questionType) {
        conditions.push(eq(videoBenchmarkItems.questionType, input.filters.questionType));
      }

      const where = conditions.length > 0 ? and(...conditions) : undefined;

      const totalRow = await db
        .select({ total: sql<number>`count(*)::int` })
        .from(videoBenchmarkItems)
        .where(
          input.deletedOnly ? isNotNull(videoBenchmarkItems.deletedAt) : isNull(videoBenchmarkItems.deletedAt),
        );
      const total = totalRow[0]?.total ?? 0;

      const rows = await db
        .select({ id: videoBenchmarkItems.id })
        .from(videoBenchmarkItems)
        .where(where)
        .orderBy(desc(videoBenchmarkItems.id))
        .limit(LIMIT + 1);

      const hasMore = rows.length > LIMIT;
      const pageIds = rows.slice(0, LIMIT).map((r) => r.id);
      const nextCursor = hasMore && pageIds.length > 0 ? (pageIds[pageIds.length - 1] ?? null) : null;

      const items = await Promise.all(pageIds.map(fetchItemWithMedia));

      return {
        items: items.filter((i): i is NonNullable<typeof i> => i !== null),
        total: total ?? 0,
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

      const item = await db.transaction(async (tx) => {
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

      const result = await fetchItemWithMedia(item.id);
      if (!result) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });
      return result;
    }),

  update: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }).merge(ItemScalars.partial()).extend({ media: MediaBundleInput }))
    .mutation(async ({ input }) => {
      const { id, media, ...scalars } = input;

      const item = await db.transaction(async (tx) => {
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
        await tx
          .delete(videoBenchmarkMediaLinks)
          .where(eq(videoBenchmarkMediaLinks.itemId, id));

        const linkRows = buildLinkRows(id, media);
        if (linkRows.length > 0) {
          await tx.insert(videoBenchmarkMediaLinks).values(linkRows);
        }

        return updated;
      });

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
      .where(
        and(isNull(videoBenchmarkItems.deletedAt), gte(videoBenchmarkItems.createdAt, today)),
      );

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
          .where(eq(benchmarkItemComments.itemId, input.itemId))
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
          .delete(benchmarkItemComments)
          .where(eq(benchmarkItemComments.id, input.commentId))
          .returning({ commentId: benchmarkItemComments.id });
        if (!deleted) throw new TRPCError({ code: 'NOT_FOUND' });
        return { commentId: deleted.commentId };
      }),
  }),
});

// Re-export for type inference by consumers
export type { MediaByRole };
