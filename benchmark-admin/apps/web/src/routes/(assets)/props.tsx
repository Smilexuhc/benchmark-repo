import { createFileRoute } from '@tanstack/react-router';
import { AssetLibrary } from '@/components/asset-library/AssetLibrary';
import { BatchToolbar } from '@/components/asset-library/BatchToolbar';
import { PropDrawer } from '@/components/drawers/PropDrawer';

const FIELDS = [
  { key: 'era' as const, label: '时代', options: ['古代', '现代', '未来', '奇幻', '科幻'] },
  { key: 'genre' as const, label: '题材', options: ['古风', '都市', '科幻', '玄幻'] },
  {
    key: 'category' as const,
    label: '分类',
    options: ['武器', '装饰', '工具', '家具', '交通'],
  },
];

export const Route = createFileRoute('/(assets)/props')({
  component: PropsPage,
});

function PropsPage() {
  return (
    <section>
      <h1 className="mb-4 text-xl font-semibold tracking-tight">道具</h1>
      <AssetLibrary
        kind="prop"
        filterFields={FIELDS}
        renderDrawer={(p) => <PropDrawer {...p} />}
        headerActions={<BatchToolbar />}
      />
    </section>
  );
}
