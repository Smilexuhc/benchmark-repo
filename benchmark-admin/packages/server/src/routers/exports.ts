import { z } from 'zod';
import { t } from '../trpc/init.js';
import { protectedProcedure } from '../trpc/procedures.js';

// Contract: exports always cover all non-deleted items.
// Client-side filtering before export is a UI concern; the ZIP contains the full dataset.
export const exportsRouter = t.router({
  getDownloadUrl: protectedProcedure
    .input(z.object({ kind: z.enum(['benchmark']) }))
    .query(({ input }) => {
      return { url: `/api/export/${input.kind}.zip` };
    }),
});
