import { z } from 'zod';
import { CharacterDataSchema, PropDataSchema, SceneDataSchema } from './assets.js';

// ── AI router I/O (§2C aiRouter) ──────────────────────────────────────────────

// `description` is the user's free-text "自由描述" field. When non-empty the
// builders bypass the structured `data` path entirely and feed the description
// straight to the model — without this field the user's intent (e.g. "现代公寓
// 的厨房") never reached the AI and the model hallucinated unrelated scenes.
export const GeneratePromptInput = z.object({
  kind: z.enum(['character', 'scene', 'prop']),
  data: z.record(z.unknown()),
  description: z.string().optional(),
});

export const GeneratePromptResult = z.object({
  prompt: z.string(),
});

// options carries per-field candidate value-lists fed to the extract prompt
// so the model picks from a closed set (mirrors backend/ai.py extract behavior)
export const ExtractFieldsInput = z.object({
  kind: z.enum(['character', 'scene', 'prop']),
  description: z.string(),
  options: z.record(z.array(z.string())).optional(),
});

export const ExtractFieldsResult = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('character'), data: CharacterDataSchema }),
  z.object({ kind: z.literal('scene'), data: SceneDataSchema }),
  z.object({ kind: z.literal('prop'), data: PropDataSchema }),
]);

export const GenerateImageInput = z.object({
  kind: z.enum(['character', 'scene', 'prop']),
  id: z.number(),
  prompt: z.string(),
  refImage: z.number().optional(),
  aspectRatio: z.string().optional(),
});

// Standalone playground generation: not bound to a character/scene/prop
// asset. aspectRatio and model are closed enums — the contract-edge whitelist
// for v1 is single-model. refImages references existing media rows (uploaded
// via mediaAssets.createStandalone) and is capped to keep the OpenRouter
// content array bounded.
export const GenerateStandaloneImageInput = z.object({
  prompt: z.string().min(1),
  aspectRatio: z.enum(['16:9', '1:1', '3:2', '2:3', '9:16']).default('16:9'),
  model: z.enum(['gpt-image-2']).default('gpt-image-2'),
  refImages: z.array(z.number().int().positive()).max(4).optional(),
});

export type GeneratePromptInputType = z.infer<typeof GeneratePromptInput>;
export type ExtractFieldsInputType = z.infer<typeof ExtractFieldsInput>;
export type ExtractFieldsResultType = z.infer<typeof ExtractFieldsResult>;
export type GenerateImageInputType = z.infer<typeof GenerateImageInput>;
export type GenerateStandaloneImageInputType = z.infer<typeof GenerateStandaloneImageInput>;
