import { LazyImage } from '@/components/asset-library/LazyImage';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useLightbox } from '@/lib/lightbox-context';
import { cn } from '@/lib/utils';
import type { RouterOutputs } from '@/lib/trpc';
import { labelsForPath } from '@benchmark-admin/shared/benchmark/categoryTree';
import { useRef } from 'react';
import { ExpandableText } from './ExpandableText';
import { formatRelativeTime } from './formatRelativeTime';

type BenchmarkItem = RouterOutputs['benchmark']['list']['items'][number];
type MediaLink = BenchmarkItem['media']['character_image'][number];

// Legacy parity: difficulty drives a colored chip, manual_tag dedups against
// categoryL3 (so we never repeat the leaf label), and a 【难】 prefix carried
// from the legacy DB is stripped before display so the chip just reads "难".
const DIFFICULTY_PREFIX_RE = /^【([易中难])】\s*/;
const DIFFICULTY_VARIANT: Record<string, 'success' | 'warning' | 'danger'> = {
  易: 'success',
  中: 'warning',
  难: 'danger',
};

type Chip = { key: string; label: string; tone?: 'success' | 'warning' | 'danger' | 'neutral' };

function buildChips(item: BenchmarkItem): Chip[] {
  const chips: Chip[] = [];
  const difficulty = item.difficulty?.trim();
  if (difficulty) {
    chips.push({
      key: 'difficulty',
      label: difficulty,
      tone: DIFFICULTY_VARIANT[difficulty] ?? 'neutral',
    });
  }
  const manualTag = item.manualTag?.replace(DIFFICULTY_PREFIX_RE, '').trim();
  if (manualTag && manualTag !== item.categoryL3) {
    chips.push({ key: 'manualTag', label: manualTag, tone: 'neutral' });
  }
  if (item.scene?.trim()) chips.push({ key: 'scene', label: item.scene, tone: 'neutral' });
  if (item.screenSize?.trim()) {
    chips.push({ key: 'screenSize', label: item.screenSize, tone: 'neutral' });
  }
  return chips;
}

// Title joins cascader display labels (which carry the "1.1.1" code prefix)
// with " · " to match legacy. If the (l1,l2,l3) path is not in the tree we
// fall back to whatever the row has, so legacy free-text categories still show.
function titleParts(item: BenchmarkItem): string[] {
  const l1 = item.categoryL1?.trim();
  const l2 = item.categoryL2?.trim();
  const l3 = item.categoryL3?.trim();
  const labels = l1 && l2 && l3 ? labelsForPath(l1, l2, l3) : undefined;
  if (labels) return [...labels];
  return [l1, l2, l3].filter((v): v is string => Boolean(v));
}

function ChipTag({ chip }: { chip: Chip }) {
  const tone = chip.tone ?? 'neutral';
  const cls = cn(
    'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
    tone === 'success' && 'bg-emerald-100 text-emerald-700',
    tone === 'warning' && 'bg-amber-100 text-amber-700',
    tone === 'danger' && 'bg-red-100 text-red-700',
    tone === 'neutral' && 'bg-[hsl(var(--muted))] text-[hsl(var(--foreground))]',
  );
  return <span className={cls}>{chip.label}</span>;
}

type AssetGroupKey = 'character_image' | 'scene_image' | 'prop_image' | 'audio_input';
const ASSET_GROUP_LABEL: Record<AssetGroupKey, string> = {
  character_image: '角色',
  scene_image: '场景',
  prop_image: '道具',
  audio_input: '音频',
};

