import { assetImages, assets } from '@benchmark-admin/shared/db/schema';
import { TRPCError } from '@trpc/server';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db/index.js';
import * as ai from '../services/ai/index.js';
import * as storage from '../services/storage/index.js';
import { t } from '../trpc/init.js';
import { protectedProcedure } from '../trpc/procedures.js';

export const scenesRouter = t.router({
  generateView: protectedProcedure
    .input(
      z.object({
        id: z.number().int().positive(),
        mode: z.enum(['reverse', 'multiview']),
      }),
    )
    .mutation(async ({ input }) => {
      const [scene] = await db
        .select()
        .from(assets)
        .where(and(eq(assets.id, input.id), eq(assets.kind, 'scene')))
        .limit(1);

      if (!scene) throw new TRPCError({ code: 'NOT_FOUND' });

      if (!scene.coverImageId) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Set a cover image first.',
        });
      }

      const [coverImg] = await db
        .select()
        .from(assetImages)
        .where(eq(assetImages.id, scene.coverImageId))
        .limit(1);

      if (!coverImg) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Set a cover image first.' });
      }

      const coverBytes = await storage.getBytes(coverImg.objectKey);

      const prompt =
        input.mode === 'reverse'
          ? 'Generate a reverse shot of this scene from the opposite perspective.'
          : 'Generate a 4-view multiview composition showing multiple angles of this scene.';

      const { objectKey } = await ai.generateImage(prompt, coverBytes);

      // The image is already in TOS; if the link insert fails, clean up the
      // orphaned object rather than leaving it stranded in the bucket.
      let img: typeof assetImages.$inferSelect | undefined;
      try {
        [img] = await db
          .insert(assetImages)
          .values({
            assetId: input.id,
            objectKey,
            source: input.mode,
            mediaType: 'image',
          })
          .returning();
      } catch (err) {
        storage.deleteObject(objectKey).catch(() => {});
        throw err;
      }

      if (!img) {
        storage.deleteObject(objectKey).catch(() => {});
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });
      }

      const url = await storage.getPresignedUrl(img.objectKey).catch(() => '');
      return { ...img, url };
    }),
});
