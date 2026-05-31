import { createFileRoute } from '@tanstack/react-router';
import { AssetLibrary } from '@/components/asset-library/AssetLibrary';
import { BatchToolbar } from '@/components/asset-library/BatchToolbar';
import { SceneDrawer } from '@/components/drawers/SceneDrawer';

const FIELDS = [
  { key: 'era' as const, label: '时代', options: ['古代', '现代', '未来', '奇幻', '科幻'] },
  { key: 'genre' as const, label: '题材', options: ['古风', '都市', '科幻', '玄幻'] },
  {
    key: 'scene_type' as const,
    label: '场景类型',
    options: ['室内', '室外', '城市', '自然', '太空'],
  },
  { key: 'mood' as const, label: '氛围', options: ['宁静', '紧张', '欢快', '阴郁', '神秘'] },
];

export const Route = createFileRoute('/(assets)/scenes')({
  component: ScenesPage,
});

function ScenesPage() {
  return (
    <section>
      <h1 className="mb-4 text-xl font-semibold tracking-tight">场景</h1>
      <AssetLibrary
        kind="scene"
        filterFields={FIELDS}
        renderDrawer={(p) => <SceneDrawer {...p} />}
        headerActions={<BatchToolbar kind="scene" />}
      />
    </section>
  );
}
