import { Dialog } from '@base-ui/react/dialog';
import { type ReactNode, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';

export type ConfirmOptions = {
  title: string;
  body?: ReactNode;
  danger?: boolean;
  confirmText?: string;
  cancelText?: string;
};

type PendingConfirm = ConfirmOptions & {
  id: number;
  resolve: (result: boolean) => void;
};

// Module-level singleton queue. The host component subscribes to it via
// `confirmStore.subscribe` and renders whichever entry is currently at the
// head, so concurrent `confirm()` calls queue instead of stacking dialogs on
// top of each other.
let nextId = 1;
const queue: PendingConfirm[] = [];
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) listener();
}

const confirmStore = {
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  head(): PendingConfirm | null {
    return queue[0] ?? null;
  },
  enqueue(options: ConfirmOptions): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      queue.push({ ...options, id: nextId++, resolve });
      notify();
    });
  },
  resolveHead(result: boolean) {
    const entry = queue.shift();
    if (!entry) return;
    entry.resolve(result);
    notify();
  },
};

export function confirm(options: ConfirmOptions): Promise<boolean> {
  return confirmStore.enqueue(options);
}

// Test-only: clear queued confirms between tests so module state does not leak.
export function __resetConfirmQueueForTests() {
  while (queue.length > 0) {
    const entry = queue.shift();
    entry?.resolve(false);
  }
  notify();
}

export function ConfirmHost() {
  const [current, setCurrent] = useState<PendingConfirm | null>(() => confirmStore.head());

  useEffect(() => {
    const sync = () => setCurrent(confirmStore.head());
    const unsubscribe = confirmStore.subscribe(sync);
    sync();
    return unsubscribe;
  }, []);

  const open = current !== null;

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(nextOpen) => {
        // Any close intent that isn't a deliberate confirm = cancel:
        // backdrop click, ESC, focus-out, programmatic close.
        if (!nextOpen) confirmStore.resolveHead(false);
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/40 transition-opacity data-[ending-style]:opacity-0 data-[starting-style]:opacity-0" />
        <Dialog.Popup
          className="fixed left-1/2 top-1/2 z-50 w-[min(420px,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] p-6 shadow-xl outline-none transition-all data-[ending-style]:scale-95 data-[ending-style]:opacity-0 data-[starting-style]:scale-95 data-[starting-style]:opacity-0"
        >
          <Dialog.Title className="text-base font-semibold tracking-tight text-[hsl(var(--foreground))]">
            {current?.title ?? ''}
          </Dialog.Title>
          {current?.body !== undefined && current?.body !== null ? (
            <Dialog.Description className="mt-2 text-sm text-[hsl(var(--muted-foreground))]">
              {current.body}
            </Dialog.Description>
          ) : null}
          <div className="mt-6 flex items-center justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => confirmStore.resolveHead(false)}
            >
              {current?.cancelText ?? '取消'}
            </Button>
            <Button
              type="button"
              variant={current?.danger ? 'destructive' : 'default'}
              size="sm"
              onClick={() => confirmStore.resolveHead(true)}
            >
              {current?.confirmText ?? '确定'}
            </Button>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
