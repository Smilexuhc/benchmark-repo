import { z } from 'zod';
import { t } from '../trpc/init.js';
import { protectedProcedure } from '../trpc/procedures.js';

export const exportsRouter = t.router({
  getDownloadUrl: protectedProcedure
    .input(
      z.object({
        kind: z.enum(['benchmark']),
        filters: z.record(z.unknown()).optional(),
        search: z.string().optional(),
      }),
    )
    .query(({ input }) => {
      return { url: `/api/export/${input.kind}.zip` };
    }),
});
