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
    .input(z.object({ ids: z.array(z.number().int().positive()) }))
    .subscription(async function* ({ input }) {
      for (const id of input.ids) {
        yield { id, status: 'pending' as const };

        try {
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

          // DB write BEFORE yield — a dropped connection means re-subscribe for unfinished ids
          await db
            .insert(assetImages)
            .values({ assetId: id, objectKey, source: 'generated', mediaType: 'image' });

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
