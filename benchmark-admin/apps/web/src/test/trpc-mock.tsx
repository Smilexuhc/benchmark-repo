/**
 * Lightweight tRPC mock for component tests.
 *
 * The web client wraps `createTRPCReact<AppRouter>()` and casts the result to
 * `any` (see lib/trpc.ts) because of a tRPC v11.17 inference bug. That same
 * any-typing lets us replace the export wholesale for tests — we don't have to
 * stand up a real TRPCProvider or fake fetcher; we just intercept the hook
 * call sites the component uses.
 *
 * Usage:
 *   vi.mock('@/lib/trpc', () => createTrpcMock({ ... }))
 */
import { useEffect, useState } from 'react';
import { vi } from 'vitest';

type Handlers = {
  // Map dot-separated procedure path → handler that returns the query result.
  // e.g. { 'assets.list': (input) => ({ items: [...], nextCursor: null }) }
  query?: Record<string, (input: unknown) => unknown>;
  infiniteQuery?: Record<
    string,
    (input: unknown, cursor: unknown) => { items: unknown[]; nextCursor: unknown }
  >;
  mutation?: Record<string, (input: unknown) => Promise<unknown> | unknown>;
};

type TrpcLikeNode = {
  useQuery: (input: unknown, opts?: { enabled?: boolean }) => unknown;
  useInfiniteQuery: (input: unknown, opts?: unknown) => unknown;
  useMutation: (opts?: {
    onMutate?: (input: unknown) => unknown;
    onError?: (err: unknown, input: unknown, ctx: unknown) => void;
    onSettled?: () => void;
  }) => unknown;
  cancel?: (input: unknown) => Promise<void>;
  getData?: (input: unknown) => unknown;
  setData?: (input: unknown, updater: unknown) => void;
  invalidate?: (input?: unknown) => Promise<void>;
};

export function createTrpcMock(handlers: Handlers) {
  // Per-procedure call state lives on the proxy so tests can inspect later.
  const procedureState = new Map<string, { lastQueryInput?: unknown }>();
  const utilsCache = new Map<string, unknown>();
  // Subscribers re-render mounted query consumers when setData fires.
  const subscribers = new Map<string, Set<() => void>>();

  function notify(path: string) {
    const set = subscribers.get(path);
    if (!set) return;
    for (const cb of set) cb();
  }

  function proxyForPath(path: string): TrpcLikeNode {
    return {
      useQuery(input: unknown) {
        const state = procedureState.get(path) ?? {};
        state.lastQueryInput = input;
        procedureState.set(path, state);
        const fn = handlers.query?.[path];

        // Re-render on setData/invalidate writes for this path.
        const [, force] = useState(0);
        // biome-ignore lint/correctness/useExhaustiveDependencies: path is per-hook stable
        useEffect(() => {
          const cb = () => force((n) => n + 1);
          let set = subscribers.get(path);
          if (!set) {
            set = new Set();
            subscribers.set(path, set);
          }
          set.add(cb);
          return () => {
            set?.delete(cb);
          };
        }, []);

        // Cached overlay (set by mutation onMutate/onError) takes precedence
        // so optimistic updates and rollbacks are visible to consumers.
        const cached = utilsCache.get(path);
        const data = cached !== undefined ? cached : fn ? fn(input) : undefined;
        return {
          data,
          isPending: data === undefined,
          isError: false,
          error: null,
          isFetching: false,
        };
      },
      useInfiniteQuery(input: unknown) {
        const fn = handlers.infiniteQuery?.[path];
        // Local React state so calling `fetchNextPage` actually re-renders the
        // consuming component (real useInfiniteQuery updates state internally).
        const [pages, setPages] = useState<{ items: unknown[]; nextCursor: unknown }[]>(() =>
          fn ? [fn(input, undefined)] : [],
        );
        if (!fn) {
          return { data: { pages: [] }, isPending: false, hasNextPage: false };
        }
        const last = pages[pages.length - 1];
        return {
          data: { pages },
          hasNextPage: last?.nextCursor != null,
          isFetchingNextPage: false,
          isPending: false,
          isError: false,
          error: null,
          isFetching: false,
          async fetchNextPage() {
            setPages((prev) => {
              const lastCursor = prev[prev.length - 1]?.nextCursor;
              return [...prev, fn(input, lastCursor)];
            });
          },
        };
      },
      useMutation(opts) {
        const fn = handlers.mutation?.[path];
        const mutateAsync = async (input: unknown) => {
          let ctx: unknown;
          try {
            ctx = await opts?.onMutate?.(input);
            const out = fn ? await fn(input) : undefined;
            opts?.onSettled?.();
            return out;
          } catch (err) {
            opts?.onError?.(err, input, ctx);
            opts?.onSettled?.();
            throw err;
          }
        };
        return {
          mutateAsync,
          mutate(input: unknown) {
            void mutateAsync(input);
          },
          isPending: false,
          variables: undefined as unknown,
        };
      },
      async cancel() {},
      getData: () => utilsCache.get(path),
      setData(_input: unknown, updater: unknown) {
        const prev = utilsCache.get(path);
        const next =
          typeof updater === 'function' ? (updater as (p: unknown) => unknown)(prev) : updater;
        utilsCache.set(path, next);
        notify(path);
      },
      async invalidate() {
        utilsCache.delete(path);
        notify(path);
      },
    };
  }

  function makeProxy(prefix: string[] = []): unknown {
    return new Proxy(
      {},
      {
        get(_target, prop) {
          if (typeof prop !== 'string') return undefined;
          // Top-level helper exposed by the real createTRPCReact result.
          if (prop === 'useUtils' && prefix.length === 0) {
            return () => makeProxy();
          }
          if (
            prop === 'useQuery' ||
            prop === 'useInfiniteQuery' ||
            prop === 'useMutation' ||
            prop === 'cancel' ||
            prop === 'getData' ||
            prop === 'setData' ||
            prop === 'invalidate'
          ) {
            const path = prefix.join('.');
            return (proxyForPath(path) as unknown as Record<string, unknown>)[prop];
          }
          return makeProxy([...prefix, prop]);
        },
      },
    );
  }

  const trpc = makeProxy() as unknown as {
    // biome-ignore lint/suspicious/noExplicitAny: matches the runtime proxy type
    [key: string]: any;
    useUtils: () => unknown;
  };

  return {
    // biome-ignore lint/suspicious/noExplicitAny: matches runtime any-cast
    trpc: trpc as any,
    trpcClient: {} as Record<string, unknown>,
    trpcReactClient: {} as Record<string, unknown>,
    state: procedureState,
  };
}

// Convenience: a stub component-level provider isn't needed because the
// `trpc` export here is the raw proxy, not the real CreateTRPCReact instance.
export { vi as _vi };
