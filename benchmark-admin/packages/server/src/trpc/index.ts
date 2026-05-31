import { t } from './init.js';
import { publicProcedure } from './procedures.js';

export const appRouter = t.router({
  health: publicProcedure.query(() => ({
    ok: true as const,
    ts: new Date(),
  })),
});

export type AppRouter = typeof appRouter;
