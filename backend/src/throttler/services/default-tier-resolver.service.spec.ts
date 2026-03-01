import { DefaultTierResolver } from './default-tier-resolver.service';

describe('DefaultTierResolver', () => {
  let resolver: DefaultTierResolver;

  beforeEach(() => {
    resolver = new DefaultTierResolver();
  });

  it('returns free tier for any user', async () => {
    expect(await resolver.resolve('user-1')).toBe('free');
    expect(await resolver.resolve('user-2')).toBe('free');
  });
});
