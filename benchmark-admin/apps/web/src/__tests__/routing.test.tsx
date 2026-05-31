import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory, createRouter } from '@tanstack/react-router';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NuqsTestingAdapter } from 'nuqs/adapters/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { trpc, trpcReactClient } from '@/lib/trpc';
import { routeTree } from '@/routeTree.gen';

type SessionResponse = { session: { email: string } | null };

function buildRouter(initialEntries: string[]) {
  return createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries }),
  });
}

function setFetch(handler: (input: string, init?: RequestInit) => Promise<Response>) {
  vi.stubGlobal('fetch', vi.fn(handler));
}

function renderApp(router: ReturnType<typeof buildRouter>) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <trpc.Provider client={trpcReactClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        <NuqsTestingAdapter>
          <RouterProvider router={router} />
        </NuqsTestingAdapter>
      </QueryClientProvider>
    </trpc.Provider>,
  );
}

describe('routing shell + auth guard', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('redirects unauthenticated visit to /characters → /login', async () => {
    setFetch(async (input) => {
      if (String(input).endsWith('/api/auth/me')) {
        return new Response(JSON.stringify({ session: null } satisfies SessionResponse), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      throw new Error(`unexpected fetch: ${String(input)}`);
    });

    const router = buildRouter(['/characters']);
    renderApp(router);

    await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
    expect(await screen.findByRole('heading', { name: '登录' })).toBeInTheDocument();
  });

  it('logs in and lands on the redirect target', async () => {
    let signedIn = false;
    setFetch(async (input, init) => {
      const url = String(input);
      if (url.endsWith('/api/auth/me')) {
        return new Response(
          JSON.stringify({
            session: signedIn ? { email: 'admin@example.com' } : null,
          } satisfies SessionResponse),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      if (url.endsWith('/api/auth/login') && init?.method === 'POST') {
        signedIn = true;
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const router = buildRouter(['/login?redirect=%2Fbenchmark']);
    renderApp(router);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

    await screen.findByRole('heading', { name: '登录' });
    await user.type(screen.getByLabelText('邮箱'), 'admin@example.com');
    await user.type(screen.getByLabelText('密码'), 'correct-password');
    await user.click(screen.getByRole('button', { name: /登录/ }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/benchmark'));
    expect(await screen.findByRole('heading', { name: '视频基准' })).toBeInTheDocument();
  });

  it('signing out from any page returns to /login (U15 missing case)', async () => {
    let signedIn = true;
    setFetch(async (input, init) => {
      const url = String(input);
      if (url.endsWith('/api/auth/me')) {
        return new Response(
          JSON.stringify({
            session: signedIn ? { email: 'admin@example.com' } : null,
          } satisfies SessionResponse),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      if (url.endsWith('/api/auth/logout') && init?.method === 'POST') {
        signedIn = false;
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const router = buildRouter(['/characters']);
    renderApp(router);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

    // Authenticated landing — the header shows the user and the sign-out button.
    await screen.findByLabelText('signed in user');
    const logout = await screen.findByRole('button', { name: /退出登录/ });
    await user.click(logout);

    await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
    expect(await screen.findByRole('heading', { name: '登录' })).toBeInTheDocument();
  });
});
