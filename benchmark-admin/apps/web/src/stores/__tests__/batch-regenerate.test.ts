/**
 * Tests for the batch-regenerate Zustand store.
 *
 * Covers the P0 fixes from JUJ-22:
 *  - P0-1: an AbortController is threaded through `subscribe()` so cancel /
 *    unmount actually stops the SSE stream, and start()/retryFailed() aborts
 *    any in-flight run before mutating state.
 *  - P0-2: a per-run `batchKey` is sent on every (re)subscribe so the server
 *    can dedupe completed ids on reconnect. `retryFailed()` rolls a new key
 *    so it is NOT deduped against the prior batch.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type BatchEvent = {
  id: number;
  status: 'pending' | 'done' | 'failed';
  imageKey?: string;
  error?: string;
};

type SubscribeCall = {
  input: { ids: number[]; batchKey: string };
  signal: AbortSignal | undefined;
  push: (event: BatchEvent) => void;
  end: () => void;
  ended: boolean;
};

const calls: SubscribeCall[] = [];

function makeControllableIter(call: Omit<SubscribeCall, 'push' | 'end' | 'ended'>): {
  iter: AsyncIterable<BatchEvent>;
  controls: Pick<SubscribeCall, 'push' | 'end' | 'ended'>;
} {
  const queue: BatchEvent[] = [];
  let resolveWait: (() => void) | null = null;
  let ended = false;

  const wait = () =>
    new Promise<void>((resolve) => {
      resolveWait = resolve;
    });

  const push = (event: BatchEvent) => {
    queue.push(event);
    resolveWait?.();
    resolveWait = null;
  };
  const end = () => {
    ended = true;
    resolveWait?.();
    resolveWait = null;
  };

  const iter: AsyncIterable<BatchEvent> = {
    async *[Symbol.asyncIterator]() {
      while (true) {
        // Honor abort signal so the store's controller.abort() actually exits
        // the for-await loop in production code.
        if (call.signal?.aborted) {
          const err = new Error('aborted');
          (err as Error & { name: string }).name = 'AbortError';
          throw err;
        }
        if (queue.length > 0) {
          const event = queue.shift();
          if (event) yield event;
          continue;
        }
        if (ended) return;
        // Wait for either a push, an abort, or end.
        const abortPromise = new Promise<void>((resolve) => {
          if (!call.signal) return;
          if (call.signal.aborted) return resolve();
          call.signal.addEventListener('abort', () => resolve(), { once: true });
        });
        await Promise.race([wait(), abortPromise]);
      }
    },
  };

  const controls = {
    push,
    end,
    get ended() {
      return ended;
    },
  };
  return { iter, controls };
}

vi.mock('@/lib/trpc', () => {
  return {
    trpcClient: {
      ai: {
        batchRegenerate: {
          subscribe: vi.fn(
            async (
              input: { ids: number[]; batchKey: string },
              opts: { signal?: AbortSignal } = {},
            ) => {
              const partial = { input, signal: opts.signal };
              const { iter, controls } = makeControllableIter(partial);
              const call: SubscribeCall = {
                ...partial,
                ...controls,
              };
              calls.push(call);
              return iter;
            },
          ),
        },
      },
    },
  };
});

// biome-ignore lint/suspicious/noExplicitAny: test helper
let store: any;

beforeEach(async () => {
  calls.length = 0;
  vi.resetModules();
  const mod = await import('../batch-regenerate');
  store = mod.useBatchRegenerateStore;
});

afterEach(() => {
  store?.getState().reset();
});

async function flush() {
  // Let microtasks settle so subscribe() promises resolve and the iterator
  // can drain queued events.
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
}

describe('batch-regenerate store', () => {
  it('sends a batchKey on subscribe and reuses it across resubscribes', async () => {
    void store.getState().start([1, 2]);
    await flush();

    expect(calls.length).toBe(1);
    const firstKey = calls[0]?.input.batchKey ?? '';
    expect(typeof firstKey).toBe('string');
    expect(firstKey.length).toBeGreaterThan(0);
    expect(calls[0]?.input.ids).toEqual([1, 2]);

    // Server marks id 1 done, then the stream ends abruptly (simulated drop).
    calls[0]?.push({ id: 1, status: 'done', imageKey: 'k1' });
    await flush();
    calls[0]?.end();
    await flush();

    // The store should resubscribe with only the still-pending id, reusing
    // the SAME batchKey so the server can dedupe.
    expect(calls.length).toBe(2);
    expect(calls[1]?.input.ids).toEqual([2]);
    expect(calls[1]?.input.batchKey).toBe(firstKey);

    calls[1]?.push({ id: 2, status: 'done', imageKey: 'k2' });
    calls[1]?.end();
    await flush();

    expect(store.getState().status).toBe('complete');
    expect(store.getState().pending).toEqual([]);
  });

  it('retryFailed() rolls a NEW batchKey so it is not deduped', async () => {
    void store.getState().start([1, 2]);
    await flush();
    const firstKey = calls[0]?.input.batchKey;

    calls[0]?.push({ id: 1, status: 'done', imageKey: 'k1' });
    calls[0]?.push({ id: 2, status: 'failed', error: 'AI down' });
    calls[0]?.end();
    await flush();

    expect(store.getState().status).toBe('complete');
    expect(store.getState().results[2]).toEqual({ status: 'failed', error: 'AI down' });

    void store.getState().retryFailed();
    await flush();

    expect(calls.length).toBe(2);
    expect(calls[1]?.input.ids).toEqual([2]);
    // CRITICAL: a retry is a deliberate fresh regeneration. If we reused the
    // first batch's key the server would replay the (now-stale) failure.
    expect(calls[1]?.input.batchKey).not.toBe(firstKey);
  });

  it('a second start() aborts the prior in-flight subscription (overlap guard)', async () => {
    void store.getState().start([1, 2]);
    await flush();
    expect(calls.length).toBe(1);
    expect(calls[0]?.signal?.aborted).toBe(false);

    void store.getState().start([10, 11]);
    await flush();

    expect(calls[0]?.signal?.aborted).toBe(true);
    expect(calls.length).toBe(2);
    expect(calls[1]?.input.ids).toEqual([10, 11]);
    expect(calls[1]?.input.batchKey).not.toBe(calls[0]?.input.batchKey);
    expect(store.getState().pending).toEqual([10, 11]);
  });

  it('cancel() aborts the controller (unmount cancellation path)', async () => {
    void store.getState().start([1, 2]);
    await flush();
    expect(calls[0]?.signal?.aborted).toBe(false);

    store.getState().cancel();
    await flush();

    expect(calls[0]?.signal?.aborted).toBe(true);
    expect(store.getState().status).toBe('cancelled');
  });

  it('caps re-subscribes when a stream only ever emits pending and fails the stuck id', async () => {
    void store.getState().start([5]);
    await flush();

    // Simulate a stream that keeps re-emitting `pending` for the same id and
    // then ends each round, making no forward progress. Without the round cap
    // this resubscribes forever; with the cap it bounds the rounds and then
    // marks the stuck id failed.
    let guard = 0;
    while (store.getState().pending.length > 0 && guard < 50) {
      const call = calls[calls.length - 1];
      call?.push({ id: 5, status: 'pending' });
      await flush();
      call?.end();
      await flush();
      guard += 1;
    }

    expect(store.getState().pending).toEqual([]);
    expect(store.getState().results[5]?.status).toBe('failed');
    // Bounded: not an unbounded number of subscribe calls.
    expect(calls.length).toBeLessThanOrEqual(6);
    expect(store.getState().status).toBe('complete');
  });

  it('reset() aborts in-flight and clears state', async () => {
    void store.getState().start([1]);
    await flush();
    expect(calls[0]?.signal?.aborted).toBe(false);

    store.getState().reset();
    await flush();

    expect(calls[0]?.signal?.aborted).toBe(true);
    expect(store.getState().status).toBe('idle');
    expect(store.getState().pending).toEqual([]);
    expect(store.getState().batchKey).toBeNull();
  });
});
