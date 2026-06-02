import { useLocation, useNavigate } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { Segmented } from '@/components/ui/segmented';

type AssetTab = '/characters' | '/scenes' | '/props' | '/benchmark';

const TABS: readonly { value: AssetTab; label: string }[] = [
  { value: '/characters', label: '角色资产库' },
  { value: '/scenes', label: '场景资产库' },
  { value: '/props', label: '道具资产库' },
  { value: '/benchmark', label: '题目' },
];

export type AssetsLayoutProps = {
  children: ReactNode;
};

export function AssetsLayout({ children }: AssetsLayoutProps) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const current = (TABS.find((t) => pathname === t.value || pathname.startsWith(`${t.value}/`))
    ?.value ?? '/characters') as AssetTab;

  return (
    <section>
      <header className="mb-4 flex items-center gap-4">
        <h1 className="text-xl font-semibold tracking-tight">资产库</h1>
        <Segmented<AssetTab>
          value={current}
          items={TABS}
          onChange={(to) => navigate({ to })}
          ariaLabel="资产库分类"
        />
      </header>
      {children}
    </section>
  );
}
