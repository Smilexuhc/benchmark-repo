import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { LazyImage } from './LazyImage';

export type AssetCardData = {
  id: number;
  kind: 'character' | 'scene' | 'prop';
  name: string;
  era?: string | null;
  genre?: string | null;
  data?: {
    type?: string;
    gender?: string;
    age?: string;
    persona?: string;
    body?: string;
    features?: string;
    prompt?: string;
    description?: string;
    scene_type?: string;
    mood?: string;
    elements?: string[];
    category?: string;
  };
  coverImageId?: number | null;
  images: { id: number; url: string }[];
  imageCount?: number;
  deletedAt?: Date | null;
};

export type AssetCardProps = {
  asset: AssetCardData;
  onClick: (id: number) => void;
  onEdit: (id: number) => void;
  selected?: boolean;
  selectionMode?: boolean;
  onGenerateImage?: (asset: AssetCardData) => Promise<void>;
};

export function AssetCard({
  asset,
  onClick,
  onEdit,
  selected = false,
  selectionMode = false,
  onGenerateImage,
}: AssetCardProps) {
  const [copyLabel, setCopyLabel] = useState('复制');
  const [isGenerating, setIsGenerating] = useState(false);
  const cover =
    asset.images.find((img) => img.id === asset.coverImageId) ?? asset.images[0] ?? null;
  const prompt = asset.data?.prompt ?? '';
  const displayName = asset.kind === 'character' ? asset.data?.persona || asset.name : asset.name;
  const attrs = [
    asset.era,
    asset.kind === 'scene' ? asset.data?.scene_type : asset.data?.type,
    asset.kind === 'scene' ? asset.data?.mood : asset.data?.gender,
    asset.kind === 'character' ? asset.data?.age : null,
  ].filter(Boolean);

  async function copyPrompt() {
    if (!prompt) return;
    await navigator.clipboard.writeText(prompt);
    setCopyLabel('已复制');
    window.setTimeout(() => setCopyLabel('复制'), 1200);
  }

  async function generate() {
    if (!onGenerateImage || !prompt) return;
    setIsGenerating(true);
    try {
      await onGenerateImage(asset);
    } finally {
      setIsGenerating(false);
    }
  }

  function downloadCover() {
    if (!cover?.url) return;
    const a = document.createElement('a');
    a.href = cover.url;
    a.download = `${displayName || 'asset'}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  return (
    <article
      aria-label={displayName || '未命名资产'}
      className={`flex min-h-[220px] overflow-hidden rounded-lg border bg-white ${
        selected ? 'border-[hsl(var(--primary))] ring-1 ring-[hsl(var(--primary))]' : 'border-[hsl(var(--border))]'
      } ${asset.deletedAt ? 'opacity-60' : ''}`}
    >
      {selectionMode ? (
        <button
          type="button"
          aria-pressed={selected}
          aria-label={`${selected ? '取消选择' : '选择'} ${displayName || asset.name}`}
          onClick={() => onClick(asset.id)}
          className={`flex w-11 shrink-0 items-center justify-center border-r border-[hsl(var(--border))] ${
            selected ? 'bg-blue-50' : 'bg-slate-50'
          }`}
        >
          <span className={`h-4 w-4 rounded border ${selected ? 'border-blue-600 bg-blue-600' : 'border-slate-300'}`} />
        </button>
      ) : null}

      <div className="flex w-[236px] shrink-0 flex-col border-r border-[hsl(var(--border))] p-4">
        <h2 className="text-sm font-semibold leading-6">{displayName || '(未命名)'}</h2>
        <p className="mb-3 text-xs leading-5 text-[hsl(var(--muted-foreground))]">
          {attrs.length > 0 ? attrs.join(' · ') : '—'}
        </p>
        <InfoRow label="身材" value={asset.data?.body} />
        <InfoRow label="特征" value={asset.data?.features} />
        {asset.genre ? (
          <span className="mt-2 w-fit rounded border border-blue-200 bg-blue-50 px-2 py-0.5 text-xs text-blue-700">
            {asset.genre}
          </span>
        ) : null}
        <div className="flex-1" />
        <Button size="sm" variant="outline" className="w-fit" onClick={() => onEdit(asset.id)}>
          编辑
        </Button>
      </div>

      <div className="flex min-w-0 flex-1 flex-col border-r border-[hsl(var(--border))] p-4">
        <div className="mb-2 flex items-center justify-between gap-3">
          <span className="text-sm font-semibold">提示词</span>
          <Button size="sm" variant="ghost" disabled={!prompt} onClick={copyPrompt}>
            {copyLabel}
          </Button>
        </div>
        {prompt ? (
          <div className="max-h-[168px] flex-1 overflow-y-auto whitespace-pre-wrap rounded bg-slate-50 p-2 font-mono text-xs leading-5 text-slate-700">
            {prompt}
          </div>
        ) : (
          <p className="pt-2 text-xs text-[hsl(var(--muted-foreground))]">
            暂无提示词，点「编辑」生成
          </p>
        )}
      </div>

      <div className="flex w-[392px] shrink-0 flex-col items-center justify-center bg-slate-50 p-3">
        {isGenerating ? (
          <div className="text-center text-sm text-[hsl(var(--muted-foreground))]">
            生成中，约 1 分钟…
          </div>
        ) : cover ? (
          <>
            <button
              type="button"
              className="max-h-[196px] max-w-[360px]"
              onClick={() => window.open(cover.url, '_blank', 'noopener,noreferrer')}
              aria-label={`打开 ${displayName || asset.name} 原图`}
            >
              <LazyImage
                src={cover.url}
                alt={displayName || asset.name}
                className="max-h-[196px] max-w-[360px] rounded object-contain"
              />
            </button>
            <div className="mt-2 flex flex-wrap items-center justify-center gap-x-3 gap-y-1">
              <Button size="sm" variant="ghost" disabled={!prompt || !onGenerateImage} onClick={generate}>
                重新生成
              </Button>
              <Button size="sm" variant="ghost" onClick={downloadCover}>
                下载原图
              </Button>
              {(asset.imageCount ?? asset.images.length) > 1 ? (
                <span className="text-[11px] text-[hsl(var(--muted-foreground))]">
                  共 {asset.imageCount ?? asset.images.length} 张 · 点图放大左右翻看
                </span>
              ) : null}
            </div>
          </>
        ) : (
          <div className="text-center">
            <p className="mb-2 text-sm text-[hsl(var(--muted-foreground))]">暂无图片</p>
            <Button size="sm" disabled={!prompt || !onGenerateImage} onClick={generate}>
              生成图片
            </Button>
          </div>
        )}
      </div>
    </article>
  );
}

function InfoRow({ label, value }: { label: string; value: string | undefined }) {
  if (!value) return null;
  return (
    <div className="flex gap-2 text-xs leading-5">
      <span className="shrink-0 text-[hsl(var(--muted-foreground))]">{label}</span>
      <span className="text-slate-700">{value}</span>
    </div>
  );
}
