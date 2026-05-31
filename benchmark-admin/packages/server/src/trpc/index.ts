import { assetsRouter } from '../routers/assets.js';
import { benchmarkRouter } from '../routers/benchmark.js';
import { scenesRouter } from '../routers/scenes.js';
import { t } from './init.js';
import { publicProcedure } from './procedures.js';

export const appRouter = t.router({
  health: publicProcedure.query(() => ({
    ok: true as const,
    ts: new Date(),
  })),
  assets: assetsRouter,
  scenes: scenesRouter,
  benchmark: benchmarkRouter,
});

export type AppRouter = typeof appRouter;
