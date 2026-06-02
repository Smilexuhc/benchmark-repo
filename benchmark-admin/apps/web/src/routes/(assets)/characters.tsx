import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { AssetLibrary } from '@/components/asset-library/AssetLibrary';
import { BatchToolbar } from '@/components/asset-library/BatchToolbar';
import { CharacterDrawer } from '@/components/drawers/CharacterDrawer';

export const Route = createFileRoute('/(assets)/characters')({
  component: CharactersPage,
});

function CharactersPage() {
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  return (
    <section>
      <h1 className="mb-4 text-xl font-semibold tracking-tight">角色</h1>
      <AssetLibrary
        kind="character"
        renderDrawer={(p) => <CharacterDrawer {...p} />}
        selectionMode="multi"
        selectedIds={selectedIds}
        onSelectionChange={setSelectedIds}
        headerActions={<BatchToolbar selectedIds={selectedIds} />}
      />
    </section>
  );
}
