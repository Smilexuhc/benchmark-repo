import { createSelectSchema } from 'drizzle-zod';
import { z } from 'zod';
import {
  benchmarkItemComments,
  videoBenchmarkItems,
  videoBenchmarkMediaLinks,
} from '../db/schema.js';
import { AssetImageOut } from './assets.js';

export const VideoBenchmarkItem = createSelectSchema(videoBenchmarkItems);
export type VideoBenchmarkItemType = z.infer<typeof VideoBenchmarkItem>;

export const MediaLink = createSelectSchema(videoBenchmarkMediaLinks);
// url is a presigned URL, or '' when presigning degraded (one TOS failure must
// not reject the whole payload) — so the contract allows the empty fallback.
export const MediaLinkOut = MediaLink.extend({
  url: z.union([z.string().url(), z.literal('')]),
});
export type MediaLinkOutType = z.infer<typeof MediaLinkOut>;

export const BenchmarkComment = createSelectSchema(benchmarkItemComments);
export type BenchmarkCommentType = z.infer<typeof BenchmarkComment>;

// Inbound shape for benchmark.comments.add — author is now user-supplied
// (legacy parity: the comment header shows whoever typed it, not the logged-in
// admin). Empty author is rejected so the client cannot silently submit an
// anonymous comment.
export const CommentAddInput = z.object({
  itemId: z.number().int().positive(),
  author: z.string().min(1),
  body: z.string().min(1),
});
export type CommentAddInputType = z.infer<typeof CommentAddInput>;

// MediaBundleInput — the inbound media wiring for an item.
// All six roles are multi-cardinality (legacy accepts lists for audio/video too).
// The service explodes this into video_benchmark_media_links rows.
// .strict() is load-bearing: update does delete-all-then-reinsert of links, so a
// missing role silently resolves to [] and wipes that role's existing links. A
// stale scalar key (e.g. legacy `audioInputId`) would be dropped by a non-strict
// object, leaving `audioInputIds` at its [] default → data loss on every edit.
// Rejecting unknown keys turns that class of client/contract drift into a loud error.
export const MediaBundleInput = z
  .object({
    characterImageIds: z.array(z.number()).default([]),
    sceneImageIds: z.array(z.number()).default([]),
    propImageIds: z.array(z.number()).default([]),
    audioInputIds: z.array(z.number()).default([]),
    videoInputIds: z.array(z.number()).default([]),
    videoOutputIds: z.array(z.number()).default([]),
  })
  .strict();

export type MediaBundleInputType = z.infer<typeof MediaBundleInput>;

// Media grouped by role for outbound BenchmarkItemOut
export const MediaByRole = z.object({
  character_image: z.array(MediaLinkOut).default([]),
  scene_image: z.array(MediaLinkOut).default([]),
  prop_image: z.array(MediaLinkOut).default([]),
  audio_input: z.array(MediaLinkOut).default([]),
  video_input: z.array(MediaLinkOut).default([]),
  video_output: z.array(MediaLinkOut).default([]),
});
export type MediaByRoleType = z.infer<typeof MediaByRole>;

export const BenchmarkItemOut = VideoBenchmarkItem.extend({
  media: MediaByRole,
  comments: z.array(BenchmarkComment),
});

export type BenchmarkItemOutType = z.infer<typeof BenchmarkItemOut>;

// Re-export for consumers that need the raw asset image out type
export { AssetImageOut };
