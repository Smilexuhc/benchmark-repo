// Row shapes read from the legacy benchmark Postgres (backend/migrations/0001-0014).
// Source is opened read-only; these types mirror the legacy columns we consume.

export type LegacyAssetRow = {
  id: number;
  kind: string; // character | scene | audio | prop | video
  data: Record<string, unknown>;
  cover_image_id: number | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

export type LegacyAssetImageRow = {
  id: number;
  asset_id: number;
  object_key: string;
  source: string;
  media_type: string; // image | audio | video
  created_at: string;
};

export type LegacyItemRow = {
  id: number;
  shot_type: string;
  task_type: string;
  question_type: string;
  manual_tag: string;
  difficulty: string;
  scene: string;
  screen_size: string;
  text_prompt: string;
  judging_criteria: string;
  score: number | null;
  needs_revision: boolean;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

// The six denormalized FK columns on legacy items. Used only for reconciliation:
// items created before migration 0005 (the links table) carry media references
// here with no matching link row, so we union them into the link set (loss-free).
export type LegacyItemFkRow = {
  id: number;
  created_at: string;
  character_image_id: number | null;
  scene_image_id: number | null;
  prop_image_id: number | null;
  audio_input_id: number | null;
  video_input_id: number | null;
  video_output_id: number | null;
};

export type LegacyLinkRow = {
  id: number;
  item_id: number;
  role: string;
  media_id: number;
  sort_order: number;
  created_at: string;
};

export type LegacyCommentRow = {
  id: number;
  item_id: number;
  author: string;
  body: string;
  created_at: string;
};

// Maps a legacy FK column to the media-link role it denormalizes.
export const FK_COLUMN_TO_ROLE: Record<string, string> = {
  character_image_id: 'character_image',
  scene_image_id: 'scene_image',
  prop_image_id: 'prop_image',
  audio_input_id: 'audio_input',
  video_input_id: 'video_input',
  video_output_id: 'video_output',
};
