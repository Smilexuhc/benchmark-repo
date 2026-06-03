import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '@/components/ui/button';
import {
  LightboxContext,
  type LightboxApi,
  type LightboxImage,
  type LightboxImageId,
  type LightboxOpenOptions,
} from '@/lib/lightbox-context';
import { cn } from '@/lib/utils';

type LightboxState = {
  open: boolean;
  images: LightboxImage[];
  index: number;
  coverImageId: LightboxImageId | null;
  onSetCover: ((id: LightboxImageId) => void) | null;
  onDownload: ((image: LightboxImage) => void) | null;
  triggerEl: HTMLElement | null;
  triggerRectAtOpen: { top: number; left: number } | null;
};

const CLOSED: LightboxState = {
  open: false,
  images: [],
  index: 0,
  coverImageId: null,
  onSetCover: null,
  onDownload: null,
  triggerEl: null,
  triggerRectAtOpen: null,
};

function findScrollableAncestor(el: HTMLElement | null): HTMLElement | null {
  let node: HTMLElement | null = el?.parentElement ?? null;
  while (node) {
    const style = window.getComputedStyle(node);
    const overflowY = style.overflowY;
    if (
      (overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay') &&
      node.scrollHeight > node.clientHeight
    ) {
      return node;
    }
    node = node.parentElement;
  }
  return null;
}

function restoreScrollAnchor(
  triggerEl: HTMLElement,
  rectAtOpen: { top: number; left: number },
): void {
  const currentRect = triggerEl.getBoundingClientRect();
  const delta = currentRect.top - rectAtOpen.top;
  if (delta === 0) return;
  const ancestor = findScrollableAncestor(triggerEl);
  if (ancestor) {
    ancestor.scrollTop += delta;
  } else {
    window.scrollBy(0, delta);
  }
}

export function LightboxProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<LightboxState>(CLOSED);

  const open = useCallback((options: LightboxOpenOptions) => {
    const { images, initialIndex = 0, onSetCover, onDownload, triggerRef } = options;
    if (images.length === 0) return;
    const triggerEl = triggerRef?.current ?? null;
    const rect = triggerEl?.getBoundingClientRect();
    const triggerRectAtOpen = rect ? { top: rect.top, left: rect.left } : null;
    const clamped = Math.max(0, Math.min(initialIndex, images.length - 1));
    const initialCover = images.find((img) => img.isCover)?.id ?? null;
    setState({
      open: true,
      images,
      index: clamped,
      coverImageId: initialCover,
      onSetCover: onSetCover ?? null,
      onDownload: onDownload ?? null,
      triggerEl,
      triggerRectAtOpen,
    });
  }, []);

  const close = useCallback(() => {
    setState((prev) => {
      if (!prev.open) return prev;
      const { triggerEl, triggerRectAtOpen } = prev;
      // Defer scroll + focus restore until after the lightbox unmounts and
      // layout has settled, otherwise the trigger's bounding rect can still
      // reflect the open-state DOM.
      queueMicrotask(() => {
        if (triggerEl && triggerRectAtOpen) {
          restoreScrollAnchor(triggerEl, triggerRectAtOpen);
        }
        if (triggerEl && typeof triggerEl.focus === 'function') {
          triggerEl.focus({ preventScroll: true });
        }
      });
      return CLOSED;
    });
  }, []);

  const api = useMemo<LightboxApi>(() => ({ open, close }), [open, close]);

  const goPrev = useCallback(() => {
    setState((p) => ({ ...p, index: Math.max(0, p.index - 1) }));
  }, []);

  const goNext = useCallback(() => {
    setState((p) => ({ ...p, index: Math.min(p.images.length - 1, p.index + 1) }));
  }, []);

  const setCurrentAsCover = useCallback(() => {
    setState((p) => {
      if (!p.onSetCover) return p;
      const current = p.images[p.index];
      if (!current) return p;
      p.onSetCover(current.id);
      return { ...p, coverImageId: current.id };
    });
  }, []);

  const handleDownload = useCallback(() => {
    const current = state.images[state.index];
    if (!current) return;
    if (state.onDownload) {
      state.onDownload(current);
    } else {
      window.open(current.url, '_blank', 'noopener,noreferrer');
    }
  }, [state.images, state.index, state.onDownload]);

  useEffect(() => {
    if (!state.open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        goPrev();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        goNext();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [state.open, close, goPrev, goNext]);

  return (
    <LightboxContext.Provider value={api}>
      {children}
      {state.open
        ? createPortal(
            <LightboxView
              state={state}
              onClose={close}
              onPrev={goPrev}
              onNext={goNext}
              onSetCover={setCurrentAsCover}
              onDownload={handleDownload}
            />,
            document.body,
          )
        : null}
    </LightboxContext.Provider>
  );
}

type LightboxViewProps = {
  state: LightboxState;
  onClose: () => void;
  onPrev: () => void;
  onNext: () => void;
  onSetCover: () => void;
  onDownload: () => void;
};

function LightboxView({
  state,
  onClose,
  onPrev,
  onNext,
  onSetCover,
  onDownload,
}: LightboxViewProps) {
  const { images, index, coverImageId, onSetCover: setCoverCb } = state;
  const total = images.length;
  const current = images[index];
  if (!current) return null;
  const isCurrentCover = coverImageId === current.id;
  const showSetCover = setCoverCb != null;

  return (
    <div
      // biome-ignore lint/a11y/useSemanticElements: overlay div pattern matches drawer.tsx; <dialog>.showModal needs an effect
      role="dialog"
      aria-modal="true"
      aria-label="图片预览"
      className="fixed inset-0 z-50"
    >
      <button
        type="button"
        aria-label="关闭预览"
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-black/80"
      />

      <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-10">
        <img
          src={current.url}
          alt={`图片 ${index + 1} / ${total}`}
          className="pointer-events-auto max-h-full max-w-full object-contain"
        />
      </div>

      <div className="pointer-events-none absolute inset-x-0 top-0 flex justify-end gap-2 p-3">
        {showSetCover ? (
          isCurrentCover ? (
            <span className="pointer-events-auto rounded-md border border-white/30 px-3 py-1 text-xs text-white/80">
              当前默认图
            </span>
          ) : (
            <Button
              size="sm"
              variant="outline"
              onClick={onSetCover}
              className="pointer-events-auto border-white/40 bg-transparent text-white hover:bg-white/10 hover:text-white"
            >
              设为默认图
            </Button>
          )
        ) : null}
        <Button
          size="sm"
          variant="outline"
          onClick={onDownload}
          className="pointer-events-auto border-white/40 bg-transparent text-white hover:bg-white/10 hover:text-white"
        >
          下载
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={onClose}
          aria-label="关闭"
          className="pointer-events-auto text-white hover:bg-white/10 hover:text-white"
        >
          ×
        </Button>
      </div>

      {/* Side arrows + bottom counter, matching legacy AntD Image.PreviewGroup
          shape (left arrow on the left edge, right arrow on the right edge,
          both vertically centered). */}
      <button
        type="button"
        onClick={onPrev}
        disabled={index === 0}
        aria-label="上一张"
        className={cn(
          'pointer-events-auto absolute left-4 top-1/2 z-10 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-black/40 text-2xl leading-none text-white transition hover:bg-black/60',
          index === 0 && 'cursor-not-allowed opacity-30 hover:bg-black/40',
        )}
      >
        ‹
      </button>
      <button
        type="button"
        onClick={onNext}
        disabled={index === total - 1}
        aria-label="下一张"
        className={cn(
          'pointer-events-auto absolute right-4 top-1/2 z-10 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-black/40 text-2xl leading-none text-white transition hover:bg-black/60',
          index === total - 1 && 'cursor-not-allowed opacity-30 hover:bg-black/40',
        )}
      >
        ›
      </button>

      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center justify-center p-4">
        <span
          className="pointer-events-auto rounded-full bg-black/40 px-3 py-1 text-sm text-white tabular-nums"
          aria-label="counter"
        >
          {index + 1} / {total}
        </span>
      </div>
    </div>
  );
}
