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
} from 'drizzle-orm/pg-core';

// assets.cover_image_id → media.id creates a circular reference.
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
    // FK → media.id; DEFERRABLE INITIALLY DEFERRED added via migration SQL
    coverImageId: bigint('cover_image_id', { mode: 'number' }).references(
      (): AnyPgColumn => media.id,
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
    // softDeleteMedia nulls every cover pointing at the deleted file
    // (UPDATE assets SET cover_image_id = NULL WHERE cover_image_id = $1),
    // standing in for the dormant cover_image_id → SET NULL FK. Index that lookup.
    index('idx_assets_cover_image_id').on(t.coverImageId),
  ],
);

// media — a stored media file (image | audio | video) in object storage.
// assetId is nullable: a file may belong to a character/scene/prop asset (assetId set)
// or be a standalone upload used directly as a benchmark item's audio/video media (assetId NULL).
// title holds the display name of a standalone file (asset-bound files take their name from the asset).
// Soft-deleted via deletedAt — bytes in object storage are preserved for recovery.
export const media = pgTable(
  'media',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    assetId: bigint('asset_id', { mode: 'number' }).references(() => assets.id, {
      onDelete: 'cascade',
    }),
    title: text('title').notNull().default(''),
    objectKey: text('object_key').notNull(),
    source: text('source').notNull().default('generated'),
    mediaType: text('media_type').notNull().default('image'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    check('chk_media_media_type', sql`${t.mediaType} IN ('image', 'audio', 'video')`),
    index('idx_media_asset_id').on(t.assetId),
    index('idx_media_media_type').on(t.mediaType),
    index('idx_media_object_key').on(t.objectKey),
    // Hot path: asset detail + library cover derivation scan a single asset's
    // (or a page's) ALIVE media by asset_id. Partial-on-alive keeps soft-deleted
    // rows out of the index so the scan matches the deleted_at IS NULL filter.
    index('idx_media_asset_active')
      .on(t.assetId)
      .where(sql`${t.deletedAt} IS NULL`),
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
    // V3 category dimension (legacy 0015): three-level classification + the leaf's
    // definition/intent. Free TEXT, not an enum — valid values live in the UI category tree.
    categoryL1: text('category_l1').notNull().default(''),
    categoryL2: text('category_l2').notNull().default(''),
    categoryL3: text('category_l3').notNull().default(''),
    categoryDefinition: text('category_definition').notNull().default(''),
    // Legacy difficulty: empty (unset) or one of 易/中/难. Auto-prefixed onto manual_tag as 【难】.
    difficulty: text('difficulty').notNull().default(''),
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
    check('chk_vbi_difficulty', sql`${t.difficulty} IN ('', '易', '中', '难')`),
    index('idx_vbi_shot_question').on(t.shotType, t.questionType),
    index('idx_vbi_category').on(t.categoryL1, t.categoryL2, t.categoryL3),
    index('idx_vbi_active').on(t.id).where(sql`${t.deletedAt} IS NULL`),
  ],
);

// video_benchmark_media_links — the single canonical media store (RF-2).
// A link is derived wiring between an item and a media file, not standalone content,
// so it is hard-deleted (rebuilt transactionally on item update), not soft-deleted.
// UNIQUE(item_id, role, media_id) prevents the same file filling the same role twice.
// All six roles are multi-cardinality (legacy accepts lists for audio/video too).
export const videoBenchmarkMediaLinks = pgTable(
  'video_benchmark_media_links',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    itemId: bigint('item_id', { mode: 'number' })
      .notNull()
      .references(() => videoBenchmarkItems.id, { onDelete: 'cascade' }),
    mediaId: bigint('media_id', { mode: 'number' })
      .notNull()
      .references(() => media.id, { onDelete: 'cascade' }),
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
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    index('idx_bic_item_id_created').on(t.itemId, t.createdAt),
    // fetchItemWithMedia reads an item's ALIVE comments ordered by created_at.
    // Partial-on-alive matches the deleted_at IS NULL filter and orders for free.
    index('idx_bic_active')
      .on(t.itemId, t.createdAt)
      .where(sql`${t.deletedAt} IS NULL`),
  ],
);

// ── Relations ──────────────────────────────────────────────────────────────────

export const assetsRelations = relations(assets, ({ one, many }) => ({
  // one asset has many media files (via media.asset_id)
  images: many(media, { relationName: 'assetMedia' }),
  // cover image is a specific media row (via assets.cover_image_id)
  coverImage: one(media, {
    fields: [assets.coverImageId],
    references: [media.id],
    relationName: 'assetCoverImage',
  }),
}));

export const mediaRelations = relations(media, ({ one, many }) => ({
  // optional: standalone media files have no parent asset
  asset: one(assets, {
    fields: [media.assetId],
    references: [assets.id],
    relationName: 'assetMedia',
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
  media: one(media, {
    fields: [videoBenchmarkMediaLinks.mediaId],
    references: [media.id],
  }),
}));

export const benchmarkItemCommentsRelations = relations(benchmarkItemComments, ({ one }) => ({
  item: one(videoBenchmarkItems, {
    fields: [benchmarkItemComments.itemId],
    references: [videoBenchmarkItems.id],
  }),
}));
