/**
 * Runs `fn` over `items` with at most `limit` calls in flight. Each call's
 * rejection is passed to `onError` (or rethrown at the end when there is
 * none) so one failure never stops the others.
 */
export async function runWithConcurrency<T>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<void>,
  onError?: (err: unknown, item: T, index: number) => Promise<void> | void,
): Promise<void> {
  let next = 0;
  const errors: unknown[] = [];

  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      const item = items[index];
      try {
        await fn(item, index);
      } catch (err) {
        if (onError) await onError(err, item, index);
        else errors.push(err);
      }
    }
  };

  const workers = Array.from(
    { length: Math.max(1, Math.min(limit, items.length)) },
    worker,
  );
  await Promise.all(workers);
  if (errors.length) throw errors[0];
}

export class TimeoutError extends Error {
  constructor(ms: number) {
    super(`Timed out after ${Math.round(ms / 1000)}s`);
    this.name = 'TimeoutError';
  }
}

/** Rejects with TimeoutError when `promise` takes longer than `ms`. */
export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new TimeoutError(ms)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
