import type { AppRouter } from '@benchmark-admin/server';
import {
  createTRPCClient,
  httpBatchLink,
  httpSubscriptionLink,
  splitLink,
} from '@trpc/client';
import type { inferRouterInputs, inferRouterOutputs } from '@trpc/server';
import { createTRPCReact } from '@trpc/react-query';
import superjson from 'superjson';

// @trpc/react-query@11.17's exported `CreateTRPCReact<AppRouter, unknown>` type
// resolves to `any`/`never` for this AppRouter (the ProtectedIntersection branch
// degrades on cross-module re-evaluation). The runtime proxy is correct, so we
// expose `trpc` as `any` and use `RouterInputs`/`RouterOutputs` below for typed
// accessors at call sites.
// biome-ignore lint/suspicious/noExplicitAny: deliberate type workaround for tRPC v11.17 inference bug
export const trpc: any = createTRPCReact<AppRouter>();

export type RouterInputs = inferRouterInputs<AppRouter>;
export type RouterOutputs = inferRouterOutputs<AppRouter>;

// x-trpc-source is required by protectedProcedure for CSRF defense-in-depth on mutations.
const headers = () => ({ 'x-trpc-source': 'web' });

// `credentials: 'include'` is required for the cross-origin China-host deploy
// posture (U21) — without it the session cookie isn't sent to the API origin.
// Harmless on same-origin dev. The cast is needed because tRPC's `FetchEsque`
// types `signal?: AbortSignal | undefined` while the global `RequestInit`
// types it as `AbortSignal | null`, which collides under
// `exactOptionalPropertyTypes`.
// biome-ignore lint/suspicious/noExplicitAny: tRPC FetchEsque vs global RequestInit
const fetchWithCreds: any = (input: RequestInfo | URL, init?: RequestInit) =>
  fetch(input, { ...init, credentials: 'include' });

const reactLink = httpBatchLink({
  url: '/api/trpc',
  transformer: superjson,
  headers,
  fetch: fetchWithCreds,
});

// Vanilla client used outside React (Zustand actions). splitLink routes
// subscriptions to httpSubscriptionLink (SSE) and everything else to the batch link.
const vanillaLinks = [
  splitLink({
    condition: (op) => op.type === 'subscription',
    true: httpSubscriptionLink({
      url: '/api/trpc',
      transformer: superjson,
      eventSourceOptions: { withCredentials: true },
    }),
    false: httpBatchLink({
      url: '/api/trpc',
      transformer: superjson,
      headers,
      fetch: fetchWithCreds,
    }),
  }),
];

export const trpcClient = createTRPCClient<AppRouter>({ links: vanillaLinks });

// React-tree (hook-based) client. Used by trpc.useQuery / useMutation hooks.
export const trpcReactClient = trpc.createClient({ links: [reactLink] });
