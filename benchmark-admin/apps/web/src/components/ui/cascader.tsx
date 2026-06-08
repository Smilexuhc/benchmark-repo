import { cn } from '@/lib/utils';
import type { CategoryOption } from '@benchmark-admin/shared/benchmark/categoryTree';
import { useCallback, useEffect, useId, useRef, useState } from 'react';

// Shared N-level cascader (U8 + U9). The trigger shows the current path
// ("L1 / L2 / L3"); clicking it opens a popover with one column per depth so
// the user can step into children. Leaf clicks (or Enter on a leaf) commit a
// full path and close the popover. Hovering an interior row updates the
// active path so the next column shows that node's children, matching the
// legacy AntD Cascader feel.
//
// Counts: if a node's label is already suffixed with " (N)" by the caller
// (see `cascader.helpers.ts > buildCascaderOptionsWithCounts`) it just
// renders — the cascader itself doesn't compute counts.

export type CascaderOption = CategoryOption;

export type CascaderProps = {
  options: CascaderOption[];
  // Current selected path of `value`s, one per depth. Empty/short = nothing
  // selected at that depth or below.
  value: string[];
  // Fires when the user picks a leaf. `path` is the value chain, `labels` is
  // the matching display labels (handy for the trigger / for storing
  // `categoryDefinition`).
  onChange: (path: string[], labels: string[], leaf: CascaderOption) => void;
  placeholder?: string;
  // Optional aria-label for the trigger button.
  ariaLabel?: string;
  // Display separator between path labels on the trigger.
  separator?: string;
  className?: string;
  disabled?: boolean;
  // Optional controlled open state. Pass both `open` and `onOpenChange` to let
  // the parent drive open/close — needed so callers can force-close after a
  // commit when a browser-specific quirk (seen on Edge) keeps the internal
  // setOpen(false) from taking effect.
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
};

function pathLabels(options: CascaderOption[], path: string[]): string[] {
  const labels: string[] = [];
  let level: CascaderOption[] | undefined = options;
  for (const v of path) {
    const node: CascaderOption | undefined = level?.find((o) => o.value === v);
    if (!node) break;
    labels.push(node.label);
    level = node.children;
  }
  return labels;
}

