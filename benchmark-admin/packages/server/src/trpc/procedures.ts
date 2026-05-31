import { TRPCError } from '@trpc/server';
import { t } from './init.js';

export const publicProcedure = t.procedure;

export const protectedProcedure = t.procedure.use(({ ctx, next, type }) => {
  if (!ctx.session) {
    throw new TRPCError({ code: 'UNAUTHORIZED' });
  }
  // CSRF defense-in-depth: SameSite=Strict + x-trpc-source header on mutations
  if (type === 'mutation') {
    const source = ctx.req.headers['x-trpc-source'];
    if (!source) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Missing x-trpc-source header' });
    }
  }
  return next({ ctx: { ...ctx, session: ctx.session } });
});
