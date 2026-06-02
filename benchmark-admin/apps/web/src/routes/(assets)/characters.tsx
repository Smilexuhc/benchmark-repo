import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { AssetLibrary } from '@/components/asset-library/AssetLibrary';
import { BatchToolbar } from '@/components/asset-library/BatchToolbar';
import { CharacterDrawer } from '@/components/drawers/CharacterDrawer';
import { AssetsLayout } from './__layout';

export const Route = createFileRoute('/(assets)/characters')({
  component: CharactersPage,
});

function CharactersPage() {
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  return (
    <AssetsLayout>
      <AssetLibrary
        kind="character"
        renderDrawer={(p) => <CharacterDrawer {...p} />}
        selectionMode="multi"
        selectedIds={selectedIds}
        onSelectionChange={setSelectedIds}
        headerActions={<BatchToolbar selectedIds={selectedIds} />}
      />
    </AssetsLayout>
  );
}
