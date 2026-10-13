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
    plan: 'team',
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

  beforeEach(() => {
    user = {
      id: USER_ID,
      email: 'me@acme.example',
      username: 'me',
      organizationId: null,
      role: null,
    };
    manager = {
      findOne: jest.fn().mockResolvedValue(null),
      save: jest.fn(async (_e: unknown, row: unknown) => row),
      create: jest.fn((_e: unknown, row: unknown) => row),
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
    };
    opRepo = { exists: jest.fn().mockResolvedValue(false) };
    client = {
      resolve: jest.fn().mockResolvedValue(purchase()),
      activate: jest.fn().mockResolvedValue(undefined),
      getSubscription: jest.fn().mockResolvedValue(purchase().subscription),
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
    it('describes a new purchase as ready for this account', async () => {
      const res = await service.describe(USER_ID, 'token');
      expect(client.resolve).toHaveBeenCalledWith('token');
      expect(res).toMatchObject({
        state: 'ready',
        plan: 'team',
        planId: 'kk-team',
        saasStatus: 'PendingFulfillmentStart',
        purchaserEmail: 'buyer@acme.example',
        termUnit: 'P1M',
        target: { kind: 'user', name: 'me@acme.example' },
      });
    });

    it('activates a new purchase with Microsoft and links it to the user', async () => {
      const res = await service.activate(USER_ID, 'token');

      expect(client.activate).toHaveBeenCalledWith(SUB_ID);
      expect(manager.save).toHaveBeenCalledWith(
        Subscription,
        expect.objectContaining({
          userId: USER_ID,
          organizationId: null,
          source: 'marketplace',
          marketplaceSubscriptionId: SUB_ID,
          marketplaceOfferId: OFFER,
          marketplacePlanId: 'kk-team',
          marketplaceStatus: 'Subscribed',
          plan: 'team',
          status: 'active',
          stripeCustomerId: null,
          currentPeriodEnd: new Date('2026-11-13T00:00:00Z'),
          cancelAtPeriodEnd: false,
        }),
      );
      expect(res).toMatchObject({ state: 'active', saasStatus: 'Subscribed' });
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
      manager.findOne.mockResolvedValue(row);

      await service.activate(USER_ID, 'token');

      expect(manager.save).toHaveBeenCalledWith(
        Subscription,
        expect.objectContaining({
          id: 'row-1',
          stripeCustomerId: 'cus_1',
          stripeSubscriptionId: null,
          source: 'marketplace',
          plan: 'team',
        }),
      );
    });

    it("links an organization owner's purchase to the organization", async () => {
      user.organizationId = 'org-1';
      user.role = 'owner';

      const described = await service.describe(USER_ID, 'token');
      expect(described.target).toEqual({
        kind: 'organization',
        name: 'Acme',
      });

      await service.activate(USER_ID, 'token');
      expect(manager.findOne).toHaveBeenCalledWith(
        Subscription,
        expect.objectContaining({ where: { organizationId: 'org-1' } }),
      );
      expect(manager.save).toHaveBeenCalledWith(
        Subscription,
        expect.objectContaining({ organizationId: 'org-1', userId: null }),
      );
    });

    it('links without calling Activate when Microsoft already activated it', async () => {
      client.resolve.mockResolvedValue(
        purchase({ saasSubscriptionStatus: 'Subscribed' }),
      );
      await service.activate(USER_ID, 'token');
      expect(client.activate).not.toHaveBeenCalled();
      expect(manager.save).toHaveBeenCalled();
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
        plan: 'starter',
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

    it('does not link when Microsoft refuses the activation', async () => {
      client.activate.mockRejectedValue(new MarketplaceApiError('no', 400));
      await expect(service.activate(USER_ID, 'token')).rejects.toThrow(
        BadGatewayException,
      );
      expect(manager.save).not.toHaveBeenCalled();
    });

    it('treats a parallel activation of the same purchase as done', async () => {
      const unique = new QueryFailedError('INSERT', [], {
        code: '23505',
      } as any);
      manager.save.mockRejectedValueOnce(unique);
      subRepo.findOne
        .mockResolvedValueOnce(null) // assess
        .mockResolvedValueOnce(linkedRow()); // after the unique violation
      await expect(service.activate(USER_ID, 'token')).resolves.toMatchObject({
        state: 'active',
      });
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
      manager.findOne.mockResolvedValue(linkedRow());
    });

    const savedRow = (): Subscription =>
      manager.save.mock.calls.find(
        ([entity]: [unknown]) => entity === Subscription,
      )?.[1];

    it('rejects an invalid token before doing anything', async () => {
      verifier.verify.mockRejectedValue(new UnauthorizedException());
      await expect(service.handleWebhook('Bearer bad', body())).rejects.toThrow(
        UnauthorizedException,
      );
      expect(client.getOperation).not.toHaveBeenCalled();
      expect(opRepo.exists).not.toHaveBeenCalled();
    });

    it('rejects a payload without id, subscriptionId or action', async () => {
      await expect(
        service.handleWebhook(auth, { action: 'Suspend' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('confirms the operation with Microsoft before acting', async () => {
      await service.handleWebhook(auth, body());
      expect(verifier.verify).toHaveBeenCalledWith(auth);
      expect(client.getOperation).toHaveBeenCalledWith(SUB_ID, 'op-1');
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

    it('acknowledges a redelivered operation without applying it again', async () => {
      opRepo.exists.mockResolvedValue(true);
      await expect(service.handleWebhook(auth, body())).resolves.toBe(
        'duplicate',
      );
      expect(client.getOperation).not.toHaveBeenCalled();
      expect(manager.save).not.toHaveBeenCalled();
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
      expect(manager.insert).toHaveBeenCalledWith(MarketplaceOperation, {
        id: 'op-1',
        subscriptionId: SUB_ID,
        action: 'Suspend',
        result: 'applied',
        detail: null,
      });
    });

    it('Suspend keeps the plan and starts the grace period', async () => {
      await service.handleWebhook(auth, body());
      expect(savedRow()).toMatchObject({
        plan: 'team',
        status: 'past_due',
        marketplaceStatus: 'Suspended',
        pastDueSince: expect.any(Date),
      });
      // Notify-only: no PATCH.
      expect(client.updateOperation).not.toHaveBeenCalled();
    });

    it('Suspend keeps an earlier pastDueSince', async () => {
      const since = new Date('2026-10-01T00:00:00Z');
      manager.findOne.mockResolvedValue(
        linkedRow({ status: 'past_due', pastDueSince: since }),
      );
      await service.handleWebhook(auth, body());
      expect(savedRow().pastDueSince).toBe(since);
    });

    it('Reinstate restores the subscription and accepts the operation', async () => {
      manager.findOne.mockResolvedValue(
        linkedRow({
          status: 'past_due',
          pastDueSince: new Date(),
          marketplaceStatus: 'Suspended',
        }),
      );
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
      );
    });

    it('Renew updates the term from Microsoft', async () => {
      client.getOperation.mockResolvedValue(op({ action: 'Renew' }));
      client.getSubscription.mockResolvedValue({
        ...purchase().subscription,
        saasSubscriptionStatus: 'Subscribed',
        term: { endDate: '2026-12-13T00:00:00Z', termUnit: 'P1M' },
        autoRenew: true,
      });
      await service.handleWebhook(auth, body({ action: 'Renew' }));
      expect(client.getSubscription).toHaveBeenCalledWith(SUB_ID);
      expect(savedRow().currentPeriodEnd).toEqual(
        new Date('2026-12-13T00:00:00Z'),
      );
      expect(client.updateOperation).not.toHaveBeenCalled();
    });

    it('Subscribe (auto-activation) marks a linked subscription active', async () => {
      manager.findOne.mockResolvedValue(
        linkedRow({ status: 'canceled', marketplaceStatus: null }),
      );
      client.getOperation.mockResolvedValue(op({ action: 'Subscribe' }));
      await service.handleWebhook(auth, body({ action: 'Subscribe' }));
      expect(savedRow()).toMatchObject({
        status: 'active',
        marketplaceStatus: 'Subscribed',
      });
    });

    it('Subscribe for a purchase nobody linked yet is recorded and ignored', async () => {
      manager.findOne.mockResolvedValue(null);
      client.getOperation.mockResolvedValue(op({ action: 'Subscribe' }));
      await expect(
        service.handleWebhook(auth, body({ action: 'Subscribe' })),
      ).resolves.toBe('processed');
      expect(savedRow()).toBeUndefined();
      expect(manager.insert).toHaveBeenCalledWith(
        MarketplaceOperation,
        expect.objectContaining({
          result: 'ignored',
          detail: 'not linked to an account',
        }),
      );
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
      );
      expect(manager.insert).toHaveBeenCalledWith(
        MarketplaceOperation,
        expect.objectContaining({ result: 'rejected' }),
      );
    });

    it('ChangePlan below Team dissolves the organization, like Stripe', async () => {
      manager.findOne.mockResolvedValue(
        linkedRow({ userId: null, organizationId: 'org-1' }),
      );
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
      expect(savedRow().plan).toBe('starter');
      expect(billing.queueDissolution).toHaveBeenCalledWith('org-1', false);
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
      );
    });

    it('Unsubscribe drops the account to free', async () => {
      client.getOperation.mockResolvedValue(op({ action: 'Unsubscribe' }));
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

    it('Unsubscribe of an organization subscription dissolves the organization', async () => {
      manager.findOne.mockResolvedValue(
        linkedRow({ userId: null, organizationId: 'org-1' }),
      );
      client.getOperation.mockResolvedValue(op({ action: 'Unsubscribe' }));
      await service.handleWebhook(auth, body({ action: 'Unsubscribe' }));
      expect(billing.queueDissolution).toHaveBeenCalledWith('org-1', true);
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
      expect(manager.insert).toHaveBeenCalledWith(
        MarketplaceOperation,
        expect.objectContaining({ result: 'ignored' }),
      );
    });

    it('does not touch a row a Stripe checkout took over', async () => {
      manager.findOne.mockResolvedValue(
        linkedRow({ source: 'stripe', stripeSubscriptionId: 'sub_1' }),
      );
      client.getOperation.mockResolvedValue(op({ action: 'Unsubscribe' }));
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
