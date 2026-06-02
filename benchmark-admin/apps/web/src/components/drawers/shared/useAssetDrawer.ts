import { trpc } from '@/lib/trpc';
import { useState } from 'react';

export type AssetKind = 'character' | 'scene' | 'prop';

export function useAssetDrawer(kind: AssetKind, id: number) {
  const utils = trpc.useUtils();
  const isNew = id === 0;
  const get = trpc.assets.get.useQuery(
    { id },
    {
      enabled: !isNew,
      refetchOnWindowFocus: false,
      // assets.get returns presigned image URLs (~1h TTL) — keep the cached
      // entry fresh long enough that opening the drawer twice doesn't re-sign
      // every URL and re-download every image.
      staleTime: 30 * 60_000,
    },
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