export function Cascader({
  options,
  value,
  onChange,
  placeholder = '—',
  ariaLabel,
  separator = ' / ',
  className,
  disabled,
  open: openProp,
  onOpenChange,
}: CascaderProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const isControlled = openProp !== undefined;
  const open = isControlled ? openProp : internalOpen;
  const setOpen = useCallback(
    (next: boolean | ((prev: boolean) => boolean)) => {
      const resolved = typeof next === 'function' ? next(open) : next;
      if (!isControlled) setInternalOpen(resolved);
      onOpenChange?.(resolved);
    },
    [isControlled, onOpenChange, open],
  );
  // `active` is the row currently highlighted in each column. It starts as a
  // copy of `value` so the popover opens already focused on the current path.
  const [active, setActive] = useState<string[]>(value);
  const rootRef = useRef<HTMLDivElement>(null);
  const popoverId = useId();

  useEffect(() => {
    setActive(value);
  }, [value]);

  // Close on outside click + Escape.
  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, setOpen]);

  // Walk `active` to produce one column per depth that still has options. We
  // always show at least the root column so the user can pick from L1.
  const columns: CascaderOption[][] = [options];
  for (let i = 0; i < active.length; i++) {
    const col = columns[i];
    const node = col?.find((o) => o.value === active[i]);
    if (node?.children?.length) columns.push(node.children);
    else break;
  }

  const labels = pathLabels(options, value);
  const triggerText = labels.length > 0 ? labels.join(separator) : placeholder;

  const commitLeaf = useCallback(
    (path: string[]) => {
      // Always close on a leaf commit — even if path-walking fails we want the
      // popup gone, otherwise the user is stuck having to click outside.
      setOpen(false);
      const lbls = pathLabels(options, path);
      // Walk to the leaf node so onChange can hand back the full CategoryOption
      // (callers use this to read .definition etc.)
      let level: CascaderOption[] | undefined = options;
      let leaf: CascaderOption | undefined;
      for (const v of path) {
        leaf = level?.find((o) => o.value === v);
        level = leaf?.children;
      }
      if (!leaf) return;
      onChange(path, lbls, leaf);
    },
    [options, onChange, setOpen],
  );

  function onRowClick(depth: number, opt: CascaderOption) {
    const nextActive = [...active.slice(0, depth), opt.value];
    setActive(nextActive);
    if (!opt.children || opt.children.length === 0) {
      commitLeaf(nextActive);
    }
  }

  function focusRow(depth: number, value: string) {
    // Defer so the row exists in the DOM after the state-driven re-render.
    queueMicrotask(() => {
      const el = rootRef.current?.querySelector<HTMLButtonElement>(
        `[data-cascader-row="${depth}-${value}"]`,
      );
      el?.focus();
    });
  }

  function onRowKeyDown(e: React.KeyboardEvent, depth: number, idx: number, opt: CascaderOption) {
    const col = columns[depth] ?? [];
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const next = col[Math.min(col.length - 1, idx + 1)];
      if (next) {
        setActive([...active.slice(0, depth), next.value]);
        focusRow(depth, next.value);
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const prev = col[Math.max(0, idx - 1)];
      if (prev) {
        setActive([...active.slice(0, depth), prev.value]);
        focusRow(depth, prev.value);
      }
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      if (opt.children?.length) {
        const first = opt.children[0];
        if (first) {
          setActive([...active.slice(0, depth), opt.value, first.value]);
          focusRow(depth + 1, first.value);
        }
      }
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      if (depth > 0) {
        const parent = active[depth - 1];
        setActive(active.slice(0, depth));
        if (parent) focusRow(depth - 1, parent);
      }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      onRowClick(depth, opt);
    }
  }

  // After the popover renders, focus the deepest active row so keyboard nav
  // continues from where the user was.
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on open+active
  useEffect(() => {
    if (!open) return;
    const deepest = active.length - 1;
    if (deepest < 0) return;
    const v = active[deepest];
    if (v) focusRow(deepest, v);
  }, [open]);

  return (
    <div ref={rootRef} className={cn('relative inline-block w-full', className)}>
      <button
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? popoverId : undefined}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'flex h-9 w-full items-center justify-between rounded-md border border-[hsl(var(--input))] bg-transparent px-3 py-1 text-left text-sm shadow-sm transition-colors',
          'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[hsl(var(--ring))]',
          'disabled:cursor-not-allowed disabled:opacity-50',
          labels.length === 0 && 'text-[hsl(var(--muted-foreground))]',
        )}
      >
        <span className="truncate">{triggerText}</span>
        <span aria-hidden className="ml-2 text-xs text-[hsl(var(--muted-foreground))]">
          ▾
        </span>
      </button>

      {open ? (
        <div
          id={popoverId}
          // biome-ignore lint/a11y/useSemanticElements: native <dialog>+showModal needs an effect; this anchored popover follows the project's existing Drawer pattern
          role="dialog"
          className="absolute left-0 top-full z-20 mt-1 flex max-h-72 overflow-hidden rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] shadow-md"
        >
          {columns.map((col, depth) => (
            <div
              // The depth=0 column is the root; deeper columns are keyed by the
              // active parent value, so React reconciles columns correctly as
              // the user walks the tree.
              key={depth === 0 ? '__root__' : (active[depth - 1] ?? `__d${depth}__`)}
              // biome-ignore lint/a11y/useSemanticElements: <select> is the wrong widget — this is a custom multi-column listbox composing into a cascader
              role="listbox"
              tabIndex={-1}
              aria-label={`分类层级 ${depth + 1}`}
              className="min-w-[12rem] max-w-[16rem] overflow-y-auto border-r border-[hsl(var(--border))] last:border-r-0"
            >
              {col.map((opt, idx) => {
                const isActive = active[depth] === opt.value;
                const isSelected = value[depth] === opt.value;
                const hasChildren = (opt.children?.length ?? 0) > 0;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    // biome-ignore lint/a11y/useSemanticElements: <option> is only valid inside <select>; this is the correct WAI-ARIA pattern for a custom listbox row
                    role="option"
                    data-cascader-row={`${depth}-${opt.value}`}
                    aria-selected={isSelected}
                    onMouseEnter={() => setActive([...active.slice(0, depth), opt.value])}
                    onFocus={() => setActive([...active.slice(0, depth), opt.value])}
                    // Pre-commit on pointer-down: some Windows Edge builds drop
                    // the subsequent click event when the cascader popup lives
                    // inside an aria-modal Drawer, leaving the panel open. Firing
                    // here guarantees onChange runs before the click is lost.
                    onPointerDown={(e) => {
                      if (e.button !== 0) return;
                      onRowClick(depth, opt);
                    }}
                    onClick={() => onRowClick(depth, opt)}
                    onKeyDown={(e) => onRowKeyDown(e, depth, idx, opt)}
                    className={cn(
                      'flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-sm',
                      isActive
                        ? 'bg-[hsl(var(--muted))]'
                        : 'hover:bg-[hsl(var(--muted))] focus-visible:bg-[hsl(var(--muted))]',
                      isSelected && 'font-medium text-[hsl(var(--primary))]',
                      'focus-visible:outline-none',
                    )}
                  >
                    <span className="truncate">{opt.label}</span>
                    {hasChildren ? (
                      <span aria-hidden className="text-xs text-[hsl(var(--muted-foreground))]">
                        ›
                      </span>
                    ) : null}
                  </button>
                );
              })}
              {col.length === 0 ? (
                <p className="px-3 py-2 text-xs text-[hsl(var(--muted-foreground))]">无</p>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
