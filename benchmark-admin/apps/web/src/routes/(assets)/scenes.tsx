import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { AssetLibrary } from '@/components/asset-library/AssetLibrary';
import { BatchToolbar } from '@/components/asset-library/BatchToolbar';
import { SceneDrawer } from '@/components/drawers/SceneDrawer';
import { AssetsLayout } from './__layout';

export const Route = createFileRoute('/(assets)/scenes')({
  component: ScenesPage,
});

function ScenesPage() {
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  return (
    <AssetsLayout>
      <AssetLibrary
        kind="scene"
        renderDrawer={(p) => <SceneDrawer {...p} />}
        selectionMode="multi"
        selectedIds={selectedIds}
        onSelectionChange={setSelectedIds}
        headerActions={<BatchToolbar selectedIds={selectedIds} />}
      />
    </AssetsLayout>
  );
}
