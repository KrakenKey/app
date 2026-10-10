import { ConnectorAlertGate } from './connector-alert-gate';

/** Minimal in-memory Redis with the commands the gate uses. */
function fakeRedis() {
  const store = new Map<string, string>();
  return {
    store,
    set: jest.fn(async (k: string, v: string, ..._rest: unknown[]) => {
      if (store.has(k)) return null;
      store.set(k, v);
      return 'OK';
    }),
    incrby: jest.fn(async (k: string, n: number) => {
      const v = (parseInt(store.get(k) ?? '0', 10) || 0) + n;
      store.set(k, String(v));
      return v;
    }),
    expire: jest.fn(async () => 1),
    getdel: jest.fn(async (k: string) => {
      const v = store.get(k) ?? null;
      store.delete(k);
      return v;
    }),
    disconnect: jest.fn(),
  };
}

describe('ConnectorAlertGate', () => {
  let gate: ConnectorAlertGate;
  let redis: ReturnType<typeof fakeRedis>;

  beforeEach(() => {
    gate = new ConnectorAlertGate({
      get: (_k: string, d?: string) => d,
    } as any);
    gate.onModuleDestroy();
    redis = fakeRedis();
    (gate as any).redis = redis;
  });

  it('lets each target alert once per cooldown, whatever happens between reports', async () => {
    expect(await gate.claimTargetAlert('c1', 7, 'nginx')).toBe(true);
    expect(await gate.claimTargetAlert('c1', 7, 'nginx')).toBe(false);
    expect(await gate.claimTargetAlert('c1', 7, 'haproxy')).toBe(true);
    expect(await gate.claimTargetAlert('c2', 7, 'nginx')).toBe(true);
    expect(redis.set).toHaveBeenCalledWith(
      expect.stringMatching(/^target:[0-9a-f]{64}$/),
      '1',
      'EX',
      6 * 3600,
      'NX',
    );
  });

  it('sends one email per connector per hour and counts the rest into the next', async () => {
    expect(await gate.claimEmail('c1', 2)).toBe(0);
    expect(await gate.claimEmail('c1', 3)).toBeNull();
    expect(await gate.claimEmail('c1', 1)).toBeNull();
    expect(await gate.claimEmail('c2', 1)).toBe(0);
    // The hour passes
    for (const k of [...redis.store.keys()]) {
      if (k.startsWith('email:')) redis.store.delete(k);
    }
    expect(await gate.claimEmail('c1', 5)).toBe(4);
    expect(await gate.claimEmail('c1', 1)).toBeNull();
  });

  it('fails closed when Redis is down', async () => {
    redis.set.mockRejectedValue(new Error('down'));
    expect(await gate.claimTargetAlert('c1', 7, 'nginx')).toBe(false);
    expect(await gate.claimEmail('c1', 1)).toBeNull();
  });
});
