import { cn } from '@/lib/utils';
import { useState } from 'react';

// Legacy parity: an icon-prefixed gray box that clamps to N lines and toggles
// between 展开 / 收起. Click anywhere inside toggles, matching the legacy block
// that wrapped the whole gray panel in a single onClick handler.

export type ExpandableTextProps = {
  icon: string;
  text: string;
  collapsedLines: 1 | 2;
  textClassName?: string;
  className?: string;
  ariaLabel?: string;
};

const CLAMP_CLASS: Record<1 | 2, string> = {
  1: 'line-clamp-1',
  2: 'line-clamp-2',
};

export function ExpandableText({
  icon,
  text,
  collapsedLines,
  textClassName,
  className,
  ariaLabel,
}: ExpandableTextProps) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div
      className={cn(
        'rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--muted))] px-2.5 py-2',
        className,
      )}
    >
      <div
        className={cn(
          'break-words text-[hsl(var(--foreground))]',
          expanded ? 'whitespace-pre-wrap' : CLAMP_CLASS[collapsedLines],
          textClassName,
        )}
      >
        <span aria-hidden className="mr-1 text-[hsl(var(--muted-foreground))]">
          {icon}
        </span>
        {text}
      </div>
      <button
        type="button"
        aria-label={ariaLabel}
        aria-expanded={expanded}
        onClick={(e) => {
          e.stopPropagation();
          setExpanded((v) => !v);
        }}
        className="mt-0.5 text-xs text-[hsl(var(--primary))] hover:underline"
      >
        {expanded ? '收起' : '展开'}
      </button>
    </div>
  );
}
