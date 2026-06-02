import { cn } from '@/lib/utils';

export type AiLinkProps = {
  children: React.ReactNode;
  busy?: boolean;
  disabled?: boolean;
  busyLabel?: React.ReactNode;
  onClick: () => void | Promise<void>;
  title?: string;
  className?: string;
  ariaLabel?: string;
};

/**
 * Inline text-link button used in section/field headers — `AI 填入字段`,
 * `AI 生成`, `复制`. Visually a link, semantically a button. Lives next to
 * the section label rather than as a bottom toolbar so each action is
 * anchored to the field it acts on.
 *
 * `ariaLabel` defaults to the rendered children when they are a string so
 * the button has a stable accessible name even when nested under a <label>
 * (where dom-accessibility-api otherwise rolls the label text into the
 * button's accessible name).
 */
export function AiLink({
  children,
  busy,
  disabled,
  busyLabel,
  onClick,
  title,
  className,
  ariaLabel,
}: AiLinkProps) {
  const accessibleLabel = ariaLabel ?? (typeof children === 'string' ? children : undefined);
  return (
    <button
      type="button"
      onClick={() => onClick()}
      disabled={disabled || busy}
      title={title}
      aria-label={accessibleLabel}
      className={cn(
        'text-xs font-medium text-[hsl(var(--primary))] underline-offset-2 hover:underline disabled:cursor-not-allowed disabled:opacity-50 disabled:no-underline',
        className,
      )}
    >
      {busy ? (busyLabel ?? '处理中…') : children}
    </button>
  );
}
