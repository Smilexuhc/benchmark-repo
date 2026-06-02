import { Checkbox } from '@base-ui/react/checkbox';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { LazyImage } from './LazyImage';

export type AssetCardData = {
  id: number;
  name: string;
  era?: string | null;
  genre?: string | null;
  coverImageId?: number | null;
  images: { id: number; url: string }[];
  deletedAt?: Date | null;
  // assets.list returns the JSONB `data` blob; prompt lives inside it. Batch
  // generation needs this to skip items with no prompt without a per-item GET.
  data?: { prompt?: string | null } & Record<string, unknown>;
};

export type AssetCardProps = {
  asset: AssetCardData;
  onClick: (id: number) => void;
  selected?: boolean;
  selectMode?: boolean;
  onToggleSelect?: (id: number) => void;
};

export function AssetCard({
  asset,
  onClick,
  selected = false,
  selectMode = false,
  onToggleSelect,
}: AssetCardProps) {
  const cover =
    asset.images.find((img) => img.id === asset.coverImageId) ?? asset.images[0] ?? null;

  function handleActivate() {
    if (selectMode) {
      onToggleSelect?.(asset.id);
    } else {
      onClick(asset.id);
    }
  }

  return (
    <Card
      onClick={handleActivate}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handleActivate();
        }
      }}
      // biome-ignore lint/a11y/useSemanticElements: Card is a div by design; keyboard + role provide button semantics
      role="button"
      tabIndex={0}
      aria-label={selectMode ? `选择 ${asset.name}` : `打开 ${asset.name}`}
      aria-pressed={selected}
      className={cn(
        'cursor-pointer overflow-hidden transition-shadow hover:shadow-md',
        selected ? 'ring-2 ring-[hsl(var(--ring))]' : '',
      )}
    >
      {selectMode ? (
        <div
          className="flex h-11 items-center gap-2 border-b border-[hsl(var(--border))] bg-[hsl(var(--muted))] px-3"
          onClick={(e) => {
            // Clicking the lane (or its checkbox) toggles selection without
            // bubbling up — the whole card already handles activation.
            e.stopPropagation();
            onToggleSelect?.(asset.id);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              e.stopPropagation();
              onToggleSelect?.(asset.id);
            }
          }}
          role="presentation"
        >
          <Checkbox.Root
            checked={selected}
            aria-label={`选择 ${asset.name}`}
            onCheckedChange={() => onToggleSelect?.(asset.id)}
            onClick={(e) => e.stopPropagation()}
            className={cn(
              'flex h-5 w-5 items-center justify-center rounded border transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] focus-visible:ring-offset-2',
              selected
                ? 'border-[hsl(var(--primary))] bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]'
                : 'border-[hsl(var(--border))] bg-[hsl(var(--background))]',
            )}
          >
            <Checkbox.Indicator>
              <svg
                viewBox="0 0 12 12"
                className="h-3 w-3"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                aria-hidden="true"
              >
                <path d="M2.5 6.5l2.5 2.5 4.5-5" />
              </svg>
            </Checkbox.Indicator>
          </Checkbox.Root>
          <span className="truncate text-xs text-[hsl(var(--muted-foreground))]">
            {selected ? '已选中' : '点击选中'}
          </span>
        </div>
      ) : null}
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
