import { createTRPCClient, httpBatchLink } from '@trpc/client';
import { type CreateTRPCReact, createTRPCReact } from '@trpc/react-query';
import superjson from 'superjson';
import type { AppRouter } from '@benchmark-admin/server';

export const trpc: CreateTRPCReact<AppRouter, unknown> = createTRPCReact<AppRouter>();

export const trpcClient = createTRPCClient<AppRouter>({
  links: [
    httpBatchLink({
      url: '/api/trpc',
      transformer: superjson,
    }),
  ],
});
