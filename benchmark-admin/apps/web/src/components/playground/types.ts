// Shared types for the /playground feature.

export const ASPECT_RATIOS = ['16:9', '1:1', '3:2', '2:3', '9:16'] as const;
export type AspectRatio = (typeof ASPECT_RATIOS)[number];

// Approximate pixel labels shown next to each ratio so the dropdown matches the
// screenshot. Numbers are illustrative (server resolves via IMAGE_SIZE=2K) — they
// are display-only and not sent in the mutation.
export const ASPECT_LABELS: Record<AspectRatio, string> = {
  '16:9': '16:9  (≈1672×941)',
  '1:1': '1:1  (≈1280×1280)',
  '3:2': '3:2  (≈1568×1045)',
  '2:3': '2:3  (≈1045×1568)',
  '9:16': '9:16  (≈941×1672)',
};

// v1 ships a single image model; the dropdown is shown for fidelity with the
// screenshot but locked to one value (matches the zod whitelist on the server).
export const MODELS = ['gpt-image-2'] as const;
export type ImageModel = (typeof MODELS)[number];

export const MAX_REF_IMAGES = 4;

export type RefImage = {
  // localId is a stable client-side key for the list while uploads are in
  // flight; mediaId only exists once createStandalone resolves.
  localId: string;
  status: 'uploading' | 'uploaded' | 'failed';
  // previewUrl is an object URL while uploading, or the presigned TOS URL once
  // the row is created.
  previewUrl: string;
  mediaId?: number;
  error?: string;
};
