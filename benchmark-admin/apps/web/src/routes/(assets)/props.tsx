import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { AssetLibrary } from '@/components/asset-library/AssetLibrary';
import { BatchToolbar } from '@/components/asset-library/BatchToolbar';
import { PropDrawer } from '@/components/drawers/PropDrawer';

export const Route = createFileRoute('/(assets)/props')({
  component: PropsPage,
});

function PropsPage() {
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  return (
    <section>
      <h1 className="mb-4 text-xl font-semibold tracking-tight">道具</h1>
      <AssetLibrary
        kind="prop"
        renderDrawer={(p) => <PropDrawer {...p} />}
        selectionMode="multi"
        selectedIds={selectedIds}
        onSelectionChange={setSelectedIds}
        headerActions={<BatchToolbar selectedIds={selectedIds} />}
      />
    </section>
  );
}
