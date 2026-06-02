import { createContext, useContext } from 'react';

export type LightboxImageId = string | number;

export type LightboxImage = {
  id: LightboxImageId;
  url: string;
  isCover?: boolean;
};

export type LightboxOpenOptions = {
  images: LightboxImage[];
  initialIndex?: number;
  onSetCover?: (id: LightboxImageId) => void;
  onDownload?: (image: LightboxImage) => void;
  triggerRef?: React.RefObject<HTMLElement | null>;
};

export type LightboxApi = {
  open: (options: LightboxOpenOptions) => void;
  close: () => void;
};

export const LightboxContext = createContext<LightboxApi | null>(null);

export function useLightbox(): LightboxApi {
  const ctx = useContext(LightboxContext);
  if (!ctx) {
    throw new Error('useLightbox must be used within a <LightboxProvider>');
  }
  return ctx;
}
