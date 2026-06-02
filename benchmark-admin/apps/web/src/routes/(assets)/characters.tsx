import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { AssetLibrary } from '@/components/asset-library/AssetLibrary';
import { BatchToolbar } from '@/components/asset-library/BatchToolbar';
import { CharacterDrawer } from '@/components/drawers/CharacterDrawer';

const FIELDS = [
  { key: 'era' as const, label: '时代', options: ['古代', '现代', '未来', '奇幻', '科幻'] },
  { key: 'genre' as const, label: '题材', options: ['古风', '都市', '科幻', '玄幻'] },
  {
    key: 'type' as const,
    label: '类型',
    options: ['亚洲人', '欧洲人', '非洲人', '拉美人', '动物/宠物', '动物拟人', '机器人', '神话生物'],
  },
  { key: 'gender' as const, label: '性别', options: ['N/A', '中性', '女', '男'] },
  { key: 'age' as const, label: '年龄段', options: ['婴儿', '儿童', '青少年', '青年', '成年', '中年', '老年', 'N/A'] },
];

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
        filterFields={FIELDS}
        renderDrawer={(p) => <CharacterDrawer {...p} />}
        selectionMode="multi"
        selectedIds={selectedIds}
        onSelectionChange={setSelectedIds}
        headerActions={<BatchToolbar selectedIds={selectedIds} />}
      />
    </section>
  );
}
