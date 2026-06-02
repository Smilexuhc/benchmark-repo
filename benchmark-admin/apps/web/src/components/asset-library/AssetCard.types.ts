import type { ReactNode } from 'react';
import type { CharacterData, PropData, SceneData } from '@benchmark-admin/shared/schemas/assets';

export type AssetCardImage = {
  id: number;
  url: string;
};

type AssetCardCommon = {
  id: number;
  name: string;
  era?: string | null;
  genre?: string | null;
  coverImageId?: number | null;
  images: AssetCardImage[];
  deletedAt?: Date | string | null;
};

export type CharacterCardData = AssetCardCommon & {
  kind: 'character';
  data: CharacterData;
};

export type SceneCardData = AssetCardCommon & {
  kind: 'scene';
  data: SceneData;
};

export type PropCardData = AssetCardCommon & {
  kind: 'prop';
  data: PropData;
};

export type AssetCardData = CharacterCardData | SceneCardData | PropCardData;

export type AssetCardRenderInfo = (asset: AssetCardData) => ReactNode;
export type AssetCardRenderExtra = (asset: AssetCardData) => ReactNode;
