import { AwsMarketplaceConfig } from './aws-marketplace.config';
import { AwsMarketplaceReconciler } from './aws-marketplace.reconciler';
import { inMemoryJobLock } from '../../common/scheduling/scheduled-job-lock.testing';

function config(enabled: boolean) {
  return new AwsMarketplaceConfig({
    get: (key: string) =>
      key === 'KK_AWS_MARKETPLACE_ENABLED' ? String(enabled) : undefined,
  } as any);
}

describe('AwsMarketplaceReconciler', () => {
  it('runs the reconcile once per hour across API processes', async () => {
    const { lock } = inMemoryJobLock();
    const service = { reconcile: jest.fn().mockResolvedValue({}) };
    const a = new AwsMarketplaceReconciler(config(true), service as any, lock);
    const b = new AwsMarketplaceReconciler(config(true), service as any, lock);
    await a.reconcileLicenses();
    await b.reconcileLicenses();
    expect(service.reconcile).toHaveBeenCalledTimes(1);
  });

  it('does nothing while AWS Marketplace is off', async () => {
    const { lock, store } = inMemoryJobLock();
    const service = { reconcile: jest.fn() };
    await new AwsMarketplaceReconciler(
      config(false),
      service as any,
      lock,
    ).reconcileLicenses();
    expect(service.reconcile).not.toHaveBeenCalled();
    expect(store.keys.size).toBe(0);
  });
});
