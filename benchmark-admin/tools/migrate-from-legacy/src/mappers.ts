// Pure transforms: legacy rows → benchmark-admin target rows.
// No DB access here so the mapping rules are unit-testable in isolation.

import type {
  LegacyAssetImageRow,
  LegacyAssetRow,
  LegacyCommentRow,
  LegacyItemRow,
  LegacyLinkRow,
} from './legacy.ts';

// Kinds that survive as browsable assets in the 3-kind admin schema.
export const ASSET_KINDS_KEPT = new Set(['character', 'scene', 'prop']);
// Legacy kinds that were synthetic upload containers for audio/video files.
// Plan A: their files become standalone media (asset_id NULL); no asset row is created.
export const MEDIA_CONTAINER_KINDS = new Set(['audio', 'video']);
// The CHECK the admin schema applies once the difficulty column lands (ben5 migration 0004).
export const DIFFICULTY_ALLOWED = new Set(['', '易', '中', '难']);

export type TargetAsset = {
  id: number;
  kind: string;
  name: string;
  era: string | null;
  genre: string | null;
  data: Record<string, unknown>;
  cover_image_id: number | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

export type TargetMedia = {
  id: number;
  asset_id: number | null;
  title: string;
  object_key: string;
  source: string;
  media_type: string;
  created_at: string;
  deleted_at: string | null;
};

export type TargetItem = {
  id: number;
  shot_type: string;
  task_type: string;
  question_type: string;
  manual_tag: string;
  scene: string;
  screen_size: string;
  category_l1: string;
  category_l2: string;
  category_l3: string;
  category_definition: string;
  text_prompt: string;
  judging_criteria: string;
  score: number | null;
  needs_revision: boolean;
  difficulty: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

export type TargetLink = {
  id: number | null; // null = let the DB assign (used for FK-derived links)
  item_id: number;
  role: string;
  media_id: number;
  sort_order: number;
  created_at: string;
};

export type TargetComment = {
  id: number;
  item_id: number;
  author: string;
  body: string;
  created_at: string;
  deleted_at: null;
};

export type Anomaly =
  | { type: 'name_fallback'; table: 'assets'; id: number; usedName: string }
  | { type: 'difficulty_out_of_range'; table: 'video_benchmark_items'; id: number; value: string }
  | {
      type: 'fk_without_link';
      table: 'video_benchmark_items';
      id: number;
      role: string;
      mediaId: number;
    };

const str = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v));

export function basenameFromKey(objectKey: string): string {
  return objectKey.split('/').pop() ?? '';
}

// Display name for a media container asset (audio/video kinds).
export function containerTitle(data: Record<string, unknown>): string {
  return str(data.title).trim() || str(data.name).trim() || '';
}

// assets.name is the single source of the display name (RF-1 + BEN-5 new-finding-1).
// Chain: data.title -> data.persona -> data.name -> cover object_key basename -> untitled-<id>.
// Falling past the data.* chain is flagged so a human can set a real name post-migration.
export function mapAsset(
  row: LegacyAssetRow,
  coverObjectKey: string | null,
): { asset: TargetAsset; anomaly?: Anomaly } {
  const src = { ...(row.data ?? {}) };
  const primary = [str(src.title), str(src.persona), str(src.name)].find((s) => s.trim() !== '');

  let name = (primary ?? '').trim();
  let fellBack = false;
  if (!name) {
    name = basenameFromKey(str(coverObjectKey)).trim() || `untitled-${row.id}`;
    fellBack = true;
  }

  const era = str(src.era).trim() || null;
  const genre = str(src.genre).trim() || null;

  // Strip promoted columns + title so the JSONB blob never re-introduces a second display name.
  const { title: _title, era: _era, genre: _genre, ...data } = src;

  const asset: TargetAsset = {
    id: row.id,
    kind: row.kind,
    name,
    era,
    genre,
    data,
    cover_image_id: row.cover_image_id,
    created_at: row.created_at,
    updated_at: row.updated_at,
    deleted_at: row.deleted_at,
  };

  return fellBack
    ? { asset, anomaly: { type: 'name_fallback', table: 'assets', id: row.id, usedName: name } }
    : { asset };
}

// asset_images → media. Files under an audio/video container become standalone (asset_id NULL,
// title = container's display name); files under character/scene/prop keep their asset_id and
// take their name from the parent asset (title '').
export function mapMedia(
  img: LegacyAssetImageRow,
  parent: { kind: string; title: string } | undefined,
): TargetMedia {
  const standalone = parent != null && MEDIA_CONTAINER_KINDS.has(parent.kind);
  return {
    id: img.id,
    asset_id: standalone ? null : img.asset_id,
    title: standalone ? parent.title : '',
    object_key: img.object_key,
    source: img.source,
    media_type: img.media_type,
    created_at: img.created_at,
    deleted_at: null,
  };
}

export function mapItem(row: LegacyItemRow): { item: TargetItem; anomaly?: Anomaly } {
  const item: TargetItem = {
    id: row.id,
    shot_type: row.shot_type,
    task_type: row.task_type,
    question_type: row.question_type,
    manual_tag: row.manual_tag,
    scene: row.scene,
    screen_size: row.screen_size,
    category_l1: row.category_l1,
    category_l2: row.category_l2,
    category_l3: row.category_l3,
    category_definition: row.category_definition,
    text_prompt: row.text_prompt,
    judging_criteria: row.judging_criteria,
    score: row.score,
    needs_revision: row.needs_revision,
    difficulty: row.difficulty,
    created_at: row.created_at,
    updated_at: row.updated_at,
    deleted_at: row.deleted_at,
  };
  return DIFFICULTY_ALLOWED.has(row.difficulty)
    ? { item }
    : {
        item,
        anomaly: {
          type: 'difficulty_out_of_range',
          table: 'video_benchmark_items',
          id: row.id,
          value: row.difficulty,
        },
      };
}

export function mapLink(row: LegacyLinkRow): TargetLink {
  return {
    id: row.id,
    item_id: row.item_id,
    role: row.role,
    media_id: row.media_id,
    sort_order: row.sort_order,
    created_at: row.created_at,
  };
}

export function mapComment(row: LegacyCommentRow): TargetComment {
  return {
    id: row.id,
    item_id: row.item_id,
    author: row.author,
    body: row.body,
    created_at: row.created_at,
    deleted_at: null,
  };
}
