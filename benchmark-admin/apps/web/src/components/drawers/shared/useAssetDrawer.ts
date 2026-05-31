import { useState } from 'react';
import { trpc } from '@/lib/trpc';

export type AssetKind = 'character' | 'scene' | 'prop';

export function useAssetDrawer(kind: AssetKind, id: number) {
  const utils = trpc.useUtils();
  const isNew = id === 0;
  const get = trpc.assets.get.useQuery(
    { id },
    { enabled: !isNew, refetchOnWindowFocus: false },
  );

  const create = trpc.assets.create.useMutation();
  const update = trpc.assets.update.useMutation();
  const deleteImage = trpc.assets.deleteImage.useMutation();
  const setCover = trpc.assets.setCover.useMutation();
  const generatePrompt = trpc.ai.generatePrompt.useMutation();
  const extractFields = trpc.ai.extractFields.useMutation();
  const generateImage = trpc.ai.generateImage.useMutation();

  const [aiError, setAiError] = useState<string | null>(null);

  async function refresh() {
    await Promise.all([
      utils.assets.list.invalidate({ kind }),
      isNew ? Promise.resolve() : utils.assets.get.invalidate({ id }),
    ]);
  }

  return {
    isNew,
    asset: get.data ?? null,
    isLoading: !isNew && get.isPending,
    create,
    update,
    deleteImage,
    setCover,
    generatePrompt,
    extractFields,
    generateImage,
    aiError,
    setAiError,
    refresh,
  };
}
