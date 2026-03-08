import { useRef, useCallback, useEffect, useMemo } from 'react';

export function usePolling<T>(
  pollFn: (id: T) => Promise<boolean>,
  intervalMs = 5000,
) {
  const timers = useRef<Map<T, ReturnType<typeof setInterval>>>(new Map());

  const stop = useCallback((id: T) => {
    const timer = timers.current.get(id);
    if (timer) {
      clearInterval(timer);
      timers.current.delete(id);
    }
  }, []);

  const stopAll = useCallback(() => {
    timers.current.forEach((timer) => clearInterval(timer));
    timers.current.clear();
  }, []);

  const start = useCallback(
    (id: T) => {
      if (timers.current.has(id)) return;

      const timer = setInterval(async () => {
        try {
          const shouldStop = await pollFn(id);
          if (shouldStop) {
            stop(id);
          }
        } catch {
          stop(id);
        }
      }, intervalMs);

      timers.current.set(id, timer);
    },
    [pollFn, intervalMs, stop],
  );

  const isPolling = useCallback((id: T) => timers.current.has(id), []);

  useEffect(() => {
    const currentTimers = timers.current;
    return () => {
      currentTimers.forEach((timer) => clearInterval(timer));
      currentTimers.clear();
    };
  }, []);

  return useMemo(
    () => ({ start, stop, stopAll, isPolling }),
    [start, stop, stopAll, isPolling],
  );
}
