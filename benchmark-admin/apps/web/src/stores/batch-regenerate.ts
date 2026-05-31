import { create } from 'zustand';
import { combine } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';
import { trpcClient } from '@/lib/trpc';

export type BatchStatus = 'idle' | 'running' | 'complete' | 'error' | 'cancelled';
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
  // batchKey is the per-run idempotency key sent to the server. The same key is
  // reused across resubscribes so the server can dedupe ids it already finished
  // (P0-2). retryFailed() rolls a new key — a retry is intentionally a fresh run.
  batchKey: string | null;
};

const INITIAL: State = {
  status: 'idle',
  pending: [],
  results: {},
  startedAt: null,
  errorMessage: null,
  batchKey: null,
};

// Module-singleton subscription controller. Only one in-flight run at a time;
// start()/retryFailed() abort any prior run before mutating state.
let currentController: AbortController | null = null;

function newBatchKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Fallback for environments without crypto.randomUUID (e.g. some jsdom configs).
  return `batch-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export const useBatchRegenerateStore = create(
  immer(
    combine(INITIAL, (set, get) => ({
      reset() {
        currentController?.abort();
        currentController = null;
        set(() => INITIAL);
      },

      cancel() {
        if (!currentController) return;
        currentController.abort();
        currentController = null;
        set((s) => {
          s.status = 'cancelled';
        });
      },

      async start(ids: number[]) {
        if (ids.length === 0) return;
        // Abort any prior in-flight run so two starts can't race writes into
        // shared pending/results (P0-1).
        currentController?.abort();
        const controller = new AbortController();
        currentController = controller;

        const batchKey = newBatchKey();
        set((s) => {
          s.status = 'running';
          s.pending = [...ids];
          s.results = Object.fromEntries(
            ids.map((id) => [id, { status: 'pending' } as ItemResult]),
          );
          s.startedAt = Date.now();
          s.errorMessage = null;
          s.batchKey = batchKey;
        });
        await runSubscription(ids, batchKey, controller);
      },

      async retryFailed() {
        const failed = Object.entries(get().results)
          .filter(([, r]) => r.status === 'failed')
          .map(([id]) => Number(id));
        if (failed.length === 0) return;
        currentController?.abort();
        const controller = new AbortController();
        currentController = controller;

        // Fresh key: a retry is a deliberate regeneration and must NOT be
        // deduped against the previous batch's completed ids on the server.
        const batchKey = newBatchKey();
        set((s) => {
          s.status = 'running';
          s.pending = failed;
          for (const id of failed) s.results[id] = { status: 'pending' };
          s.errorMessage = null;
          s.batchKey = batchKey;
        });
        await runSubscription(failed, batchKey, controller);
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

// Bound how many times we re-subscribe for the same still-pending ids. A
// stream that only ever emits `pending` (never transitions an id to done/failed)
// would otherwise keep `observedAny=true` and re-subscribe forever. We stop once
// a full round makes no forward progress, capped by MAX_RESUBSCRIBE_ROUNDS as a
// hard backstop, and mark the stuck ids failed so the UI doesn't hang.
const MAX_RESUBSCRIBE_ROUNDS = 5;

async function runSubscription(
  ids: number[],
  batchKey: string,
  controller: AbortController,
): Promise<void> {
  let remaining = [...ids];
  let rounds = 0;
  while (remaining.length > 0) {
    if (controller.signal.aborted) return;
    if (rounds >= MAX_RESUBSCRIBE_ROUNDS) break;
    rounds += 1;
    const round = remaining;
    const roundPendingBefore = round.length;
    let observedAny = false;
    try {
      const iter = (await trpcClient.ai.batchRegenerate.subscribe(
        { ids: round, batchKey },
        { signal: controller.signal },
      )) as unknown as AsyncIterable<{
        id: number;
        status: 'pending' | 'done' | 'failed';
        imageKey?: string;
        error?: string;
      }>;
      for await (const event of iter) {
        if (controller.signal.aborted) return;
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
      // AbortError from controller.abort() is intentional teardown — not an error.
      if (controller.signal.aborted) return;
      const message = err instanceof Error ? err.message : String(err);
      useBatchRegenerateStore.setState((s) => {
        s.errorMessage = message;
      });
    }

    const stillPending = useBatchRegenerateStore.getState().pending;
    // Stop if the stream produced nothing, everything finished, OR this round
    // made no forward progress (an id stuck emitting only `pending`). Otherwise
    // a pending-only stream would re-subscribe indefinitely.
    const roundPending = stillPending.filter((id) => round.includes(id));
    const madeProgress = roundPending.length < roundPendingBefore;
    if (!observedAny || stillPending.length === 0 || !madeProgress) {
      remaining = [];
      break;
    }
    remaining = stillPending;
  }

  if (controller.signal.aborted) return;

  // Any ids still pending after we stop re-subscribing are stuck (the stream
  // never transitioned them out of `pending`). Fail them so the UI resolves
  // instead of hanging on a permanent "进行中" state.
  const stuck = useBatchRegenerateStore.getState().pending;
  if (stuck.length > 0) {
    for (const id of stuck) {
      useBatchRegenerateStore.getState().recordResult(id, {
        status: 'failed',
        error: '重生成超时（未在限定重试次数内完成）',
      });
    }
  }

  // Mark complete/error from a single status derivation. The run is complete
  // when nothing is still pending; otherwise we hit a transport error.
  useBatchRegenerateStore.setState((s) => {
    if (s.pending.length === 0) {
      s.status = s.errorMessage ? 'error' : 'complete';
    } else if (s.errorMessage) {
      s.status = 'error';
    }
  });

  if (currentController === controller) currentController = null;
}
