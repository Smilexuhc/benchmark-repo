import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { AssetLibrary } from '@/components/asset-library/AssetLibrary';
import { BatchToolbar } from '@/components/asset-library/BatchToolbar';
import { SceneDrawer } from '@/components/drawers/SceneDrawer';

export const Route = createFileRoute('/(assets)/scenes')({
  component: ScenesPage,
});

function ScenesPage() {
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  return (
    <section>
      <h1 className="mb-4 text-xl font-semibold tracking-tight">场景</h1>
      <AssetLibrary
        kind="scene"
        renderDrawer={(p) => <SceneDrawer {...p} />}
        selectionMode="multi"
        selectedIds={selectedIds}
        onSelectionChange={setSelectedIds}
        headerActions={<BatchToolbar selectedIds={selectedIds} />}
      />
    </section>
  );
}
