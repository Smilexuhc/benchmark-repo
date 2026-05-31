import { z } from 'zod';
import { t } from '../trpc/init.js';
import { protectedProcedure } from '../trpc/procedures.js';

// Export covers the items matching the supplied filters (defaults to all
// non-deleted items when no filters are passed), so the ZIP reflects the slice
// the reviewer is viewing. The manifest carries media-coverage + completeness
// columns so incomplete items are visible rather than silently included.
export const exportsRouter = t.router({
  getDownloadUrl: protectedProcedure
    .input(
      z.object({
        kind: z.enum(['benchmark']),
        search: z.string().optional(),
        shotType: z.string().optional(),
        questionType: z.string().optional(),
        needsRevision: z.boolean().optional(),
        deletedOnly: z.boolean().optional(),
      }),
    )
    .query(({ input }) => {
      const params = new URLSearchParams();
      if (input.search?.trim()) params.set('search', input.search.trim());
      if (input.shotType) params.set('shotType', input.shotType);
      if (input.questionType) params.set('questionType', input.questionType);
      if (input.needsRevision) params.set('needsRevision', 'true');
      if (input.deletedOnly) params.set('deletedOnly', 'true');
      const qs = params.toString();
      return { url: `/api/export/${input.kind}.zip${qs ? `?${qs}` : ''}` };
    }),
});
