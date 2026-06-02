import { createFileRoute } from '@tanstack/react-router';
import { AssetLibrary } from '@/components/asset-library/AssetLibrary';
import { CharacterDrawer } from '@/components/drawers/CharacterDrawer';
import { AssetsLayout } from './__layout';

export const Route = createFileRoute('/(assets)/characters')({
  component: CharactersPage,
});

function CharactersPage() {
  return (
    <AssetsLayout>
      <AssetLibrary kind="character" renderDrawer={(p) => <CharacterDrawer {...p} />} />
    </AssetsLayout>
  );
}
