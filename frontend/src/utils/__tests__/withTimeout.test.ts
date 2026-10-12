import { TimeoutError, withTimeout } from '../withTimeout';

describe('withTimeout', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('passes through a value that arrives in time', async () => {
    await expect(withTimeout(Promise.resolve(3), 1000)).resolves.toBe(3);
  });

  it('passes through an error that arrives in time', async () => {
    const err = new Error('boom');
    await expect(withTimeout(Promise.reject(err), 1000)).rejects.toBe(err);
  });

  it('rejects with a TimeoutError when nothing arrives', async () => {
    const hung = withTimeout(new Promise<never>(() => {}), 1000);
    const check = expect(hung).rejects.toBeInstanceOf(TimeoutError);
    await vi.advanceTimersByTimeAsync(999);
    await vi.advanceTimersByTimeAsync(1);
    await check;
  });
});
