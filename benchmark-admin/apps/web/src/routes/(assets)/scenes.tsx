import { createFileRoute } from '@tanstack/react-router';
import { AssetLibrary } from '@/components/asset-library/AssetLibrary';
import { SceneDrawer } from '@/components/drawers/SceneDrawer';
import { SceneViewColumn } from '@/components/drawers/SceneViewColumn';
import { trpc } from '@/lib/trpc';
import { AssetsLayout } from './__layout';

export const Route = createFileRoute('/(assets)/scenes')({
  component: ScenesPage,
});

function ScenesPage() {
  const utils = trpc.useUtils();
  return (
    <AssetsLayout>
      <AssetLibrary
        kind="scene"
        renderDrawer={(p) => <SceneDrawer {...p} />}
        renderExtra={(asset) =>
          asset.kind === 'scene' ? (
            <SceneViewColumn
              sceneId={asset.id}
              images={asset.images.map((img) =>
                img.source
                  ? { id: img.id, url: img.url, source: img.source }
                  : { id: img.id, url: img.url },
              )}
              hasCover={asset.coverImageId != null}
              onAfter={() => utils.assets.list.invalidate({ kind: 'scene' })}
            />
          ) : null
        }
      />
    </AssetsLayout>
  );
}
