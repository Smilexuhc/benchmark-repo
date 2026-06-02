import {
  benchmarkItemComments,
  media,
  videoBenchmarkItems,
  videoBenchmarkMediaLinks,
} from '@benchmark-admin/shared/db/schema';
import {
  CommentAddInput,
  MediaBundleInput,
  type MediaByRoleType,
  type MediaLinkOutType,
} from '@benchmark-admin/shared/schemas/benchmark';
import { definitionFor } from '@benchmark-admin/shared/benchmark/categoryTree';
import { TRPCError } from '@trpc/server';
import { type SQL, and, desc, eq, gte, inArray, isNotNull, isNull, lt, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db/index.js';
import { mediaVisible } from '../db/soft-delete.js';
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
        .where(and(eq(media.id, link.mediaId), mediaVisible()))
        .limit(1);
      // An invisible media file (own soft-delete OR a soft-deleted parent asset)
      // yields no row; skip the link rather than surfacing a dangling reference.
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

function emptyMediaByRole(): MediaByRoleType {
  return {
    character_image: [],
    scene_image: [],
    prop_image: [],
    audio_input: [],
    video_input: [],
    video_output: [],
  };
}

// List rows carry their media (grouped by role) so the table can render image
// thumbnails and play output videos inline — legacy parity. Media is batch
// loaded for the whole page (one links query + one media query + parallel
// presigning) to avoid an N+1 per row. Comments are still omitted from the list
// payload, but `commentCount` is rolled up so the card can show the 评论 N
// pill without a per-row fetch; the detail fetch (`fetchItemWithMedia`)
// returns the full comment list.
async function fetchPageItems(ids: number[]) {
  if (ids.length === 0) return [];

  const itemRows = await db
    .select()
    .from(videoBenchmarkItems)
    .where(inArray(videoBenchmarkItems.id, ids));
  const itemMap = new Map(itemRows.map((i) => [i.id, i]));

  const links = await db
    .select()
    .from(videoBenchmarkMediaLinks)
    .where(inArray(videoBenchmarkMediaLinks.itemId, ids))
    .orderBy(videoBenchmarkMediaLinks.sortOrder);

  const mediaIds = [...new Set(links.map((l) => l.mediaId))];
  const mediaRows =
    mediaIds.length > 0
      ? await db
          .select()
          .from(media)
          .where(and(inArray(media.id, mediaIds), mediaVisible()))
      : [];

  // Presign every visible media file once, in parallel.
  const urlById = new Map<number, string>();
  await Promise.all(
    mediaRows.map(async (m) => {
      urlById.set(m.id, await storage.getPresignedUrl(m.objectKey).catch(() => ''));
    }),
  );
  const visibleIds = new Set(mediaRows.map((m) => m.id));

  const mediaByItem = new Map<number, MediaByRoleType>();
  for (const link of links) {
    // Skip links whose media is invisible (own soft-delete or soft-deleted parent asset).
    if (!visibleIds.has(link.mediaId)) continue;
    let group = mediaByItem.get(link.itemId);
    if (!group) {
      group = emptyMediaByRole();
      mediaByItem.set(link.itemId, group);
    }
    const linkOut: MediaLinkOutType = { ...link, url: urlById.get(link.mediaId) ?? '' };
    if (link.role in group) {
      (group[link.role as keyof MediaByRoleType] as MediaLinkOutType[]).push(linkOut);
    }
  }

  // List rows surface comment count (U10) without shipping the full comment
  // payload — single grouped count query keeps the page request O(1) extra.
  const commentCounts = await db
    .select({
      itemId: benchmarkItemComments.itemId,
      count: sql<number>`count(*)::int`,
    })
    .from(benchmarkItemComments)
    .where(and(inArray(benchmarkItemComments.itemId, ids), isNull(benchmarkItemComments.deletedAt)))
    .groupBy(benchmarkItemComments.itemId);
  const commentCountByItem = new Map(commentCounts.map((c) => [c.itemId, c.count]));

  return ids
    .map((id) => {
      const item = itemMap.get(id);
      if (!item) return null;
      return {
        ...item,
        media: mediaByItem.get(id) ?? emptyMediaByRole(),
        commentCount: commentCountByItem.get(id) ?? 0,
      };
    })
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
  categoryL1: z.string().default(''),
  categoryL2: z.string().default(''),
  categoryL3: z.string().default(''),
  categoryDefinition: z.string().default(''),
  difficulty: z.enum(['', '易', '中', '难']).default(''),
  textPrompt: z.string().default(''),
  judgingCriteria: z.string().default(''),
  score: z.number().int().min(0).max(5).nullable().default(null),
  needsRevision: z.boolean().default(false),
});

