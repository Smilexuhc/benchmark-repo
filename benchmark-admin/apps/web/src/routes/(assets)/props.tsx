import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { AssetLibrary } from '@/components/asset-library/AssetLibrary';
import { BatchToolbar } from '@/components/asset-library/BatchToolbar';
import { PropDrawer } from '@/components/drawers/PropDrawer';
import { AssetsLayout } from './__layout';

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
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  return (
    <AssetsLayout>
      <AssetLibrary
        kind="prop"
        filterFields={FIELDS}
        renderDrawer={(p) => <PropDrawer {...p} />}
        selectionMode="multi"
        selectedIds={selectedIds}
        onSelectionChange={setSelectedIds}
        headerActions={<BatchToolbar selectedIds={selectedIds} />}
      />
    </AssetsLayout>
  );
}
