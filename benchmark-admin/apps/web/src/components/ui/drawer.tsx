import { useEffect } from 'react';
import { cn } from '@/lib/utils';

type DrawerProps = {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  side?: 'right' | 'bottom';
  widthClassName?: string;
};

export function Drawer({
  open,
  onClose,
  title,
  children,
  side = 'right',
  widthClassName = 'w-[480px] max-w-full',
}: DrawerProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const panel =
    side === 'right'
      ? cn('absolute right-0 top-0 h-full overflow-y-auto', widthClassName)
      : 'absolute left-0 bottom-0 w-full max-h-[90%] overflow-y-auto';

  return (
    <div
      // biome-ignore lint/a11y/useSemanticElements: native <dialog> + showModal needs an effect; this overlay div pattern composes with focus + nuqs adapters as-is
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-50"
    >
      <button
        type="button"
        aria-label="Close drawer overlay"
        onClick={onClose}
        className="absolute inset-0 bg-black/30"
      />
      <div className={cn('bg-[hsl(var(--background))] shadow-lg', panel)}>
        {title ? (
          <header className="flex items-center justify-between border-b border-[hsl(var(--border))] px-6 py-4">
            <h2 className="text-base font-semibold tracking-tight">{title}</h2>
            <button
              type="button"
              onClick={onClose}
              className="rounded p-1 text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))]"
              aria-label="Close"
            >
              ×
            </button>
          </header>
        ) : null}
        <div className="px-6 py-4">{children}</div>
      </div>
    </div>
  );
}
