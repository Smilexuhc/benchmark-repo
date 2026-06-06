import { ConfirmHost, Toaster } from '@/components/feedback';
import { Button } from '@/components/ui/button';
import { LightboxProvider } from '@/components/ui/lightbox';
import { Segmented } from '@/components/ui/segmented';
import { useSession } from '@/lib/auth-client';
import { Link, Outlet, createRootRoute, useLocation, useNavigate } from '@tanstack/react-router';
import { useEffect } from 'react';

type AssetTab = '/characters' | '/scenes' | '/props' | '/benchmark' | '/playground';
const TABS: readonly { value: AssetTab; label: string }[] = [
  { value: '/characters', label: '角色资产库' },
  { value: '/scenes', label: '场景资产库' },
  { value: '/props', label: '道具资产库' },
  { value: '/benchmark', label: '题目' },
  { value: '/playground', label: '生图' },
];

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

  const currentTab = (TABS.find((t) => pathname === t.value || pathname.startsWith(`${t.value}/`))
    ?.value ?? '/characters') as AssetTab;

  return (
    <LightboxProvider>
      <div className="flex h-screen flex-col overflow-hidden">
        {/* Single 56px header matching legacy: 资产库 + Segmented in one row.
            No email / logout — user asked to remove (BEN-5 round 7). */}
        <header className="flex h-14 shrink-0 items-center gap-5 border-b border-[hsl(var(--border))] bg-[hsl(var(--background))] px-5">
          <Link to="/" className="text-base font-semibold tracking-tight">
            资产库
          </Link>
          <Segmented<AssetTab>
            value={currentTab}
            items={TABS}
            onChange={(to) => navigate({ to })}
            ariaLabel="资产库分类"
          />
        </header>
        <main className="min-h-0 flex-1 overflow-hidden">
          <Outlet />
        </main>
      </div>
    </LightboxProvider>
  );
}

export const Route = createRootRoute({
  component: RootLayout,
});
