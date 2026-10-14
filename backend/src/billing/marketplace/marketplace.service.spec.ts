import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { QueryFailedError } from 'typeorm';
import { MarketplaceService } from './marketplace.service';
import { MarketplaceConfig } from './marketplace.config';
import {
  MarketplaceApiError,
  type ResolvedPurchase,
  type SaasOperation,
} from './marketplace-fulfillment.client';
import { MarketplaceOperation } from './entities/marketplace-operation.entity';
import { Subscription } from '../entities/subscription.entity';

const USER_ID = 'user-1';
const SUB_ID = 'mp-sub-1';
const OFFER = 'krakenkey';

function makeConfig(enabled = true): MarketplaceConfig {
  return new MarketplaceConfig({
    get: (key: string) =>
      ({
        KK_MARKETPLACE_ENABLED: enabled ? 'true' : 'false',
        KK_MARKETPLACE_TENANT_ID: 'tenant',
        KK_MARKETPLACE_CLIENT_ID: 'client',
        KK_MARKETPLACE_CLIENT_SECRET: 'secret',
        KK_MARKETPLACE_PLAN_MAP:
          'kk-starter=starter,kk-team=team,kk-business=business',
        KK_MARKETPLACE_OFFER_IDS: OFFER,
      })[key],
  } as any);
}

function purchase(
  overrides: Partial<ResolvedPurchase['subscription']> = {},
  planId = 'kk-team',
): ResolvedPurchase {
  return {
    id: SUB_ID,
    subscriptionName: 'Acme KrakenKey',
    offerId: OFFER,
    planId,
    subscription: {
      id: SUB_ID,
      name: 'Acme KrakenKey',
      offerId: OFFER,
      planId,
      saasSubscriptionStatus: 'PendingFulfillmentStart',
      purchaser: { emailId: 'buyer@acme.example' },
      beneficiary: { emailId: 'admin@acme.example' },
      term: { termUnit: 'P1M', endDate: '2026-11-13T00:00:00Z' },
      autoRenew: true,
      ...overrides,
    },
  };
}

function op(overrides: Partial<SaasOperation> = {}): SaasOperation {
  return {
    id: 'op-1',
    subscriptionId: SUB_ID,
    offerId: OFFER,
    planId: 'kk-team',
    quantity: null,
    action: 'Suspend',
    status: 'Succeeded',
    ...overrides,
  };
}

function linkedRow(overrides: Partial<Subscription> = {}): Subscription {
  return {
    id: 'row-1',
    userId: USER_ID,
    organizationId: null,
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    source: 'marketplace',
    marketplaceSubscriptionId: SUB_ID,
    marketplaceOfferId: OFFER,
    marketplacePlanId: 'kk-team',
    marketplaceStatus: 'Subscribed',
    marketplaceQuantity: null,
    plan: 'business',
    status: 'active',
    pastDueSince: null,
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
    ...overrides,
  } as Subscription;
}

