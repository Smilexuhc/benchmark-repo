import { z } from 'zod';
import { t } from '../trpc/init.js';
import { protectedProcedure } from '../trpc/procedures.js';

// Export covers the items matching the supplied filters (defaults to all
// non-deleted items when no filters are passed), so the ZIP reflects the slice
// the reviewer is viewing.
//
// kind 'benchmark' exports video benchmark items (manifest carries media-coverage
// + completeness columns). kind 'character'/'scene'/'prop' exports the asset
// library (manifest with embedded cover thumbnails + a 原图/ folder of originals).
const ASSET_FILTER_KEYS = [
  'era',
  'genre',
  'type',
  'gender',
  'age',
  'scene_type',
  'mood',
  'category',
] as const;

export const exportsRouter = t.router({
  getDownloadUrl: protectedProcedure
    .input(
      z.object({
        kind: z.enum(['benchmark', 'character', 'scene', 'prop']),
        search: z.string().optional(),
        deletedOnly: z.boolean().optional(),
        // benchmark-only filters
        shotType: z.string().optional(),
        questionType: z.string().optional(),
        categoryL1: z.string().optional(),
        categoryL2: z.string().optional(),
        categoryL3: z.string().optional(),
        needsRevision: z.boolean().optional(),
        // asset-only filters (multi-select arrays)
        filters: z.record(z.string(), z.array(z.string())).optional(),
      }),
    )
    .query(({ input }) => {
      const params = new URLSearchParams();
      if (input.search?.trim()) params.set('search', input.search.trim());
      if (input.deletedOnly) params.set('deletedOnly', 'true');

      if (input.kind === 'benchmark') {
        if (input.shotType) params.set('shotType', input.shotType);
        if (input.questionType) params.set('questionType', input.questionType);
        if (input.categoryL1) params.set('categoryL1', input.categoryL1);
        if (input.categoryL2) params.set('categoryL2', input.categoryL2);
        if (input.categoryL3) params.set('categoryL3', input.categoryL3);
        if (input.needsRevision) params.set('needsRevision', 'true');
      } else {
        for (const key of ASSET_FILTER_KEYS) {
          for (const v of input.filters?.[key] ?? []) params.append(key, v);
        }
      }

      const qs = params.toString();
      return { url: `/api/export/${input.kind}.zip${qs ? `?${qs}` : ''}` };
    }),
});
