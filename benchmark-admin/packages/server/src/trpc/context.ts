import type { CreateFastifyContextOptions } from '@trpc/server/adapters/fastify';

export type Context = CreateFastifyContextOptions & {
  session: { email: string } | null;
};

export function createContext(opts: CreateFastifyContextOptions): Context {
  // Session verification added in §3.2 (auth unit)
  return { ...opts, session: null };
}
