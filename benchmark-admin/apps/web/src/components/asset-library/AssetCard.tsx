import { Card } from '@/components/ui/card';
import { LazyImage } from './LazyImage';

export type AssetCardData = {
  id: number;
  name: string;
  era?: string | null;
  genre?: string | null;
  coverImageId?: number | null;
  images: { id: number; url: string }[];
  deletedAt?: Date | null;
};

export type AssetCardProps = {
  asset: AssetCardData;
  onClick: (id: number) => void;
  selected?: boolean;
};

export function AssetCard({ asset, onClick, selected = false }: AssetCardProps) {
  const cover =
    asset.images.find((img) => img.id === asset.coverImageId) ?? asset.images[0] ?? null;

  return (
    <Card
      onClick={() => onClick(asset.id)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick(asset.id);
        }
      }}
      // biome-ignore lint/a11y/useSemanticElements: Card is a div by design; keyboard + role provide button semantics
      role="button"
      tabIndex={0}
      aria-label={`打开 ${asset.name}`}
      aria-pressed={selected}
      className={`cursor-pointer overflow-hidden transition-shadow hover:shadow-md ${selected ? 'ring-2 ring-[hsl(var(--ring))]' : ''}`}
    >
      <LazyImage src={cover?.url} alt={asset.name} className="aspect-square w-full" />
      <div className="px-3 py-2">
        <div className="truncate text-sm font-medium">{asset.name || '未命名'}</div>
        <div className="mt-0.5 flex gap-1 text-xs text-[hsl(var(--muted-foreground))]">
          {asset.era ? <span>{asset.era}</span> : null}
          {asset.genre ? <span>· {asset.genre}</span> : null}
        </div>
      </div>
    </Card>
  );
}
