import { useCallback, useRef, useState } from 'react';

export type BatchJob = { id: number; name: string };

// 'confirming' is owned by the caller (toolbar manages the pre-flight modal);
// the runner only tracks the loop's lifecycle. Exposing both shapes keeps the
// runner reusable without coupling it to a particular confirm UI.
export type BatchRunnerState = 'idle' | 'running' | 'stopping';

export type BatchProgress = {
  done: number;
  total: number;
  current: BatchJob | null;
};

export type BatchOutcome =
  | { kind: 'completed'; done: number; total: number }
  | { kind: 'stopped'; done: number; total: number }
  | { kind: 'failed'; done: number; total: number; job: BatchJob; error: string };

export type BatchRunner = {
  state: BatchRunnerState;
  progress: BatchProgress;
  start: (
    jobs: BatchJob[],
    mutateFn: (job: BatchJob) => Promise<unknown>,
  ) => Promise<BatchOutcome>;
  stop: () => void;
  reset: () => void;
};

const EMPTY_PROGRESS: BatchProgress = { done: 0, total: 0, current: null };

export function useBatchRunner(): BatchRunner {
  const [state, setState] = useState<BatchRunnerState>('idle');
  const [progress, setProgress] = useState<BatchProgress>(EMPTY_PROGRESS);
  // Ref-based stop signal. The loop checks it between iterations so an
  // in-flight mutateFn always finishes before we bail — preventing partially
  // written state on the server.
  const stopRef = useRef(false);

  const stop = useCallback(() => {
    if (stopRef.current) return;
    stopRef.current = true;
    setState((s) => (s === 'running' ? 'stopping' : s));
  }, []);

  const reset = useCallback(() => {
    stopRef.current = false;
    setState('idle');
    setProgress(EMPTY_PROGRESS);
  }, []);

  const start = useCallback(
    async (
      jobs: BatchJob[],
      mutateFn: (job: BatchJob) => Promise<unknown>,
    ): Promise<BatchOutcome> => {
      stopRef.current = false;
      const total = jobs.length;
      setState('running');
      setProgress({ done: 0, total, current: null });

      let done = 0;
      for (const job of jobs) {
        if (stopRef.current) {
          setState('idle');
          setProgress({ done, total, current: null });
          return { kind: 'stopped', done, total };
        }
        setProgress({ done, total, current: job });
        try {
          await mutateFn(job);
        } catch (e) {
          const error = e instanceof Error ? e.message : String(e);
          setState('idle');
          setProgress({ done, total, current: null });
          return { kind: 'failed', done, total, job, error };
        }
        done += 1;
        setProgress({ done, total, current: null });
      }

      setState('idle');
      setProgress({ done, total, current: null });
      return { kind: 'completed', done, total };
    },
    [],
  );

  return { state, progress, start, stop, reset };
}
