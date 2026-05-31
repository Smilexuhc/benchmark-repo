import type { AppRouter } from '@benchmark-admin/server';
import type {
  InfiniteData,
  UseInfiniteQueryResult,
  UseMutationResult,
  UseQueryResult,
} from '@tanstack/react-query';
import {
  createTRPCClient,
  httpBatchLink,
  httpSubscriptionLink,
  splitLink,
  type TRPCClientErrorLike,
} from '@trpc/client';
import type { inferRouterInputs, inferRouterOutputs } from '@trpc/server';
import type {
  AnyMutationProcedure,
  AnyProcedure,
  AnyQueryProcedure,
  RouterRecord,
  inferProcedureInput,
  inferProcedureOutput,
} from '@trpc/server/unstable-core-do-not-import';
import { createTRPCReact } from '@trpc/react-query';
import superjson from 'superjson';

export type RouterInputs = inferRouterInputs<AppRouter>;
export type RouterOutputs = inferRouterOutputs<AppRouter>;

// ── Typed React facade ────────────────────────────────────────────────────────
//
// `createTRPCReact<AppRouter>()` returns a hooks proxy whose option-arg types
// reject standard TanStack Query keys (`enabled`, `getNextPageParam`,
// `onMutate`, ...) under this project's strict TS settings
// (`exactOptionalPropertyTypes` + `moduleResolution: bundler`). The
// `Omit<TOptions, …>` chains in `makeInfiniteQueryOptions` /
// `UseTRPCMutationOptions` lose properties across module boundaries with
// @trpc/react-query@11.17 + @tanstack/react-query@5.100. Bumping to the latest
// stable (11.17, the current install) does not fix it.
//
// The runtime proxy is correct — it walks property accesses to build query
// keys. We expose it via a hand-rolled type derived from the actual router
// record so call sites keep **input** and **output** typing on every procedure
// hook, only loosening **opts** to `any`. Loss of opts typing is contained to
// this file instead of being a project-wide `any`.

type TRPCError = TRPCClientErrorLike<AppRouter>;

// biome-ignore lint/suspicious/noExplicitAny: opts surface is the bug; see header
type Opts = any;

// Queries that can plausibly be infinite take a `cursor` in their input.
type HasCursor<T> = T extends { cursor?: unknown } ? true : false;

type QueryHooks<TProcedure extends AnyQueryProcedure> = {
  useQuery: <TData = inferProcedureOutput<TProcedure>>(
    input: inferProcedureInput<TProcedure>,
    opts?: Opts,
  ) => UseQueryResult<TData, TRPCError>;
} & (HasCursor<inferProcedureInput<TProcedure>> extends true
  ? {
      useInfiniteQuery: <TData = InfiniteData<inferProcedureOutput<TProcedure>>>(
        input: Omit<inferProcedureInput<TProcedure>, 'cursor'>,
        opts?: Opts,
      ) => UseInfiniteQueryResult<TData, TRPCError>;
    }
  : object);

type MutationHooks<TProcedure extends AnyMutationProcedure> = {
  useMutation: <TContext = unknown>(
    opts?: Opts,
  ) => UseMutationResult<
    inferProcedureOutput<TProcedure>,
    TRPCError,
    inferProcedureInput<TProcedure>,
    TContext
  >;
};

type ProcedureHooks<TProcedure extends AnyProcedure> = TProcedure extends AnyQueryProcedure
  ? QueryHooks<TProcedure>
  : TProcedure extends AnyMutationProcedure
    ? MutationHooks<TProcedure>
    : never;

type TypedRouterRecord<TRecord extends RouterRecord> = {
  [K in keyof TRecord]: TRecord[K] extends AnyProcedure
    ? ProcedureHooks<TRecord[K]>
    : TRecord[K] extends RouterRecord
      ? TypedRouterRecord<TRecord[K]>
      : never;
};

// `useUtils()` exposes a proxy with invalidate/fetch/setData/cancel per
// procedure. We mirror the procedure shape so `utils.X.Y.invalidate(...)` /
// `utils.X.Y.cancel(...)` keep input typing — these are the surfaces actually
// used.
type UtilsProcedure<TProcedure extends AnyProcedure> = {
  invalidate: (input?: Partial<inferProcedureInput<TProcedure>>, opts?: unknown) => Promise<void>;
  cancel: (input?: Partial<inferProcedureInput<TProcedure>>, opts?: unknown) => Promise<void>;
  fetch: (input: inferProcedureInput<TProcedure>, opts?: Opts) => Promise<inferProcedureOutput<TProcedure>>;
  getData: (input?: inferProcedureInput<TProcedure>) => inferProcedureOutput<TProcedure> | undefined;
  setData: (input: inferProcedureInput<TProcedure>, updater: Opts) => void;
};

type TypedUtilsRecord<TRecord extends RouterRecord> = {
  [K in keyof TRecord]: TRecord[K] extends AnyProcedure
    ? UtilsProcedure<TRecord[K]>
    : TRecord[K] extends RouterRecord
      ? TypedUtilsRecord<TRecord[K]>
      : never;
};

type AppRouterRecord = AppRouter['_def']['record'];
type RawTrpcReact = ReturnType<typeof createTRPCReact<AppRouter>>;

type TypedTrpc = TypedRouterRecord<AppRouterRecord> & {
  Provider: RawTrpcReact['Provider'];
  createClient: (opts: Opts) => RawTrpcReact extends { createClient: (opts: Opts) => infer C }
    ? C
    : unknown;
  useUtils: () => TypedUtilsRecord<AppRouterRecord>;
};

const rawTrpc = createTRPCReact<AppRouter>();
export const trpc = rawTrpc as unknown as TypedTrpc;

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
