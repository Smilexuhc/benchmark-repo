import type { ReactNode } from 'react';

export type AssetsLayoutProps = {
  children: ReactNode;
};

// The root layout already shows "资产库" + Segmented tabs in the global
// header. This wrapper exists so the asset routes (characters/scenes/props)
// + the benchmark route can share a consistent content frame — h-full
// flex column so the inner list (FilterPanel + scroll area) fills the
// viewport instead of leaving bottom whitespace (BEN-5 round 7 #2).
export function AssetsLayout({ children }: AssetsLayoutProps) {
  return <section className="flex h-full flex-col px-5 py-3">{children}</section>;
}
