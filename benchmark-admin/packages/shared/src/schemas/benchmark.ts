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
export const MediaLinkOut = MediaLink.extend({ url: z.string().url() });
export type MediaLinkOutType = z.infer<typeof MediaLinkOut>;

export const BenchmarkComment = createSelectSchema(benchmarkItemComments);
export type BenchmarkCommentType = z.infer<typeof BenchmarkComment>;

// MediaBundleInput — the RF-2 cardinality enforcement point.
// Single-cardinality roles (audioInputId, videoInputId, videoOutputId) accept at most one id.
// The service explodes this into video_benchmark_media_links rows.
export const MediaBundleInput = z.object({
  characterImageIds: z.array(z.number()).default([]),
  sceneImageIds: z.array(z.number()).default([]),
  propImageIds: z.array(z.number()).default([]),
  audioInputId: z.number().nullable().default(null),
  videoInputId: z.number().nullable().default(null),
  videoOutputId: z.number().nullable().default(null),
});

export type MediaBundleInputType = z.infer<typeof MediaBundleInput>;

// Media grouped by role for outbound BenchmarkItemOut
const MediaByRole = z.object({
  character_image: z.array(MediaLinkOut).default([]),
  scene_image: z.array(MediaLinkOut).default([]),
  prop_image: z.array(MediaLinkOut).default([]),
  audio_input: MediaLinkOut.nullable().default(null),
  video_input: MediaLinkOut.nullable().default(null),
  video_output: MediaLinkOut.nullable().default(null),
});

export const BenchmarkItemOut = VideoBenchmarkItem.extend({
  media: MediaByRole,
  comments: z.array(BenchmarkComment),
});

export type BenchmarkItemOutType = z.infer<typeof BenchmarkItemOut>;

// Re-export for consumers that need the raw asset image out type
export { AssetImageOut };
