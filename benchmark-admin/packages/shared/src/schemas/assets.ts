import { createInsertSchema, createSelectSchema } from 'drizzle-zod';
import { z } from 'zod';
import { assets, media } from '../db/schema.js';

// ── JSONB data variants ────────────────────────────────────────────────────────
// era/genre/name are promoted columns (RF-1) — excluded from data to avoid drift.

export const CharacterDataSchema = z.object({
  type: z.string().optional(),
  gender: z.string().optional(),
  age: z.string().optional(),
  persona: z.string().optional(),
  body: z.string().optional(),
  features: z.string().optional(),
  prompt: z.string().optional(),
  description: z.string().optional(),
});

export const SceneDataSchema = z.object({
  scene_type: z.string().optional(),
  mood: z.string().optional(),
  elements: z.array(z.string()).optional(),
  prompt: z.string().optional(),
  description: z.string().optional(),
});

export const PropDataSchema = z.object({
  category: z.string().optional(),
  prompt: z.string().optional(),
  description: z.string().optional(),
});

export type CharacterData = z.infer<typeof CharacterDataSchema>;
export type SceneData = z.infer<typeof SceneDataSchema>;
export type PropData = z.infer<typeof PropDataSchema>;

// ── Select / output schemas ────────────────────────────────────────────────────

const AssetBase = createSelectSchema(assets);

export const CharacterAsset = AssetBase.extend({
  kind: z.literal('character'),
  data: CharacterDataSchema,
});

export const SceneAsset = AssetBase.extend({
  kind: z.literal('scene'),
  data: SceneDataSchema,
});

export const PropAsset = AssetBase.extend({
  kind: z.literal('prop'),
  data: PropDataSchema,
});

export const AssetSchema = z.discriminatedUnion('kind', [CharacterAsset, SceneAsset, PropAsset]);

export type Asset = z.infer<typeof AssetSchema>;

// Media output — includes presigned URL injected at query time (not a DB column).
// url is a presigned URL, or '' when presigning degraded (one TOS failure must
// not reject the whole payload) — so the contract allows the empty fallback.
export const AssetImageOut = createSelectSchema(media).extend({
  url: z.union([z.string().url(), z.literal('')]),
});

export type AssetImageOutType = z.infer<typeof AssetImageOut>;

// Generic AssetWithImages wrapper — adds images array and coverImageId to any asset variant
export const AssetWithImages = <T extends z.ZodTypeAny>(variant: T) =>
  variant.and(
    z.object({
      images: z.array(AssetImageOut),
      coverImageId: z.number().nullable(),
    }),
  );

// ── Insert / update schemas ────────────────────────────────────────────────────

const AssetInsertBase = createInsertSchema(assets).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  deletedAt: true,
  coverImageId: true, // set via setCover after images are attached
});

const CharacterInsert = AssetInsertBase.extend({
  kind: z.literal('character'),
  data: CharacterDataSchema,
});

const SceneInsert = AssetInsertBase.extend({
  kind: z.literal('scene'),
  data: SceneDataSchema,
});

const PropInsert = AssetInsertBase.extend({
  kind: z.literal('prop'),
  data: PropDataSchema,
});

export const AssetInsert = z.discriminatedUnion('kind', [CharacterInsert, SceneInsert, PropInsert]);

// AssetUpdate: all fields partial except kind (kind is immutable post-create)
export const AssetUpdate = z.discriminatedUnion('kind', [
  CharacterInsert.partial().required({ kind: true }),
  SceneInsert.partial().required({ kind: true }),
  PropInsert.partial().required({ kind: true }),
]);

export type AssetInsertType = z.infer<typeof AssetInsert>;
export type AssetUpdateType = z.infer<typeof AssetUpdate>;

// ── Filter options (assets.options) ───────────────────────────────────────────
// Returns the real distinct-value set per filter field for each asset kind, so
// the admin UI can stop shipping hardcoded FIELDS arrays that drift from the
// actual data (e.g. character `type` was `人类/动物/...` while the CSV stores
// `亚洲人/欧洲人/非洲人/机器人/...`).

export const AssetOptionsInput = z.object({
  kind: z.enum(['character', 'scene', 'prop']),
  deletedOnly: z.boolean().default(false),
});

export type AssetOptionsInputType = z.infer<typeof AssetOptionsInput>;

const StringArray = z.array(z.string());

export const CharacterOptions = z.object({
  kind: z.literal('character'),
  era: StringArray,
  genre: StringArray,
  type: StringArray,
  gender: StringArray,
  age: StringArray,
});

export const SceneOptions = z.object({
  kind: z.literal('scene'),
  era: StringArray,
  genre: StringArray,
  scene_type: StringArray,
  mood: StringArray,
});

export const PropOptions = z.object({
  kind: z.literal('prop'),
  category: StringArray,
});

export const AssetOptionsOutput = z.discriminatedUnion('kind', [
  CharacterOptions,
  SceneOptions,
  PropOptions,
]);

export type AssetOptionsOutputType = z.infer<typeof AssetOptionsOutput>;