// categoryDefinition is derived data: when the (l1,l2,l3) path resolves to a known
// tree leaf, that leaf's definition is authoritative and overrides any client-sent
// value so the stored definition can never drift from the selected path. An
// unresolved path (legacy free-text categories not in the tree) keeps whatever value
// was supplied. Only applies when all three levels are present (full create, or an
// update payload that carries the category path); partial updates that omit the
// category fields pass through untouched.
function deriveCategoryDefinition<
  T extends {
    categoryL1?: string | undefined;
    categoryL2?: string | undefined;
    categoryL3?: string | undefined;
    categoryDefinition?: string | undefined;
  },
>(scalars: T): T {
  const { categoryL1, categoryL2, categoryL3 } = scalars;
  if (categoryL1 === undefined || categoryL2 === undefined || categoryL3 === undefined) {
    return scalars;
  }
  const canonical = definitionFor(categoryL1, categoryL2, categoryL3);
  return canonical ? { ...scalars, categoryDefinition: canonical } : scalars;
}

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
            taskType: z.string().optional(),
            questionType: z.string().optional(),
            categoryL1: z.string().optional(),
            categoryL2: z.string().optional(),
            categoryL3: z.string().optional(),
            scene: z.string().optional(),
            screenSize: z.string().optional(),
            difficulty: z.enum(['', '易', '中', '难']).optional(),
            manualTag: z.string().optional(),
            score: z.number().int().min(0).max(5).optional(),
            needsRevision: z.boolean().optional(),
            hasComments: z.boolean().optional(),
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
        // Search spans every scalar text field (legacy parity: the search box
        // matches anywhere, not just prompt/scene).
        baseConditions.push(
          sql`(${videoBenchmarkItems.textPrompt} ILIKE ${term}
            OR ${videoBenchmarkItems.scene} ILIKE ${term}
            OR ${videoBenchmarkItems.shotType} ILIKE ${term}
            OR ${videoBenchmarkItems.taskType} ILIKE ${term}
            OR ${videoBenchmarkItems.questionType} ILIKE ${term}
            OR ${videoBenchmarkItems.manualTag} ILIKE ${term}
            OR ${videoBenchmarkItems.screenSize} ILIKE ${term}
            OR ${videoBenchmarkItems.categoryL1} ILIKE ${term}
            OR ${videoBenchmarkItems.categoryL2} ILIKE ${term}
            OR ${videoBenchmarkItems.categoryL3} ILIKE ${term}
            OR ${videoBenchmarkItems.categoryDefinition} ILIKE ${term}
            OR ${videoBenchmarkItems.judgingCriteria} ILIKE ${term})`,
        );
      }
      const f = input.filters;
      if (f?.shotType) baseConditions.push(eq(videoBenchmarkItems.shotType, f.shotType));
      if (f?.taskType) baseConditions.push(eq(videoBenchmarkItems.taskType, f.taskType));
      if (f?.questionType)
        baseConditions.push(eq(videoBenchmarkItems.questionType, f.questionType));
      if (f?.categoryL1) baseConditions.push(eq(videoBenchmarkItems.categoryL1, f.categoryL1));
      if (f?.categoryL2) baseConditions.push(eq(videoBenchmarkItems.categoryL2, f.categoryL2));
      if (f?.categoryL3) baseConditions.push(eq(videoBenchmarkItems.categoryL3, f.categoryL3));
      if (f?.scene) baseConditions.push(eq(videoBenchmarkItems.scene, f.scene));
      if (f?.screenSize) baseConditions.push(eq(videoBenchmarkItems.screenSize, f.screenSize));
      if (f?.difficulty) baseConditions.push(eq(videoBenchmarkItems.difficulty, f.difficulty));
      if (f?.manualTag) {
        baseConditions.push(sql`${videoBenchmarkItems.manualTag} ILIKE ${`%${f.manualTag}%`}`);
      }
      if (f?.score !== undefined) baseConditions.push(eq(videoBenchmarkItems.score, f.score));
      if (f?.needsRevision !== undefined) {
        baseConditions.push(eq(videoBenchmarkItems.needsRevision, f.needsRevision));
      }
      if (f?.hasComments !== undefined) {
        // EXISTS over alive comments — filter items that do (or don't) have any
        // non-deleted comment.
        const existsClause = sql`EXISTS (
          SELECT 1 FROM ${benchmarkItemComments}
          WHERE ${benchmarkItemComments.itemId} = ${videoBenchmarkItems.id}
            AND ${benchmarkItemComments.deletedAt} IS NULL
        )`;
        baseConditions.push(f.hasComments ? existsClause : sql`NOT ${existsClause}`);
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

      const items = await fetchPageItems(pageIds);

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
      const { media, ...rawScalars } = input;
      const scalars = deriveCategoryDefinition(rawScalars);

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
      const { id, media, ...rawScalars } = input;
      const scalars = deriveCategoryDefinition(rawScalars);

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

  // Inline-edit path for the list card: the full `update` mutation requires a
  // media bundle (it rebuilds links transactionally), so a score-only patch
  // would force the card to keep a media snapshot just to set a number. A
  // dedicated mutation matches the existing `setNeedsRevision` pattern.
  setScore: protectedProcedure
    .input(
      z.object({
        id: z.number().int().positive(),
        score: z.number().int().min(0).max(5).nullable(),
      }),
    )
    .mutation(async ({ input }) => {
      const [updated] = await db
        .update(videoBenchmarkItems)
        .set({ score: input.score, updatedAt: new Date() })
        .where(eq(videoBenchmarkItems.id, input.id))
        .returning({ id: videoBenchmarkItems.id });
      if (!updated) throw new TRPCError({ code: 'NOT_FOUND' });

      const result = await fetchItemWithMedia(input.id);
      if (!result) throw new TRPCError({ code: 'NOT_FOUND' });
      return result;
    }),

  stats: protectedProcedure.query(async () => {
    // Legacy parity (backend/db.py video_benchmark_stats): group by the V3 category
    // path. Empty-category rows group under '' and are still counted.
    const groups = await db
      .select({
        categoryL1: videoBenchmarkItems.categoryL1,
        categoryL2: videoBenchmarkItems.categoryL2,
        categoryL3: videoBenchmarkItems.categoryL3,
        count: sql<number>`count(*)::int`,
      })
      .from(videoBenchmarkItems)
      .where(isNull(videoBenchmarkItems.deletedAt))
      .groupBy(
        videoBenchmarkItems.categoryL1,
        videoBenchmarkItems.categoryL2,
        videoBenchmarkItems.categoryL3,
      );

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [todayRow] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(videoBenchmarkItems)
      .where(and(isNull(videoBenchmarkItems.deletedAt), gte(videoBenchmarkItems.createdAt, today)));

    return {
      groups: groups.map((g) => ({
        categoryL1: g.categoryL1,
        categoryL2: g.categoryL2,
        categoryL3: g.categoryL3,
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

    add: protectedProcedure.input(CommentAddInput).mutation(async ({ input }) => {
      const [comment] = await db
        .insert(benchmarkItemComments)
        .values({
          itemId: input.itemId,
          body: input.body,
          author: input.author,
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