function AssetGroup({
  groupKey,
  links,
}: {
  groupKey: AssetGroupKey;
  links: MediaLink[];
}) {
  const lightbox = useLightbox();
  const containerRef = useRef<HTMLDivElement>(null);
  if (links.length === 0) return null;
  const isAudio = groupKey === 'audio_input';

  function openAt(index: number) {
    if (isAudio) return;
    const images = links.filter((l) => Boolean(l.url)).map((l) => ({ id: l.id, url: l.url }));
    if (images.length === 0) return;
    lightbox.open({
      images,
      initialIndex: index,
      triggerRef: containerRef,
    });
  }

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: the click handler only stops bubbling so the parent card's onEdit doesn't fire; the inner thumb buttons handle their own keyboard activation
    <div ref={containerRef} className="flex flex-col gap-1" onClick={(e) => e.stopPropagation()}>
      <span className="text-[10px] uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
        {ASSET_GROUP_LABEL[groupKey]}
      </span>
      <div className="flex flex-wrap gap-1.5">
        {links.map((link, idx) =>
          isAudio ? (
            <span
              key={link.id}
              className="flex h-12 w-12 items-center justify-center rounded border border-[hsl(var(--border))] bg-[hsl(var(--muted))] text-[10px] text-[hsl(var(--muted-foreground))]"
              aria-label={`音频 ${link.mediaId}`}
            >
              音频
            </span>
          ) : (
            <button
              key={link.id}
              type="button"
              aria-label={`预览 ${ASSET_GROUP_LABEL[groupKey]} ${link.mediaId}`}
              onClick={() => openAt(idx)}
              className="h-12 w-12 overflow-hidden rounded border border-[hsl(var(--border))]"
            >
              <LazyImage src={link.url} alt={`${groupKey}-${link.mediaId}`} className="h-12 w-12" />
            </button>
          ),
        )}
      </div>
    </div>
  );
}

export type QuestionColumnProps = {
  item: BenchmarkItem;
  onEdit: () => void;
  onOpenComments: () => void;
  className?: string;
};

export function QuestionColumn({ item, onEdit, onOpenComments, className }: QuestionColumnProps) {
  const parts = titleParts(item);
  const chips = buildChips(item);
  const commentCount = item.commentCount ?? 0;

  return (
    <div className={cn('flex flex-col gap-2.5 p-4 min-w-0', className)}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span className="shrink-0 text-sm font-semibold text-[hsl(var(--muted-foreground))]">
            #{item.id}
          </span>
          {parts.length > 0 ? (
            <span
              className="truncate text-[15px] font-semibold text-[hsl(var(--foreground))]"
              title={parts.join(' · ')}
            >
              {parts.join(' · ')}
            </span>
          ) : null}
          {item.needsRevision ? (
            <Badge variant="destructive" className="shrink-0">
              待修改
            </Badge>
          ) : null}
        </div>
        <div className="flex shrink-0 gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={(e) => {
              e.stopPropagation();
              onOpenComments();
            }}
            aria-label={`评论 ${commentCount}`}
          >
            评论{commentCount > 0 ? ` ${commentCount}` : ''}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={(e) => {
              e.stopPropagation();
              onEdit();
            }}
          >
            编辑
          </Button>
        </div>
      </div>

      {chips.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {chips.map((chip) => (
            <ChipTag key={chip.key} chip={chip} />
          ))}
        </div>
      ) : null}

      {item.categoryDefinition?.trim() ? (
        <div className="rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--muted))] px-2.5 py-1.5 text-xs leading-relaxed text-[hsl(var(--muted-foreground))]">
          {item.categoryDefinition}
        </div>
      ) : null}

      {item.textPrompt?.trim() ? (
        <ExpandableText
          icon="📝"
          text={item.textPrompt}
          collapsedLines={2}
          ariaLabel="切换提示词"
          textClassName="text-sm leading-5"
        />
      ) : (
        <div className="text-xs text-[hsl(var(--muted-foreground))]">
          <span aria-hidden className="mr-1">
            📝
          </span>
          暂无提示词
        </div>
      )}

      {item.judgingCriteria?.trim() ? (
        <ExpandableText
          icon="📋"
          text={item.judgingCriteria}
          collapsedLines={1}
          ariaLabel="切换评判标准"
          textClassName="text-xs text-[hsl(var(--muted-foreground))]"
        />
      ) : null}

      <div className="mt-auto flex flex-wrap gap-3">
        <AssetGroup groupKey="character_image" links={item.media.character_image} />
        <AssetGroup groupKey="scene_image" links={item.media.scene_image} />
        <AssetGroup groupKey="prop_image" links={item.media.prop_image} />
        <AssetGroup groupKey="audio_input" links={item.media.audio_input} />
      </div>

      <div className="text-right text-[11px] text-[hsl(var(--muted-foreground))]">
        {formatRelativeTime(item.createdAt)}
      </div>
    </div>
  );
}
