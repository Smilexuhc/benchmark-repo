import type { CreateFastifyContextOptions } from '@trpc/server/adapters/fastify';
import { COOKIE_NAME, readSessionFromToken } from '../auth/index.js';

export type Context = CreateFastifyContextOptions & {
  session: { email: string } | null;
};

export function createContext(opts: CreateFastifyContextOptions): Context {
  // @fastify/cookie augments request.cookies at runtime; cast to access it
  const cookies = (
    opts.req as { cookies?: Record<string, string | undefined> }
  ).cookies;
  const token = cookies?.[COOKIE_NAME];
  const session = token ? readSessionFromToken(token) : null;
  return { ...opts, session };
}
