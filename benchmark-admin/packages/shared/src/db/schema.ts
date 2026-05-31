import { relations, sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  bigint,
  bigserial,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

// assets.cover_image_id → asset_images.id creates a circular reference.
// The FK is declared with a callback so TypeScript resolves after both tables are defined.
// The DEFERRABLE INITIALLY DEFERRED modifier is hand-appended to the generated migration SQL
// (drizzle-kit emits a plain FK; deferral is required for the asset↔cover-image insert tx).

export const assets = pgTable(
  'assets',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    kind: text('kind').notNull(),
    name: text('name').notNull(),
    era: text('era'),
    genre: text('genre'),
    data: jsonb('data').notNull().default({}),
    // FK → asset_images.id; DEFERRABLE INITIALLY DEFERRED added via migration SQL
    coverImageId: bigint('cover_image_id', { mode: 'number' }).references(
      (): AnyPgColumn => assetImages.id,
      { onDelete: 'set null' },
    ),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    check('chk_assets_kind', sql`${t.kind} IN ('character', 'scene', 'prop')`),
    index('idx_assets_data').using('gin', t.data),
    index('idx_assets_kind_deleted').on(t.kind, t.deletedAt),
    index('idx_assets_kind_era').on(t.kind, t.era),
    index('idx_assets_kind_genre').on(t.kind, t.genre),
  ],
);

export const assetImages = pgTable(
  'asset_images',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    assetId: bigint('asset_id', { mode: 'number' })
      .notNull()
      .references(() => assets.id, { onDelete: 'cascade' }),
    objectKey: text('object_key').notNull(),
    source: text('source').notNull().default('generated'),
    mediaType: text('media_type').notNull().default('image'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    check('chk_asset_images_media_type', sql`${t.mediaType} IN ('image', 'audio', 'video')`),
    index('idx_asset_images_asset_id').on(t.assetId),
    index('idx_asset_images_media_type').on(t.mediaType),
    index('idx_asset_images_object_key').on(t.objectKey),
  ],
);

export const videoBenchmarkItems = pgTable(
  'video_benchmark_items',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    shotType: text('shot_type').notNull().default(''),
    taskType: text('task_type').notNull().default(''),
    questionType: text('question_type').notNull().default(''),
    manualTag: text('manual_tag').notNull().default(''),
    scene: text('scene').notNull().default(''),
    screenSize: text('screen_size').notNull().default(''),
    textPrompt: text('text_prompt').notNull().default(''),
    judgingCriteria: text('judging_criteria').notNull().default(''),
    score: smallint('score'),
    needsRevision: boolean('needs_revision').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    check('chk_vbi_score', sql`${t.score} IS NULL OR (${t.score} >= 0 AND ${t.score} <= 5)`),
    index('idx_vbi_shot_question').on(t.shotType, t.questionType),
    index('idx_vbi_active').on(t.id).where(sql`${t.deletedAt} IS NULL`),
  ],
);

// video_benchmark_media_links — single canonical media store (RF-2).
// Two constraints are hand-appended to the migration SQL:
// 1. UNIQUE(item_id, role, media_id) — same image can't fill the same role twice on one item
// 2. Partial unique index: UNIQUE(item_id, role) WHERE role IN ('audio_input','video_input','video_output')
//    — enforces single-cardinality for those three roles at the DB level
export const videoBenchmarkMediaLinks = pgTable(
  'video_benchmark_media_links',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    itemId: bigint('item_id', { mode: 'number' })
      .notNull()
      .references(() => videoBenchmarkItems.id, { onDelete: 'cascade' }),
    mediaId: bigint('media_id', { mode: 'number' })
      .notNull()
      .references(() => assetImages.id, { onDelete: 'cascade' }),
    role: text('role').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    check(
      'chk_media_links_role',
      sql`${t.role} IN ('character_image', 'scene_image', 'prop_image', 'audio_input', 'video_input', 'video_output')`,
    ),
    unique('uq_media_links_item_role_media').on(t.itemId, t.role, t.mediaId),
    index('idx_media_links_item_role').on(t.itemId, t.role),
    index('idx_media_links_media').on(t.mediaId),
    // Partial unique index: single-cardinality roles may appear at most once per item.
    // Already present in 0000 migration SQL; expressed here so schema stays in sync.
    uniqueIndex('idx_media_links_single_cardinality')
      .on(t.itemId, t.role)
      .where(sql`role IN ('audio_input', 'video_input', 'video_output')`),
  ],
);

export const benchmarkItemComments = pgTable(
  'benchmark_item_comments',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    itemId: bigint('item_id', { mode: 'number' })
      .notNull()
      .references(() => videoBenchmarkItems.id, { onDelete: 'cascade' }),
    author: text('author').notNull().default(''),
    body: text('body').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index('idx_bic_item_id_created').on(t.itemId, t.createdAt)],
);

// ── Relations ──────────────────────────────────────────────────────────────────

export const assetsRelations = relations(assets, ({ one, many }) => ({
  // one asset has many images (via asset_images.asset_id)
  images: many(assetImages, { relationName: 'assetImages' }),
  // cover image is a specific asset_images row (via assets.cover_image_id)
  coverImage: one(assetImages, {
    fields: [assets.coverImageId],
    references: [assetImages.id],
    relationName: 'assetCoverImage',
  }),
}));

export const assetImagesRelations = relations(assetImages, ({ one, many }) => ({
  asset: one(assets, {
    fields: [assetImages.assetId],
    references: [assets.id],
    relationName: 'assetImages',
  }),
  mediaLinks: many(videoBenchmarkMediaLinks),
}));

export const videoBenchmarkItemsRelations = relations(videoBenchmarkItems, ({ many }) => ({
  mediaLinks: many(videoBenchmarkMediaLinks),
  comments: many(benchmarkItemComments),
}));

export const videoBenchmarkMediaLinksRelations = relations(videoBenchmarkMediaLinks, ({ one }) => ({
  item: one(videoBenchmarkItems, {
    fields: [videoBenchmarkMediaLinks.itemId],
    references: [videoBenchmarkItems.id],
  }),
  media: one(assetImages, {
    fields: [videoBenchmarkMediaLinks.mediaId],
    references: [assetImages.id],
  }),
}));

export const benchmarkItemCommentsRelations = relations(benchmarkItemComments, ({ one }) => ({
  item: one(videoBenchmarkItems, {
    fields: [benchmarkItemComments.itemId],
    references: [videoBenchmarkItems.id],
  }),
}));
