import { z } from 'zod';
import { CharacterDataSchema, PropDataSchema, SceneDataSchema } from './assets.js';

// ── AI router I/O (§2C aiRouter) ──────────────────────────────────────────────

export const GeneratePromptInput = z.object({
  kind: z.enum(['character', 'scene', 'prop']),
  data: z.record(z.unknown()),
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

export type GeneratePromptInputType = z.infer<typeof GeneratePromptInput>;
export type ExtractFieldsInputType = z.infer<typeof ExtractFieldsInput>;
export type ExtractFieldsResultType = z.infer<typeof ExtractFieldsResult>;
export type GenerateImageInputType = z.infer<typeof GenerateImageInput>;
