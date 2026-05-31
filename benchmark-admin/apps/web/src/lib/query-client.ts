import { MutationCache, type Query, QueryCache, QueryClient } from '@tanstack/react-query';
import { TRPCClientError } from '@trpc/client';
import { SESSION_QUERY_KEY } from './auth-client';

function isSafePath(path: string): boolean {
  return path.startsWith('/') && !path.startsWith('//') && path !== '/login';
}

function redirectToLogin() {
  if (typeof window === 'undefined') return;
  if (window.location.pathname === '/login') return;
  const currentPath = window.location.pathname + window.location.search;
  const search = isSafePath(currentPath) ? `?redirect=${encodeURIComponent(currentPath)}` : '';
  window.location.assign(`/login${search}`);
}

function isUnauthorized(err: unknown): boolean {
  if (err instanceof TRPCClientError) {
    const data = err.data as { httpStatus?: number; code?: string } | null | undefined;
    return data?.httpStatus === 401 || data?.code === 'UNAUTHORIZED';
  }
  if (err instanceof Error && /\b401\b/.test(err.message)) return true;
  return false;
}

export function createAppQueryClient(): QueryClient {
  const client: QueryClient = new QueryClient({
    queryCache: new QueryCache({
      onError(err: unknown, query: Query) {
        // The session probe itself returning 401 is the *normal* unauthenticated
        // state and is already handled by the auth guard; only redirect for
        // other queries that 401 (e.g. cookie expired mid-session).
        if (Array.isArray(query.queryKey) && query.queryKey[0] === SESSION_QUERY_KEY[0]) return;
        if (isUnauthorized(err)) {
          client.setQueryData(SESSION_QUERY_KEY, null);
          redirectToLogin();
        }
      },
    }),
    mutationCache: new MutationCache({
      onError(err: unknown) {
        if (isUnauthorized(err)) {
          client.setQueryData(SESSION_QUERY_KEY, null);
          redirectToLogin();
        }
      },
    }),
  });
  return client;
}
