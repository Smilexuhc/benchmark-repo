import { toast } from '@/components/feedback';
import { cn } from '@/lib/utils';
import { type RouterOutputs, trpc } from '@/lib/trpc';
import { scoreColorClasses } from './scoreColor';

type BenchmarkItem = RouterOutputs['benchmark']['list']['items'][number];

const MODEL_NAME = 'Seedance';

const SCORE_BUTTONS: { value: number | null; label: string }[] = [
  { value: null, label: '未评分' },
  { value: 0, label: '0' },
  { value: 1, label: '1' },
  { value: 2, label: '2' },
  { value: 3, label: '3' },
  { value: 4, label: '4' },
  { value: 5, label: '5' },
];

function OutputVideo({ url }: { url: string }) {
  return (
    <video
      src={url}
      controls
      muted
      playsInline
      preload="metadata"
      className="h-full w-full object-contain"
    />
  );
}

// Legacy parity: screen_size drives the video aspect ratio. Match the legacy
// helper's tolerance of full-width / fullwidth colons and stray whitespace so
// rows written from the legacy admin still render correctly.
function screenSizeToAspect(screenSize: string): string {
  const s = (screenSize || '').replace(/[：﹕]/g, ':').replace(/\s+/g, '');
  if (s === '9:16') return '9 / 16';
  if (s.startsWith('2.39')) return '2.39 / 1';
  return '16 / 9';
}

function formatExpectedVideoTime(seconds: number | null): string | null {
  if (seconds === null) return null;
  if (seconds < 60) return `${seconds}秒`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest === 0 ? `${minutes}分钟` : `${minutes}分${rest}秒`;
}

export type OutputColumnProps = {
  item: BenchmarkItem;
  className?: string;
};

export function OutputColumn({ item, className }: OutputColumnProps) {
  const utils = trpc.useUtils();
  const setScore = trpc.benchmark.setScore.useMutation({
    onError(err: { message: string }) {
      toast.error(err.message || '评分更新失败');
      utils.benchmark.list.invalidate();
    },
    onSettled() {
      utils.benchmark.list.invalidate();
    },
  });
  const videoUrl = item.media.video_output[0]?.url ?? null;
  const aspect = screenSizeToAspect(item.screenSize ?? '');
  const score = item.score;
  const scoreLabel = score === null ? '未评分' : `评分 ${score}/5`;
  const expectedVideoTime = formatExpectedVideoTime(item.expectedVideoTimeInSec);

  function applyScore(next: number | null) {
    if (next === score) return;
    setScore.mutate({ id: item.id, score: next });
  }

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: the click handler only stops bubbling so the parent card's onEdit doesn't fire; keyboard users interact with the radio/buttons below
    <div
      className={cn('flex min-w-0 flex-col gap-3 bg-[hsl(var(--muted))]/40 p-4', className)}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-center justify-between gap-2 border-b border-[hsl(var(--border))] pb-1.5 text-sm font-semibold text-[hsl(var(--muted-foreground))]">
        <span>{MODEL_NAME}</span>
        {expectedVideoTime ? (
          <span className="rounded bg-[hsl(var(--background))] px-1.5 py-0.5 text-xs font-medium text-[hsl(var(--foreground))]">
            视频时长 {expectedVideoTime}
          </span>
        ) : null}
      </div>

      {/* Legacy caps the video's long side at 200px (see VIDEO_LONG_SIDE in
          frontend/src/components/BenchmarkItemsPage.tsx). For 9:16 portrait,
          the long side is height; for everything else (16:9, 2.39:1), the
          long side is width. */}
      <div
        className="overflow-hidden rounded bg-black"
        style={
          aspect === '9 / 16'
            ? { aspectRatio: aspect, height: 200, width: 'auto' }
            : { aspectRatio: aspect, width: 200, height: 'auto' }
        }
      >
        {videoUrl ? (
          <OutputVideo url={videoUrl} />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-xs text-white/70">
            待生成
          </div>
        )}
      </div>

      <div
        className={cn(
          'rounded-md border px-3 py-2 text-sm font-semibold',
          scoreColorClasses(score),
        )}
        aria-label="评分汇总"
      >
        {scoreLabel}
      </div>

      <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="评分">
        {SCORE_BUTTONS.map((opt) => {
          const active = opt.value === score;
          return (
            <button
              key={opt.label}
              type="button"
              // biome-ignore lint/a11y/useSemanticElements: native radio inputs don't accept tailwind utility classes the same way; the segmented-button pattern matches the legacy frontend's score chooser
              role="radio"
              aria-checked={active}
              onClick={() => applyScore(opt.value)}
              disabled={setScore.isPending}
              className={cn(
                'rounded-md border px-2.5 py-1 text-xs font-medium transition-colors',
                'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[hsl(var(--ring))]',
                'disabled:cursor-not-allowed disabled:opacity-60',
                active
                  ? 'border-[hsl(var(--primary))] bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]'
                  : 'border-[hsl(var(--border))] bg-[hsl(var(--background))] text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))]',
              )}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
