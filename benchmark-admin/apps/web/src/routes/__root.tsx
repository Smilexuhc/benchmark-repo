import { Link, Outlet, createRootRoute, useLocation, useNavigate } from '@tanstack/react-router';
import { useEffect } from 'react';
import { ConfirmHost, Toaster } from '@/components/feedback';
import { Nav } from '@/components/nav';
import { Button } from '@/components/ui/button';
import { LightboxProvider } from '@/components/ui/lightbox';
import { useAuthActions, useSession } from '@/lib/auth-client';

function RootLayout() {
  return (
    <>
      <RootContent />
      <Toaster />
      <ConfirmHost />
    </>
  );
}

function RootContent() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const session = useSession();
  const { logout } = useAuthActions();

  const isLoginRoute = pathname === '/login';
  const isAuthed = session.data != null;
  const authReady = !session.isPending;

  useEffect(() => {
    if (!authReady) return;
    // On a non-401 fetch error we show an explicit auth-error state with a
    // retry / 重新登录 affordance rather than silently redirecting, so don't
    // auto-navigate here.
    if (session.isError) return;
    if (!isAuthed && !isLoginRoute) {
      navigate({ to: '/login', search: { redirect: pathname }, replace: true });
    }
  }, [authReady, isAuthed, isLoginRoute, navigate, pathname, session.isError]);

  if (isLoginRoute) {
    return (
      <div className="min-h-full bg-[hsl(var(--muted))]">
        <Outlet />
      </div>
    );
  }

  if (session.isError) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-sm text-[hsl(var(--muted-foreground))]">
        <p>加载会话失败。</p>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => session.refetch()}>
            重试
          </Button>
          <Button size="sm" onClick={() => navigate({ to: '/login', replace: true })}>
            重新登录
          </Button>
        </div>
      </div>
    );
  }

  if (!authReady || !isAuthed) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-[hsl(var(--muted-foreground))]">
        加载中…
      </div>
    );
  }

  return (
    <LightboxProvider>
      <div className="flex min-h-full flex-col">
        <header className="flex items-center justify-between border-b border-[hsl(var(--border))] bg-[hsl(var(--background))] px-6 py-3">
          <div className="flex items-center gap-6">
            <Link to="/" className="text-base font-semibold tracking-tight">
              Benchmark Admin
            </Link>
            <Nav />
          </div>
          <div className="flex items-center gap-3 text-sm text-[hsl(var(--muted-foreground))]">
            <span aria-label="signed in user">{session.data?.email}</span>
            <Button
              variant="outline"
              size="sm"
              onClick={async () => {
                await logout();
                navigate({ to: '/login', replace: true });
              }}
            >
              退出登录
            </Button>
          </div>
        </header>
        <main className="flex-1 px-6 py-6">
          <Outlet />
        </main>
      </div>
    </LightboxProvider>
  );
}

export const Route = createRootRoute({
  component: RootLayout,
});
