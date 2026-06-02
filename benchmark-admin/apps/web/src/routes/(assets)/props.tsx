import { createFileRoute } from '@tanstack/react-router';
import { AssetLibrary } from '@/components/asset-library/AssetLibrary';
import { PropDrawer } from '@/components/drawers/PropDrawer';
import { AssetsLayout } from './__layout';

export const Route = createFileRoute('/(assets)/props')({
  component: PropsPage,
});

function PropsPage() {
  return (
    <AssetsLayout>
      <AssetLibrary kind="prop" renderDrawer={(p) => <PropDrawer {...p} />} />
    </AssetsLayout>
  );
}
