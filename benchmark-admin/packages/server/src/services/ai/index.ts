import pLimit from 'p-limit';
import { env } from '@benchmark-admin/shared/env';
import {
  buildCharacterUserMessage,
  selectCharacterSystem,
} from '@benchmark-admin/shared/lib/prompts/character';
import {
  buildExtractUserMessage,
  buildPropExtractUserMessage,
  buildSceneExtractUserMessage,
  EXTRACT_SYSTEM,
  PROP_EXTRACT_SYSTEM,
  SCENE_EXTRACT_SYSTEM,
} from '@benchmark-admin/shared/lib/prompts/extract-fields';
import { buildPropUserMessage, PROP_PROMPT_SYSTEM } from '@benchmark-admin/shared/lib/prompts/prop';
import { buildSceneUserMessage, SCENE_PROMPT_SYSTEM } from '@benchmark-admin/shared/lib/prompts/scene';
import type { CharacterData, PropData, SceneData } from '@benchmark-admin/shared/schemas/assets';
import {
  CharacterDataSchema,
  PropDataSchema,
  SceneDataSchema,
} from '@benchmark-admin/shared/schemas/assets';
import * as storage from '../storage/index.js';
import { AiError, openai, parseJson, translateError } from './openrouter.js';

export { AiError };

const imageLimit = pLimit(env.AI_MAX_CONCURRENCY);

// ── Text helper ───────────────────────────────────────────────────────────────

async function callText(system: string, userMsg: string): Promise<string> {
  try {
    const resp = await openai.chat.completions.create({
      model: env.TEXT_MODEL,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: userMsg },
      ],
      temperature: 0.7,
    });
    return (resp.choices[0]?.message.content ?? '').trim();
  } catch (e) {
    throw translateError(e);
  }
}

// ── generatePrompt ─────────────────────────────────────────────────────────────
// Generates an English AI image prompt from structured asset data.

export async function generatePrompt(
  kind: 'character' | 'scene' | 'prop',
  data: Record<string, unknown>,
  description?: string,
): Promise<string> {
  switch (kind) {
    case 'character': {
      const system = selectCharacterSystem(String(data.type ?? ''));
      const userMsg = buildCharacterUserMessage(data, description);
      return callText(system, userMsg);
    }
    case 'scene': {
      const userMsg = buildSceneUserMessage(data, description);
      return callText(SCENE_PROMPT_SYSTEM, userMsg);
    }
    case 'prop': {
      const userMsg = buildPropUserMessage(data, description);
      return callText(PROP_PROMPT_SYSTEM, userMsg);
    }
  }
}

// ── generateImage ─────────────────────────────────────────────────────────────
// Generates an image via OpenRouter, uploads to TOS, returns the object key.
// Pass refImageBytes for image-to-image (single ref for scene reverse/multiview,
// multiple refs for the standalone playground). `model` overrides env.IMAGE_MODEL
// when supplied; the contract-edge whitelist lives in the router (zod enum), not
// here — this service is a pass-through.

type ImageContent =
  | string
  | Array<
      | { type: 'text'; text: string }
      | { type: 'image_url'; image_url: { url: string } }
    >;

type ImageApiParams = {
  model: string;
  messages: Array<{ role: 'user'; content: ImageContent }>;
  extra_body: {
    modalities: ['image', 'text'];
    image_config: { aspect_ratio: string; image_size: string };
  };
};

type ImageApiResponse = {
  choices: Array<{
    message: {
      images?: Array<{ image_url?: { url?: string } }>;
    };
  }>;
};

export function generateImage(
  prompt: string,
  refImageBytes?: Buffer[],
  aspectRatio?: string,
  model?: string,
): Promise<{ objectKey: string }> {
  return imageLimit(() => _generateImage(prompt, refImageBytes, aspectRatio, model));
}

async function _generateImage(
  prompt: string,
  refImageBytes?: Buffer[],
  aspectRatio?: string,
  model?: string,
): Promise<{ objectKey: string }> {
  if (!prompt.trim()) throw new Error('提示词为空，无法生成图片');

  const aspect = (aspectRatio ?? env.IMAGE_ASPECT_RATIO).trim();
  const size = env.IMAGE_SIZE.trim();

  let content: ImageContent;
  if (refImageBytes && refImageBytes.length > 0) {
    content = [
      { type: 'text', text: prompt },
      ...refImageBytes.map((b) => ({
        type: 'image_url' as const,
        image_url: { url: `data:image/png;base64,${b.toString('base64')}` },
      })),
    ];
  } else {
    content = prompt;
  }

  const params: ImageApiParams = {
    model: model ?? env.IMAGE_MODEL,
    messages: [{ role: 'user', content }],
    extra_body: {
      modalities: ['image', 'text'],
      image_config: { aspect_ratio: aspect, image_size: size },
    },
  };

  let resp: ImageApiResponse;
  try {
    resp = (await (
      openai.chat.completions.create as unknown as (p: unknown) => Promise<unknown>
    )(params)) as ImageApiResponse;
  } catch (e) {
    throw translateError(e);
  }

  const images = resp.choices[0]?.message?.images ?? [];
  const url = images[0]?.image_url?.url ?? '';
  if (!url) throw new AiError('AI_NO_IMAGE', '图片接口未返回图像数据');

  let bytes: Buffer;
  if (url.startsWith('data:')) {
    const b64part = url.split(',')[1] ?? '';
    bytes = Buffer.from(b64part, 'base64');
  } else if (url.startsWith('http')) {
    const res = await fetch(url, { signal: AbortSignal.timeout(120_000) });
    // Node.js fetch Response has arrayBuffer() but TypeScript lib requires DOM for the type
    const r = res as unknown as { arrayBuffer: () => Promise<ArrayBuffer> };
    bytes = Buffer.from(await r.arrayBuffer());
  } else {
    throw new AiError('AI_NO_IMAGE', '图片接口返回的数据无法解析');
  }

  const objectKey = storage.newObjectKey('.png', 'images');
  await storage.putObject(objectKey, bytes, 'image/png');
  return { objectKey };
}

// ── extractFields ──────────────────────────────────────────────────────────────
// Extracts structured fields from a free-text description, validates with Zod.

export async function extractFields(
  kind: 'character' | 'scene' | 'prop',
  description: string,
  options?: Record<string, string[]>,
): Promise<CharacterData | SceneData | PropData> {
  let system: string;
  let userMsg: string;

  switch (kind) {
    case 'character': {
      system = EXTRACT_SYSTEM;
      userMsg = buildExtractUserMessage(description, options);
      break;
    }
    case 'scene': {
      system = SCENE_EXTRACT_SYSTEM;
      userMsg = buildSceneExtractUserMessage(description, options);
      break;
    }
    case 'prop': {
      system = PROP_EXTRACT_SYSTEM;
      userMsg = buildPropExtractUserMessage(description, options);
      break;
    }
  }

  let raw: string;
  try {
    const resp = await openai.chat.completions.create({
      model: env.TEXT_MODEL,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: userMsg },
      ],
      temperature: 0.2,
    });
    raw = resp.choices[0]?.message.content ?? '';
  } catch (e) {
    throw translateError(e);
  }

  const parsed = parseJson(raw);

  // Validate against the kind-specific Zod schema
  switch (kind) {
    case 'character':
      return CharacterDataSchema.parse(parsed);
    case 'scene':
      return SceneDataSchema.parse(parsed);
    case 'prop':
      return PropDataSchema.parse(parsed);
  }
}
