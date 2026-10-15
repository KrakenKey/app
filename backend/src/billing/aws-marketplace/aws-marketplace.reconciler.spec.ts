import { AwsMarketplaceReconciler } from './aws-marketplace.reconciler';
import { inMemoryJobLock } from '../../common/scheduling/scheduled-job-lock.testing';

describe('AwsMarketplaceReconciler', () => {
  it('runs the reconcile once per hour across API processes', async () => {
    const { lock } = inMemoryJobLock();
    const service = { reconcile: jest.fn().mockResolvedValue({}) };
    const a = new AwsMarketplaceReconciler(service as any, lock);
    const b = new AwsMarketplaceReconciler(service as any, lock);
    await a.reconcileLicenses();
    await b.reconcileLicenses();
    expect(service.reconcile).toHaveBeenCalledTimes(1);
  });

  it('runs whatever the feature flag says; the service decides whether it can check AWS', async () => {
    const { lock, store } = inMemoryJobLock();
    const service = { reconcile: jest.fn().mockResolvedValue({}) };
    await new AwsMarketplaceReconciler(
      service as any,
      lock,
    ).reconcileLicenses();
    expect(service.reconcile).toHaveBeenCalledTimes(1);
    expect(store.keys.size).toBe(1);
  });
});
