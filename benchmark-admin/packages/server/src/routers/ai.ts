import { TRPCError } from '@trpc/server';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { assetImages, assets } from '@benchmark-admin/shared/db/schema';
import {
  ExtractFieldsInput,
  GenerateImageInput,
  GeneratePromptInput,
} from '@benchmark-admin/shared/schemas/prompts';
import type { CharacterData, PropData, SceneData } from '@benchmark-admin/shared/schemas/assets';
import { db } from '../db/index.js';
import * as ai from '../services/ai/index.js';
import * as storage from '../services/storage/index.js';
import { t } from '../trpc/init.js';
import { protectedProcedure } from '../trpc/procedures.js';

export const aiRouter = t.router({
  generatePrompt: protectedProcedure
    .input(GeneratePromptInput)
    .mutation(async ({ input }) => {
      const prompt = await ai.generatePrompt(input.kind, input.data);
      return { prompt };
    }),

  extractFields: protectedProcedure
    .input(ExtractFieldsInput)
    .mutation(async ({ input }) => {
      const data = await ai.extractFields(input.kind, input.description, input.options);
      if (input.kind === 'character') return { kind: 'character' as const, data: data as CharacterData };
      if (input.kind === 'scene') return { kind: 'scene' as const, data: data as SceneData };
      return { kind: 'prop' as const, data: data as PropData };
    }),

  generateImage: protectedProcedure
    .input(GenerateImageInput)
    .mutation(async ({ input }) => {
      const [asset] = await db
        .select({ id: assets.id })
        .from(assets)
        .where(eq(assets.id, input.id))
        .limit(1);
      if (!asset) throw new TRPCError({ code: 'NOT_FOUND' });

      let refBytes: Buffer | undefined;
      if (input.refImage !== undefined) {
        const [refImg] = await db
          .select({ objectKey: assetImages.objectKey })
          .from(assetImages)
          .where(eq(assetImages.id, input.refImage))
          .limit(1);
        if (refImg) {
          refBytes = await storage.getBytes(refImg.objectKey);
        }
      }

      const { objectKey } = await ai.generateImage(input.prompt, refBytes, input.aspectRatio);

      let img: typeof assetImages.$inferSelect | undefined;
      try {
        const rows = await db
          .insert(assetImages)
          .values({ assetId: input.id, objectKey, source: 'generated', mediaType: 'image' })
          .returning();
        img = rows[0];
      } catch (err) {
        // DB insert failed — best-effort clean up the already-uploaded TOS object
        storage.deleteObject(objectKey).catch(() => {});
        throw err;
      }
      if (!img) {
        storage.deleteObject(objectKey).catch(() => {});
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });
      }

      const url = await storage.getPresignedUrl(objectKey);
      return { ...img, url };
    }),

  batchRegenerate: protectedProcedure
    .input(
      z.object({
        ids: z.array(z.number().int().positive()),
        // Per-run idempotency key generated client-side; sent on every (re)subscribe
        // for a single run so the server can skip ids it already completed in this
        // batch on reconnect (P0-2 contract — see JUJ-22).
        batchKey: z.string().min(1),
      }),
    )
    .subscription(async function* ({ input }) {
      for (const id of input.ids) {
        yield { id, status: 'pending' as const };

        try {
          // Idempotency: if the (batchKey, id) pair has already completed in
          // this run, replay the cached done event without calling the AI or
          // inserting another row. Stops duplicate media + paid OpenRouter
          // calls when an SSE connection drops between insert and yield.
          const cached = getCompleted(input.batchKey, id);
          if (cached) {
            yield { id, status: 'done' as const, imageKey: cached };
            continue;
          }

          const [asset] = await db
            .select({ id: assets.id, kind: assets.kind, data: assets.data })
            .from(assets)
            .where(eq(assets.id, id))
            .limit(1);

          if (!asset) {
            yield { id, status: 'failed' as const, error: 'Asset not found' };
            continue;
          }

          const prompt = await ai.generatePrompt(
            asset.kind as 'character' | 'scene' | 'prop',
            asset.data as Record<string, unknown>,
          );

          const { objectKey } = await ai.generateImage(prompt);

          // DB write BEFORE yield — at-least-once: a dropped connection after
          // insert is recovered by the resubscribe + dedup path above.
          await db
            .insert(assetImages)
            .values({ assetId: id, objectKey, source: 'generated', mediaType: 'image' });

          // Record completion AFTER the insert so a crash between the two
          // doesn't lock in a key that isn't backed by a row.
          recordCompleted(input.batchKey, id, objectKey);

          yield { id, status: 'done' as const, imageKey: objectKey };
        } catch (err) {
          yield {
            id,
            status: 'failed' as const,
            error: err instanceof Error ? err.message : String(err),
          };
        }
      }
    }),
});

// ── batchKey → (id → objectKey) idempotency cache ─────────────────────────────
//
// Single-instance, in-memory. Single-admin deploy posture means at most one
// pod handles a given batch run; an eventual multi-instance deploy would need
// shared state (Postgres table). TTL prevents unbounded growth.

const COMPLETION_TTL_MS = 30 * 60_000;
type CompletionEntry = { results: Map<number, string>; expiresAt: number };
const batchCompletions = new Map<string, CompletionEntry>();

function purgeExpired(now: number): void {
  for (const [key, entry] of batchCompletions) {
    if (entry.expiresAt <= now) batchCompletions.delete(key);
  }
}

function getCompleted(batchKey: string, id: number): string | undefined {
  const now = Date.now();
  purgeExpired(now);
  const entry = batchCompletions.get(batchKey);
  if (!entry) return undefined;
  return entry.results.get(id);
}

function recordCompleted(batchKey: string, id: number, objectKey: string): void {
  const now = Date.now();
  purgeExpired(now);
  let entry = batchCompletions.get(batchKey);
  if (!entry) {
    entry = { results: new Map(), expiresAt: now + COMPLETION_TTL_MS };
    batchCompletions.set(batchKey, entry);
  }
  entry.results.set(id, objectKey);
  entry.expiresAt = now + COMPLETION_TTL_MS;
}

// Exposed for tests so they can simulate a fresh process between runs.
export function __resetBatchCompletionsForTests(): void {
  batchCompletions.clear();
}