describe('MarketplaceService', () => {
  let service: MarketplaceService;
  let subRepo: any;
  let userRepo: any;
  let orgRepo: any;
  let opRepo: any;
  let manager: any;
  let client: any;
  let verifier: any;
  let billing: any;
  let user: any;
  /** What manager.findOne returns: the owner's row, or the row linked to the purchase. */
  let rows: { owner: any; linked: any };
  /** Copies of every Subscription saved, taken when it was saved. */
  let savedRows: any[];

  beforeEach(() => {
    user = {
      id: USER_ID,
      email: 'me@acme.example',
      username: 'me',
      organizationId: null,
      role: null,
    };
    rows = { owner: null, linked: null };
    savedRows = [];
    manager = {
      findOne: jest.fn(async (_e: unknown, opts: any) =>
        opts?.where?.marketplaceSubscriptionId !== undefined
          ? rows.linked
          : rows.owner,
      ),
      save: jest.fn(async (entity: unknown, row: any) => {
        if (entity === Subscription) savedRows.push({ ...row });
        // The claim links the row; later reads by subscription id see it.
        if (row?.marketplaceSubscriptionId) rows.linked = row;
        return row;
      }),
      create: jest.fn((_e: unknown, row: unknown) => ({ ...(row as object) })),
      insert: jest.fn().mockResolvedValue(undefined),
    };
    subRepo = {
      findOne: jest.fn().mockResolvedValue(null),
      manager: {
        transaction: jest.fn(async (cb: (m: unknown) => unknown) =>
          cb(manager),
        ),
      },
    };
    userRepo = { findOne: jest.fn(async () => user) };
    orgRepo = {
      findOne: jest.fn().mockResolvedValue({ id: 'org-1', name: 'Acme' }),
      exists: jest.fn().mockResolvedValue(true),
    };
    opRepo = { findOne: jest.fn().mockResolvedValue(null) };
    client = {
      resolve: jest.fn().mockResolvedValue(purchase()),
      activate: jest.fn().mockResolvedValue(undefined),
      getSubscription: jest.fn().mockResolvedValue({
        ...purchase().subscription,
        saasSubscriptionStatus: 'Subscribed',
      }),
      getOperation: jest.fn().mockResolvedValue(op()),
      updateOperation: jest.fn().mockResolvedValue(undefined),
    };
    verifier = { verify: jest.fn().mockResolvedValue(undefined) };
    billing = {
      getSubscription: jest.fn().mockResolvedValue(null),
      queueDissolution: jest.fn().mockResolvedValue(undefined),
    };
    service = new MarketplaceService(
      subRepo,
      userRepo,
      orgRepo,
      opRepo,
      makeConfig(),
      client,
      verifier,
      billing,
    );
    for (const level of ['log', 'warn', 'error'] as const) {
      jest
        .spyOn((service as any).logger, level)
        .mockImplementation(() => undefined);
    }
  });

  /** Microsoft's current view of the subscription (Get subscription). */
  const microsoft = (
    saasSubscriptionStatus: string,
    overrides: Record<string, unknown> = {},
  ) =>
    client.getSubscription.mockResolvedValue({
      ...purchase().subscription,
      saasSubscriptionStatus,
      ...overrides,
    });

  describe('flag', () => {
    it('answers 404 while KK_MARKETPLACE_ENABLED is off', () => {
      const off = new MarketplaceService(
        subRepo,
        userRepo,
        orgRepo,
        opRepo,
        makeConfig(false),
        client,
        verifier,
        billing,
      );
      expect(off.enabled).toBe(false);
      expect(() =>
        off.assertEnabled('POST', '/billing/marketplace/webhook'),
      ).toThrow(NotFoundException);
      expect(() =>
        service.assertEnabled('POST', '/billing/marketplace/webhook'),
      ).not.toThrow();
    });
  });

  describe('landing page', () => {
    const saves = () => savedRows;
    const claimed = () => saves()[0];

    it('describes a new purchase as ready for this account', async () => {
      const res = await service.describe(USER_ID, 'token');
      expect(client.resolve).toHaveBeenCalledWith('token');
      expect(res).toMatchObject({
        state: 'ready',
        plan: 'business',
        planId: 'kk-team',
        saasStatus: 'PendingFulfillmentStart',
        purchaserEmail: 'buyer@acme.example',
        termUnit: 'P1M',
        accountMatchesPurchase: false,
        target: { kind: 'user', name: 'me@acme.example' },
      });
    });

    it("says when the signed-in email is the purchaser's or beneficiary's", async () => {
      user.email = 'Admin@Acme.example';
      expect(
        (await service.describe(USER_ID, 'token')).accountMatchesPurchase,
      ).toBe(true);
    });

    it('claims the purchase, activates it, then applies what Microsoft reports', async () => {
      const order: string[] = [];
      const snapshots: any[] = [];
      manager.save.mockImplementation(async (_e: unknown, row: any) => {
        snapshots.push({ ...row });
        order.push(
          row.marketplaceStatus === 'PendingFulfillmentStart'
            ? 'claim'
            : 'finish',
        );
        rows.linked = row;
        return row;
      });
      client.activate.mockImplementation(async () => {
        order.push('activate');
      });
      client.getSubscription.mockImplementation(async () => {
        order.push('read');
        return {
          ...purchase().subscription,
          saasSubscriptionStatus: 'Subscribed',
        };
      });

      const res = await service.activate(USER_ID, 'token');

      expect(order).toEqual(['claim', 'activate', 'read', 'finish']);
      // The claim carries no paid limits.
      expect(snapshots[0]).toMatchObject({
        userId: USER_ID,
        organizationId: null,
        source: 'marketplace',
        marketplaceSubscriptionId: SUB_ID,
        marketplaceOfferId: OFFER,
        marketplacePlanId: 'kk-team',
        marketplaceStatus: 'PendingFulfillmentStart',
        plan: 'free',
        status: 'incomplete',
        stripeCustomerId: null,
      });
      expect(client.activate).toHaveBeenCalledWith(SUB_ID);
      expect(snapshots[1]).toMatchObject({
        marketplaceStatus: 'Subscribed',
        plan: 'business',
        status: 'active',
        currentPeriodEnd: new Date('2026-11-13T00:00:00Z'),
        cancelAtPeriodEnd: false,
      });
      expect(res).toMatchObject({ state: 'active', saasStatus: 'Subscribed' });
    });

    it('counts a purchase Microsoft still reports as pending right after Activate as active', async () => {
      microsoft('PendingFulfillmentStart');
      await service.activate(USER_ID, 'token');
      expect(saves()[1]).toMatchObject({
        status: 'active',
        plan: 'business',
        marketplaceStatus: 'Subscribed',
      });
    });

    it('applies a suspension that arrived between Resolve and the claim', async () => {
      // The Suspend webhook found nothing linked and was recorded as ignored.
      microsoft('Suspended');
      const res = await service.activate(USER_ID, 'token');
      expect(saves()[1]).toMatchObject({
        status: 'past_due',
        marketplaceStatus: 'Suspended',
        pastDueSince: expect.any(Date),
      });
      expect(res.saasStatus).toBe('Suspended');
    });

    it('applies a cancellation that arrived between Resolve and the claim', async () => {
      microsoft('Unsubscribed');
      const res = await service.activate(USER_ID, 'token');
      expect(saves()[1]).toMatchObject({
        status: 'canceled',
        plan: 'free',
        marketplaceStatus: 'Unsubscribed',
      });
      expect(res.state).toBe('ended');
    });

    it('applies a plan change that arrived between Resolve and the claim', async () => {
      microsoft('Subscribed', { planId: 'kk-business' });
      await service.activate(USER_ID, 'token');
      expect(saves()[1]).toMatchObject({
        plan: 'business',
        marketplacePlanId: 'kk-business',
      });
    });

    it('leaves the claim pending when Microsoft cannot be read after Activate', async () => {
      client.getSubscription.mockRejectedValue(new MarketplaceApiError('x', 0));
      await expect(service.activate(USER_ID, 'token')).rejects.toThrow(
        BadGatewayException,
      );
      expect(saves()).toHaveLength(1);
      expect(claimed().status).toBe('incomplete');
    });

    it("reuses the user's free row and drops a stale Stripe subscription id", async () => {
      const row = {
        id: 'row-1',
        userId: USER_ID,
        stripeCustomerId: 'cus_1',
        stripeSubscriptionId: 'sub_old',
        source: 'stripe',
        plan: 'free',
        status: 'canceled',
      };
      billing.getSubscription.mockResolvedValue(row);
      rows.owner = row;

      await service.activate(USER_ID, 'token');

      expect(claimed()).toMatchObject({
        id: 'row-1',
        stripeCustomerId: 'cus_1',
        stripeSubscriptionId: null,
        source: 'marketplace',
      });
    });

    it("links an organization owner's Team purchase to the organization", async () => {
      user.organizationId = 'org-1';
      user.role = 'owner';

      const described = await service.describe(USER_ID, 'token');
      expect(described).toMatchObject({
        state: 'ready',
        target: { kind: 'organization', name: 'Acme' },
      });

      await service.activate(USER_ID, 'token');
      expect(manager.findOne).toHaveBeenCalledWith(
        Subscription,
        expect.objectContaining({ where: { organizationId: 'org-1' } }),
      );
      expect(claimed()).toMatchObject({
        organizationId: 'org-1',
        userId: null,
      });
    });

    it('accepts a Pro purchase for an organization: every Marketplace plan can back one', async () => {
      user.organizationId = 'org-1';
      user.role = 'owner';
      client.resolve.mockResolvedValue(purchase({}, 'kk-starter'));

      expect((await service.describe(USER_ID, 'token')).state).toBe('ready');
    });

    it('allows a Starter purchase for a user without an organization', async () => {
      client.resolve.mockResolvedValue(purchase({}, 'kk-starter'));
      expect((await service.describe(USER_ID, 'token')).state).toBe('ready');
    });

    it('does not call Microsoft when the claim finds a live subscription', async () => {
      rows.owner = {
        id: 'row-1',
        source: 'stripe',
        stripeSubscriptionId: 'sub_live',
        status: 'active',
      };
      await expect(service.activate(USER_ID, 'token')).rejects.toThrow(
        ConflictException,
      );
      expect(client.activate).not.toHaveBeenCalled();
    });

    it('links without calling Activate when Microsoft already activated it', async () => {
      client.resolve.mockResolvedValue(
        purchase({ saasSubscriptionStatus: 'Subscribed' }),
      );
      await service.activate(USER_ID, 'token');
      expect(client.activate).not.toHaveBeenCalled();
      expect(saves()[1]).toMatchObject({ status: 'active' });
    });

    it('treats a second visit for a linked subscription as "manage"', async () => {
      const row = linkedRow();
      client.resolve.mockResolvedValue(
        purchase({ saasSubscriptionStatus: 'Subscribed' }),
      );
      subRepo.findOne.mockResolvedValue(row);
      billing.getSubscription.mockResolvedValue(row);

      expect((await service.describe(USER_ID, 'token')).state).toBe('active');
      const res = await service.activate(USER_ID, 'token');
      expect(res.state).toBe('active');
      expect(client.activate).not.toHaveBeenCalled();
      expect(manager.save).not.toHaveBeenCalled();
    });

    it('finds a linked subscription whatever the letter case of its id', async () => {
      const row = linkedRow();
      client.resolve.mockResolvedValue({
        ...purchase({ saasSubscriptionStatus: 'Subscribed' }),
        id: SUB_ID.toUpperCase(),
      });
      subRepo.findOne.mockResolvedValue(row);
      billing.getSubscription.mockResolvedValue(row);

      expect((await service.describe(USER_ID, 'token')).state).toBe('active');
      expect(subRepo.findOne).toHaveBeenCalledWith({
        where: { marketplaceSubscriptionId: SUB_ID },
      });
    });

    it('offers activation again when an earlier attempt stopped after the claim', async () => {
      const row = linkedRow({
        marketplaceStatus: 'PendingFulfillmentStart',
        plan: 'free',
        status: 'incomplete',
      });
      subRepo.findOne.mockResolvedValue(row);
      billing.getSubscription.mockResolvedValue(row);
      rows.owner = row;
      rows.linked = row;

      expect((await service.describe(USER_ID, 'token')).state).toBe('ready');
      await service.activate(USER_ID, 'token');
      expect(client.activate).toHaveBeenCalledWith(SUB_ID);
      expect(row).toMatchObject({ status: 'active', plan: 'business' });
    });

    it('refuses a subscription linked to another account', async () => {
      client.resolve.mockResolvedValue(
        purchase({ saasSubscriptionStatus: 'Subscribed' }),
      );
      subRepo.findOne.mockResolvedValue(
        linkedRow({ id: 'row-other', userId: 'someone-else' }),
      );

      expect((await service.describe(USER_ID, 'token')).state).toBe(
        'linked_elsewhere',
      );
      await expect(service.activate(USER_ID, 'token')).rejects.toThrow(
        ConflictException,
      );
      expect(client.activate).not.toHaveBeenCalled();
    });

    it('refuses with 409 while the account has a live Stripe subscription', async () => {
      billing.getSubscription.mockResolvedValue({
        id: 'row-1',
        source: 'stripe',
        stripeSubscriptionId: 'sub_live',
        status: 'active',
        plan: 'pro',
      });

      const described = await service.describe(USER_ID, 'token');
      expect(described.state).toBe('conflict');
      expect(described.message).toMatch(/billed by KrakenKey/);
      await expect(service.activate(USER_ID, 'token')).rejects.toThrow(
        ConflictException,
      );
      expect(client.activate).not.toHaveBeenCalled();
    });

    it('refuses with 409 while the account has another live Marketplace subscription', async () => {
      billing.getSubscription.mockResolvedValue(
        linkedRow({ marketplaceSubscriptionId: 'mp-other' }),
      );
      expect((await service.describe(USER_ID, 'token')).state).toBe('conflict');
      await expect(service.activate(USER_ID, 'token')).rejects.toThrow(
        ConflictException,
      );
    });

    it('refuses an org member who is not the owner', async () => {
      user.organizationId = 'org-1';
      user.role = 'admin';
      expect((await service.describe(USER_ID, 'token')).state).toBe(
        'not_owner',
      );
      await expect(service.activate(USER_ID, 'token')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('refuses a plan that is not mapped', async () => {
      client.resolve.mockResolvedValue(purchase({}, 'kk-unknown'));
      const res = await service.describe(USER_ID, 'token');
      expect(res).toMatchObject({ state: 'unknown_plan', plan: null });
      await expect(service.activate(USER_ID, 'token')).rejects.toThrow(
        ConflictException,
      );
    });

    it.each([
      ['Unsubscribed', 'ended'],
      ['Suspended', 'suspended'],
    ])('reports a %s purchase as %s', async (saasStatus, state) => {
      client.resolve.mockResolvedValue(
        purchase({ saasSubscriptionStatus: saasStatus }),
      );
      expect((await service.describe(USER_ID, 'token')).state).toBe(state);
    });

    it.each(['', 'SomethingNew'])(
      'refuses a purchase with an unexpected status %p',
      async (saasStatus) => {
        client.resolve.mockResolvedValue(
          purchase({ saasSubscriptionStatus: saasStatus }),
        );
        await expect(service.activate(USER_ID, 'token')).rejects.toThrow(
          BadGatewayException,
        );
        expect(manager.save).not.toHaveBeenCalled();
      },
    );

    it("answers 400 with Microsoft's guidance for an expired token", async () => {
      client.resolve.mockRejectedValue(new MarketplaceApiError('bad', 400));
      await expect(service.describe(USER_ID, 'old')).rejects.toThrow(
        /Configure account or Manage account/,
      );
      await expect(service.describe(USER_ID, 'old')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('answers 502 when Microsoft is unreachable', async () => {
      client.resolve.mockRejectedValue(new MarketplaceApiError('down', 0));
      await expect(service.describe(USER_ID, 'token')).rejects.toThrow(
        BadGatewayException,
      );
    });

    it('leaves only the claim when Microsoft refuses the activation', async () => {
      client.activate.mockRejectedValue(new MarketplaceApiError('no', 400));
      await expect(service.activate(USER_ID, 'token')).rejects.toThrow(
        BadGatewayException,
      );
      expect(saves()).toHaveLength(1);
      expect(claimed()).toMatchObject({ status: 'incomplete', plan: 'free' });
    });

    it('treats a parallel claim of the same purchase as done', async () => {
      const unique = new QueryFailedError('INSERT', [], {
        code: '23505',
      } as any);
      manager.save.mockRejectedValueOnce(unique);
      const pending = linkedRow({
        marketplaceStatus: 'PendingFulfillmentStart',
      });
      subRepo.findOne
        .mockResolvedValueOnce(null) // assess
        .mockResolvedValueOnce(pending); // after the unique violation
      rows.linked = pending;
      await expect(service.activate(USER_ID, 'token')).resolves.toMatchObject({
        state: 'active',
      });
    });

    it('reports a row taken over during activation', async () => {
      // A Stripe checkout replaced the claim before it was finished.
      manager.save.mockImplementation(async (_e: unknown, row: any) => row);
      rows.linked = null;
      await expect(service.activate(USER_ID, 'token')).rejects.toThrow(
        ConflictException,
      );
      expect((service as any).logger.error).toHaveBeenCalledWith(
        expect.stringMatching(/double billing/),
      );
    });
  });

  describe('webhook', () => {
    const auth = 'Bearer token';
    const body = (overrides: Record<string, unknown> = {}) => ({
      id: 'op-1',
      activityId: 'act-1',
      publisherId: 'krakenkey',
      offerId: OFFER,
      planId: 'kk-team',
      quantity: null,
      subscriptionId: SUB_ID,
      action: 'Suspend',
      status: 'Succeeded',
      timeStamp: '2026-10-13T00:00:00Z',
      subscription: { id: SUB_ID },
      somethingNew: 'Microsoft may add fields',
      ...overrides,
    });

    beforeEach(() => {
      rows.linked = linkedRow();
      microsoft('Suspended');
    });

    const savedRow = (): Subscription =>
      manager.save.mock.calls.find(
        ([entity]: [unknown]) => entity === Subscription,
      )?.[1];
    const recorded = () => manager.insert.mock.calls[0]?.[1];

    it('rejects an invalid token before doing anything', async () => {
      verifier.verify.mockRejectedValue(new UnauthorizedException());
      await expect(service.handleWebhook('Bearer bad', body())).rejects.toThrow(
        UnauthorizedException,
      );
      expect(client.getOperation).not.toHaveBeenCalled();
      expect(opRepo.findOne).not.toHaveBeenCalled();
    });

    it('rejects a payload without id, subscriptionId or action', async () => {
      await expect(
        service.handleWebhook(auth, { action: 'Suspend' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('confirms the operation with Microsoft within a deadline', async () => {
      const before = Date.now();
      await service.handleWebhook(auth, body());
      expect(verifier.verify).toHaveBeenCalledWith(auth);
      const [subId, opId, deadline] = client.getOperation.mock.calls[0];
      expect([subId, opId]).toEqual([SUB_ID, 'op-1']);
      // Calls to Microsoft share an 8-second budget.
      expect(deadline).toBeGreaterThanOrEqual(before + 8000);
      expect(deadline).toBeLessThanOrEqual(Date.now() + 8000);
      expect(client.getSubscription).toHaveBeenCalledWith(SUB_ID, deadline);
    });

    it.each([
      ['action', { action: 'Unsubscribe' }],
      ['subscriptionId', { subscriptionId: 'mp-other' }],
      ['offerId', { offerId: 'other-offer' }],
    ])(
      'refuses with 400 when the %s does not match the operation',
      async (_field, mismatch) => {
        client.getOperation.mockResolvedValue(op(mismatch));
        await expect(service.handleWebhook(auth, body())).rejects.toThrow(
          BadRequestException,
        );
        expect(manager.save).not.toHaveBeenCalled();
        expect(manager.insert).not.toHaveBeenCalled();
      },
    );

    it('matches subscription and operation ids whatever their letter case', async () => {
      client.getOperation.mockResolvedValue(
        op({ id: 'OP-1', subscriptionId: SUB_ID.toUpperCase() }),
      );
      await expect(
        service.handleWebhook(
          auth,
          body({ id: 'Op-1', subscriptionId: SUB_ID.toUpperCase() }),
        ),
      ).resolves.toBe('processed');
      expect(manager.findOne).toHaveBeenCalledWith(
        Subscription,
        expect.objectContaining({
          where: { marketplaceSubscriptionId: SUB_ID },
        }),
      );
      expect(recorded()).toMatchObject({ id: 'op-1', subscriptionId: SUB_ID });
      expect(savedRow()).toMatchObject({ status: 'past_due' });
    });

    it('refuses with 400 when a ChangePlan names another plan than the operation', async () => {
      client.getOperation.mockResolvedValue(
        op({
          action: 'ChangePlan',
          planId: 'kk-starter',
          status: 'InProgress',
        }),
      );
      await expect(
        service.handleWebhook(
          auth,
          body({ action: 'ChangePlan', planId: 'kk-business' }),
        ),
      ).rejects.toThrow(BadRequestException);
      expect(client.updateOperation).not.toHaveBeenCalled();
    });

    it('refuses with 400 when Microsoft does not know the operation', async () => {
      client.getOperation.mockRejectedValue(new MarketplaceApiError('nf', 404));
      await expect(service.handleWebhook(auth, body())).rejects.toThrow(
        BadRequestException,
      );
    });

    it('answers 503 so Microsoft retries when the operation cannot be checked', async () => {
      client.getOperation.mockRejectedValue(new MarketplaceApiError('x', 500));
      await expect(service.handleWebhook(auth, body())).rejects.toThrow(
        ServiceUnavailableException,
      );
      expect(manager.insert).not.toHaveBeenCalled();
    });

    it('answers 503 and records nothing when the subscription cannot be read', async () => {
      client.getSubscription.mockRejectedValue(
        new MarketplaceApiError('x', 500),
      );
      await expect(service.handleWebhook(auth, body())).rejects.toThrow(
        ServiceUnavailableException,
      );
      expect(manager.insert).not.toHaveBeenCalled();
      expect(manager.save).not.toHaveBeenCalled();
    });

    describe('redelivered operations', () => {
      const previous = (overrides: Partial<MarketplaceOperation> = {}) => ({
        id: 'op-1',
        subscriptionId: SUB_ID,
        action: 'Suspend',
        result: 'applied',
        detail: null,
        ackStatus: null,
        dissolveOrganizationId: null,
        dissolveCancel: null,
        ...overrides,
      });

      it('acknowledges them without applying them again', async () => {
        opRepo.findOne.mockResolvedValue(previous());
        await expect(service.handleWebhook(auth, body())).resolves.toBe(
          'duplicate',
        );
        expect(client.getOperation).not.toHaveBeenCalled();
        expect(manager.save).not.toHaveBeenCalled();
        expect(billing.queueDissolution).not.toHaveBeenCalled();
      });

      it('re-queues a dissolution the first delivery recorded', async () => {
        opRepo.findOne.mockResolvedValue(
          previous({
            action: 'Unsubscribe',
            dissolveOrganizationId: 'org-1',
            dissolveCancel: true,
          }),
        );
        await service.handleWebhook(auth, body({ action: 'Unsubscribe' }));
        expect(billing.queueDissolution).toHaveBeenCalledWith('org-1', true);
      });

      it('does not re-queue once the organization is gone', async () => {
        orgRepo.exists.mockResolvedValue(false);
        opRepo.findOne.mockResolvedValue(
          previous({ dissolveOrganizationId: 'org-1', dissolveCancel: true }),
        );
        await service.handleWebhook(auth, body());
        expect(billing.queueDissolution).not.toHaveBeenCalled();
      });

      it('never dissolves an organization the first delivery did not', async () => {
        // An org row still waiting for activation has plan "free".
        subRepo.findOne.mockResolvedValue(
          linkedRow({
            userId: null,
            organizationId: 'org-1',
            plan: 'free',
            status: 'incomplete',
            marketplaceStatus: 'PendingFulfillmentStart',
          }),
        );
        opRepo.findOne.mockResolvedValue(previous({ action: 'Subscribe' }));
        await service.handleWebhook(auth, body({ action: 'Subscribe' }));
        expect(billing.queueDissolution).not.toHaveBeenCalled();
      });

      it('re-sends the answer while Microsoft still waits for it', async () => {
        opRepo.findOne.mockResolvedValue(
          previous({ action: 'ChangeQuantity', ackStatus: 'Success' }),
        );
        client.getOperation.mockResolvedValue(
          op({ action: 'ChangeQuantity', status: 'InProgress' }),
        );
        await service.handleWebhook(auth, body({ action: 'ChangeQuantity' }));
        expect(client.updateOperation).toHaveBeenCalledWith(
          SUB_ID,
          'op-1',
          'Success',
          expect.any(Number),
        );
        expect(manager.save).not.toHaveBeenCalled();
      });

      it('does not re-send an answer Microsoft already has', async () => {
        opRepo.findOne.mockResolvedValue(
          previous({ action: 'ChangePlan', ackStatus: 'Failure' }),
        );
        client.getOperation.mockResolvedValue(
          op({ action: 'ChangePlan', status: 'Failed' }),
        );
        await service.handleWebhook(auth, body({ action: 'ChangePlan' }));
        expect(client.updateOperation).not.toHaveBeenCalled();
      });
    });

    it('treats a concurrent delivery of the same operation as a duplicate', async () => {
      manager.insert.mockRejectedValue(
        new QueryFailedError('INSERT', [], { code: '23505' } as any),
      );
      await expect(service.handleWebhook(auth, body())).resolves.toBe(
        'duplicate',
      );
    });

    it('records each handled operation', async () => {
      await service.handleWebhook(auth, body());
      expect(recorded()).toEqual({
        id: 'op-1',
        subscriptionId: SUB_ID,
        action: 'Suspend',
        result: 'applied',
        detail: null,
        ackStatus: null,
        dissolveOrganizationId: null,
        dissolveCancel: null,
      });
    });

    it('Suspend keeps the plan and starts the grace period', async () => {
      await service.handleWebhook(auth, body());
      expect(savedRow()).toMatchObject({
        plan: 'business',
        status: 'past_due',
        marketplaceStatus: 'Suspended',
        pastDueSince: expect.any(Date),
      });
      // Notify-only: no PATCH.
      expect(client.updateOperation).not.toHaveBeenCalled();
    });

    it('Suspend keeps an earlier pastDueSince', async () => {
      const since = new Date('2026-10-01T00:00:00Z');
      rows.linked = linkedRow({ status: 'past_due', pastDueSince: since });
      await service.handleWebhook(auth, body());
      expect(savedRow().pastDueSince).toBe(since);
    });

    it('asks Microsoft to retry a Suspend while the subscription still reads Subscribed', async () => {
      // Either the read is stale or a Reinstate came after; a retry settles it.
      microsoft('Subscribed');
      await expect(service.handleWebhook(auth, body())).rejects.toThrow(
        ServiceUnavailableException,
      );
      expect(manager.insert).not.toHaveBeenCalled();
      expect(manager.save).not.toHaveBeenCalled();
    });

    it('asks Microsoft to retry a completed Reinstate while the subscription still reads Suspended', async () => {
      rows.linked = linkedRow({
        status: 'past_due',
        pastDueSince: new Date(),
        marketplaceStatus: 'Suspended',
      });
      client.getOperation.mockResolvedValue(op({ action: 'Reinstate' }));
      microsoft('Suspended');
      await expect(
        service.handleWebhook(auth, body({ action: 'Reinstate' })),
      ).rejects.toThrow(ServiceUnavailableException);
      expect(manager.insert).not.toHaveBeenCalled();
    });

    it('applies a completed Reinstate once the subscription reads Subscribed', async () => {
      rows.linked = linkedRow({
        status: 'past_due',
        pastDueSince: new Date(),
        marketplaceStatus: 'Suspended',
      });
      client.getOperation.mockResolvedValue(op({ action: 'Reinstate' }));
      microsoft('Subscribed');
      await service.handleWebhook(auth, body({ action: 'Reinstate' }));
      expect(savedRow()).toMatchObject({
        status: 'active',
        pastDueSince: null,
        marketplaceStatus: 'Subscribed',
      });
      expect(client.updateOperation).not.toHaveBeenCalled();
    });

    it('Reinstate in progress restores the subscription and accepts the operation', async () => {
      rows.linked = linkedRow({
        status: 'past_due',
        pastDueSince: new Date(),
        marketplaceStatus: 'Suspended',
      });
      client.getOperation.mockResolvedValue(
        op({ action: 'Reinstate', status: 'InProgress' }),
      );
      await service.handleWebhook(
        auth,
        body({ action: 'Reinstate', status: 'InProgress' }),
      );
      expect(savedRow()).toMatchObject({
        status: 'active',
        pastDueSince: null,
        marketplaceStatus: 'Subscribed',
      });
      expect(client.updateOperation).toHaveBeenCalledWith(
        SUB_ID,
        'op-1',
        'Success',
        expect.any(Number),
      );
      expect(recorded().ackStatus).toBe('Success');
      expect(client.getSubscription).not.toHaveBeenCalled();
    });

    it('Renew updates the term from Microsoft', async () => {
      client.getOperation.mockResolvedValue(op({ action: 'Renew' }));
      microsoft('Subscribed', {
        term: { endDate: '2026-12-13T00:00:00Z', termUnit: 'P1M' },
        autoRenew: true,
      });
      await service.handleWebhook(auth, body({ action: 'Renew' }));
      expect(savedRow().currentPeriodEnd).toEqual(
        new Date('2026-12-13T00:00:00Z'),
      );
      expect(client.updateOperation).not.toHaveBeenCalled();
    });

    it('Subscribe (auto-activation) marks a linked subscription active', async () => {
      rows.linked = linkedRow({
        status: 'incomplete',
        plan: 'free',
        marketplaceStatus: 'PendingFulfillmentStart',
      });
      client.getOperation.mockResolvedValue(op({ action: 'Subscribe' }));
      microsoft('Subscribed');
      await service.handleWebhook(auth, body({ action: 'Subscribe' }));
      expect(savedRow()).toMatchObject({
        status: 'active',
        plan: 'business',
        marketplaceStatus: 'Subscribed',
      });
    });

    it('Subscribe for a purchase nobody linked yet is recorded and ignored', async () => {
      rows.linked = null;
      client.getOperation.mockResolvedValue(op({ action: 'Subscribe' }));
      microsoft('Subscribed');
      await expect(
        service.handleWebhook(auth, body({ action: 'Subscribe' })),
      ).resolves.toBe('processed');
      expect(savedRow()).toBeUndefined();
      expect(recorded()).toMatchObject({
        result: 'ignored',
        detail: 'not linked to an account',
      });
    });

    it('ChangePlan applies the mapped plan and accepts the operation', async () => {
      client.getOperation.mockResolvedValue(
        op({
          action: 'ChangePlan',
          planId: 'kk-business',
          status: 'InProgress',
        }),
      );
      await service.handleWebhook(
        auth,
        body({ action: 'ChangePlan', planId: 'kk-business' }),
      );
      expect(savedRow()).toMatchObject({
        plan: 'business',
        marketplacePlanId: 'kk-business',
      });
      expect(client.updateOperation).toHaveBeenCalledWith(
        SUB_ID,
        'op-1',
        'Success',
        expect.any(Number),
      );
      expect(billing.queueDissolution).not.toHaveBeenCalled();
    });

    it('ChangePlan to a plan that is not sold here is rejected', async () => {
      client.getOperation.mockResolvedValue(
        op({ action: 'ChangePlan', planId: 'kk-other', status: 'InProgress' }),
      );
      await service.handleWebhook(
        auth,
        body({ action: 'ChangePlan', planId: 'kk-other' }),
      );
      expect(savedRow()).toBeUndefined();
      expect(client.updateOperation).toHaveBeenCalledWith(
        SUB_ID,
        'op-1',
        'Failure',
        expect.any(Number),
      );
      expect(recorded()).toMatchObject({
        result: 'rejected',
        ackStatus: 'Failure',
      });
    });

    it('a ChangePlan redelivered after it finished follows the current plan', async () => {
      // An older ChangePlan to Business arrives after a newer one to Starter.
      client.getOperation.mockResolvedValue(
        op({
          action: 'ChangePlan',
          planId: 'kk-business',
          status: 'Succeeded',
        }),
      );
      microsoft('Subscribed', { planId: 'kk-starter' });
      await service.handleWebhook(
        auth,
        body({ action: 'ChangePlan', planId: 'kk-business' }),
      );
      expect(savedRow().plan).toBe('pro');
      expect(client.updateOperation).not.toHaveBeenCalled();
    });

    it('ChangePlan from Business to Pro keeps the organization', async () => {
      rows.linked = linkedRow({ userId: null, organizationId: 'org-1' });
      client.getOperation.mockResolvedValue(
        op({
          action: 'ChangePlan',
          planId: 'kk-starter',
          status: 'InProgress',
        }),
      );
      await service.handleWebhook(
        auth,
        body({ action: 'ChangePlan', planId: 'kk-starter' }),
      );
      expect(savedRow().plan).toBe('pro');
      expect(billing.queueDissolution).not.toHaveBeenCalled();
    });

    it('never dissolves an organization whose purchase is still being activated', async () => {
      rows.linked = linkedRow({
        userId: null,
        organizationId: 'org-1',
        plan: 'free',
        status: 'incomplete',
        marketplaceStatus: 'PendingFulfillmentStart',
      });
      client.getOperation.mockResolvedValue(op({ action: 'Unsubscribe' }));
      microsoft('Unsubscribed');
      await service.handleWebhook(auth, body({ action: 'Unsubscribe' }));
      expect(billing.queueDissolution).not.toHaveBeenCalled();
      expect(recorded().dissolveOrganizationId).toBeNull();
    });

    it('ChangeQuantity stores the quantity and accepts the operation', async () => {
      client.getOperation.mockResolvedValue(
        op({ action: 'ChangeQuantity', quantity: 5, status: 'InProgress' }),
      );
      await service.handleWebhook(
        auth,
        body({ action: 'ChangeQuantity', quantity: 5 }),
      );
      expect(savedRow().marketplaceQuantity).toBe(5);
      expect(client.updateOperation).toHaveBeenCalledWith(
        SUB_ID,
        'op-1',
        'Success',
        expect.any(Number),
      );
    });

    it('Unsubscribe drops the account to free', async () => {
      client.getOperation.mockResolvedValue(op({ action: 'Unsubscribe' }));
      microsoft('Unsubscribed');
      await service.handleWebhook(auth, body({ action: 'Unsubscribe' }));
      expect(savedRow()).toMatchObject({
        plan: 'free',
        status: 'canceled',
        marketplaceStatus: 'Unsubscribed',
        currentPeriodEnd: null,
      });
      expect(client.updateOperation).not.toHaveBeenCalled();
      expect(billing.queueDissolution).not.toHaveBeenCalled();
    });

    it('Unsubscribe applies even when the subscription still reads Subscribed', async () => {
      // A stale read must not leave a canceled subscription on a paid plan.
      client.getOperation.mockResolvedValue(op({ action: 'Unsubscribe' }));
      microsoft('Subscribed');
      await service.handleWebhook(auth, body({ action: 'Unsubscribe' }));
      expect(savedRow()).toMatchObject({
        plan: 'free',
        status: 'canceled',
        marketplaceStatus: 'Unsubscribed',
      });
    });

    it('Unsubscribe of an organization subscription dissolves the organization', async () => {
      rows.linked = linkedRow({ userId: null, organizationId: 'org-1' });
      client.getOperation.mockResolvedValue(op({ action: 'Unsubscribe' }));
      microsoft('Unsubscribed');
      await service.handleWebhook(auth, body({ action: 'Unsubscribe' }));
      expect(billing.queueDissolution).toHaveBeenCalledWith('org-1', true);
    });

    it.each([
      ['Subscribe', 'Subscribed'],
      ['Renew', 'Subscribed'],
      ['Suspend', 'Suspended'],
    ])(
      'ignores a late %s once the subscription ended',
      async (action, msStatus) => {
        rows.linked = linkedRow({
          plan: 'free',
          status: 'canceled',
          marketplaceStatus: 'Unsubscribed',
        });
        client.getOperation.mockResolvedValue(op({ action }));
        microsoft(msStatus);
        await service.handleWebhook(auth, body({ action }));
        expect(savedRow()).toBeUndefined();
        expect(recorded()).toMatchObject({
          result: 'ignored',
          detail: 'subscription already ended',
        });
      },
    );

    it.each(['ChangePlan', 'ChangeQuantity', 'Reinstate'])(
      'answers Failure to a %s on a subscription that already ended',
      async (action) => {
        rows.linked = linkedRow({
          plan: 'free',
          status: 'canceled',
          marketplaceStatus: 'Unsubscribed',
        });
        client.getOperation.mockResolvedValue(
          op({ action, planId: 'kk-team', status: 'InProgress' }),
        );
        await service.handleWebhook(auth, body({ action }));
        expect(client.updateOperation).toHaveBeenCalledWith(
          SUB_ID,
          'op-1',
          'Failure',
          expect.any(Number),
        );
        expect(recorded()).toMatchObject({
          result: 'ignored',
          ackStatus: 'Failure',
        });
      },
    );

    it('keeps the plan when Microsoft reports one that is not mapped', async () => {
      client.getOperation.mockResolvedValue(op({ action: 'Renew' }));
      microsoft('Subscribed', { planId: 'kk-unknown' });
      await service.handleWebhook(auth, body({ action: 'Renew' }));
      expect(savedRow().plan).toBe('business');
    });

    it('ignores an operation Microsoft marked Failed or Conflict', async () => {
      client.getOperation.mockResolvedValue(
        op({ action: 'ChangePlan', planId: 'kk-business', status: 'Failed' }),
      );
      await service.handleWebhook(
        auth,
        body({ action: 'ChangePlan', planId: 'kk-business' }),
      );
      expect(savedRow()).toBeUndefined();
      expect(client.updateOperation).not.toHaveBeenCalled();
      expect(recorded()).toMatchObject({ result: 'ignored' });
    });

    it('does not touch a row a Stripe checkout took over', async () => {
      rows.linked = linkedRow({
        source: 'stripe',
        stripeSubscriptionId: 'sub_1',
      });
      client.getOperation.mockResolvedValue(op({ action: 'Unsubscribe' }));
      microsoft('Unsubscribed');
      await service.handleWebhook(auth, body({ action: 'Unsubscribe' }));
      expect(savedRow()).toBeUndefined();
    });

    it('still answers 200 when the PATCH to Microsoft fails', async () => {
      client.getOperation.mockResolvedValue(
        op({ action: 'ChangeQuantity', quantity: 2, status: 'InProgress' }),
      );
      client.updateOperation.mockRejectedValue(
        new MarketplaceApiError('x', 500),
      );
      await expect(
        service.handleWebhook(
          auth,
          body({ action: 'ChangeQuantity', quantity: 2 }),
        ),
      ).resolves.toBe('processed');
    });
  });
});
