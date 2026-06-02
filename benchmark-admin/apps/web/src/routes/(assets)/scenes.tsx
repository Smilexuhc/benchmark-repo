import { createFileRoute } from '@tanstack/react-router';
import { AssetLibrary } from '@/components/asset-library/AssetLibrary';
import { SceneDrawer } from '@/components/drawers/SceneDrawer';
import { AssetsLayout } from './__layout';

export const Route = createFileRoute('/(assets)/scenes')({
  component: ScenesPage,
});

function ScenesPage() {
  return (
    <AssetsLayout>
      <AssetLibrary kind="scene" renderDrawer={(p) => <SceneDrawer {...p} />} />
    </AssetsLayout>
  );
}
