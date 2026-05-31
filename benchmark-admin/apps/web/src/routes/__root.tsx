import { Link, Outlet, createRootRoute, useLocation, useNavigate } from '@tanstack/react-router';
import { useEffect } from 'react';
import { Nav } from '@/components/nav';
import { Button } from '@/components/ui/button';
import { useAuthActions, useSession } from '@/lib/auth-client';

function RootLayout() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const session = useSession();
  const { logout } = useAuthActions();

  const isLoginRoute = pathname === '/login';
  const isAuthed = session.data != null;
  const authReady = !session.isPending;

  useEffect(() => {
    if (!authReady) return;
    if (!isAuthed && !isLoginRoute) {
      navigate({ to: '/login', search: { redirect: pathname }, replace: true });
    }
  }, [authReady, isAuthed, isLoginRoute, navigate, pathname]);

  if (isLoginRoute) {
    return (
      <div className="min-h-full bg-[hsl(var(--muted))]">
        <Outlet />
      </div>
    );
  }

  if (!authReady || !isAuthed) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-[hsl(var(--muted-foreground))]">
        {session.isError ? '加载会话失败，正在重试…' : '加载中…'}
      </div>
    );
  }

  return (
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
  );
}

export const Route = createRootRoute({
  component: RootLayout,
});
