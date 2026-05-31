import { create } from 'zustand';
import { combine } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';
import { trpcClient } from '@/lib/trpc';

export type BatchStatus = 'idle' | 'running' | 'complete' | 'error';
export type ItemResult =
  | { status: 'pending' }
  | { status: 'done'; imageKey?: string }
  | { status: 'failed'; error: string };

type State = {
  status: BatchStatus;
  pending: number[];
  results: Record<number, ItemResult>;
  startedAt: number | null;
  errorMessage: string | null;
};

const INITIAL: State = {
  status: 'idle',
  pending: [],
  results: {},
  startedAt: null,
  errorMessage: null,
};

export const useBatchRegenerateStore = create(
  immer(
    combine(INITIAL, (set, get) => ({
      reset() {
        set(() => INITIAL);
      },

      async start(ids: number[]) {
        if (ids.length === 0) return;
        set((s) => {
          s.status = 'running';
          s.pending = [...ids];
          s.results = Object.fromEntries(ids.map((id) => [id, { status: 'pending' } as ItemResult]));
          s.startedAt = Date.now();
          s.errorMessage = null;
        });
        await runSubscription(ids);
      },

      async retryFailed() {
        const failed = Object.entries(get().results)
          .filter(([, r]) => r.status === 'failed')
          .map(([id]) => Number(id));
        if (failed.length === 0) return;
        set((s) => {
          s.status = 'running';
          s.pending = failed;
          for (const id of failed) s.results[id] = { status: 'pending' };
          s.errorMessage = null;
        });
        await runSubscription(failed);
      },

      recordResult(id: number, result: ItemResult) {
        set((s) => {
          s.results[id] = result;
          if (result.status !== 'pending') {
            s.pending = s.pending.filter((x) => x !== id);
          }
        });
      },
    })),
  ),
);

async function runSubscription(ids: number[]): Promise<void> {
  // Use vanilla trpc client (no React deps) per playbook §5.10.
  // Manual-Set resumption: re-subscribe with only the unfinished ids if stream ends early.
  let remaining = [...ids];
  while (remaining.length > 0) {
    const round = remaining;
    let observedAny = false;
    try {
      const iter = await trpcClient.ai.batchRegenerate.subscribe(
        { ids: round },
        {},
      ) as unknown as AsyncIterable<{
        id: number;
        status: 'pending' | 'done' | 'failed';
        imageKey?: string;
        error?: string;
      }>;
      for await (const event of iter) {
        observedAny = true;
        if (event.status === 'pending') {
          useBatchRegenerateStore.getState().recordResult(event.id, { status: 'pending' });
        } else if (event.status === 'done') {
          useBatchRegenerateStore.getState().recordResult(event.id, {
            status: 'done',
            ...(event.imageKey !== undefined ? { imageKey: event.imageKey } : {}),
          });
        } else {
          useBatchRegenerateStore.getState().recordResult(event.id, {
            status: 'failed',
            error: event.error ?? 'unknown error',
          });
        }
      }
    } catch (err) {
      useBatchRegenerateStore.setState((s) => {
        s.errorMessage = err instanceof Error ? err.message : String(err);
      });
    }

    // Re-derive remaining from the store (still-pending ids)
    const stillPending = useBatchRegenerateStore.getState().pending;
    if (!observedAny || stillPending.length === 0) {
      remaining = [];
      break;
    }
    remaining = stillPending;
  }

  useBatchRegenerateStore.setState((s) => {
    s.status =
      Object.values(s.results).some((r) => r.status === 'failed') && s.pending.length === 0
        ? 'complete'
        : s.pending.length === 0
          ? 'complete'
          : s.errorMessage
            ? 'error'
            : 'complete';
  });
}
