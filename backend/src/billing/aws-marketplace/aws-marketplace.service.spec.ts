import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { QueryFailedError } from 'typeorm';
import { AwsMarketplaceConfig } from './aws-marketplace.config';
import {
  AwsMarketplaceApiError,
  AwsMarketplaceTokenError,
  type AwsEntitlement,
} from './aws-marketplace.client';
import {
  AwsMarketplaceService,
  EXPIRATION_GRACE_MS,
  REGISTRATION_EXPIRED_MESSAGE,
  hashRegistrationId,
} from './aws-marketplace.service';
import { Subscription } from '../entities/subscription.entity';

const USER_ID = 'user-1';
const OTHER_USER = 'user-2';
const ORG_ID = 'org-1';
const PRODUCT = 'prod-code';
const ACCOUNT = '444455556666';
const LICENSE = 'arn:aws:license-manager::111122223333:license:l-abc';
const LICENSE_2 = 'arn:aws:license-manager::111122223333:license:l-def';
const AGREEMENT = 'agmt-1';
const REG_ID = 'reg-id-from-the-url';
const FUTURE = new Date(Date.now() + 30 * 24 * 3600_000);

function makeConfig(enabled = true): AwsMarketplaceConfig {
  return new AwsMarketplaceConfig({
    get: (key: string) =>
      ({
        KK_AWS_MARKETPLACE_ENABLED: enabled ? 'true' : 'false',
        KK_AWS_MARKETPLACE_DIMENSION_MAP: 'pro=pro,business=business',
        KK_AWS_MARKETPLACE_PRODUCT_CODES: PRODUCT,
        KK_AWS_MARKETPLACE_QUEUE_URL:
          'https://sqs.us-east-1.amazonaws.com/111122223333/q',
        KK_APP_DOMAIN: 'app.example.test',
      })[key],
  } as any);
}

function ent(overrides: Partial<AwsEntitlement> = {}): AwsEntitlement {
  return {
    dimension: 'pro',
    licenseArn: LICENSE,
    customerAwsAccountId: ACCOUNT,
    productCode: PRODUCT,
    expirationDate: FUTURE,
    value: { integer: 1 },
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
    source: 'aws_marketplace',
    marketplaceSubscriptionId: LICENSE,
    marketplaceOfferId: PRODUCT,
    marketplacePlanId: 'pro',
    marketplaceStatus: 'active',
    marketplaceQuantity: null,
    awsCustomerAccountId: ACCOUNT,
    awsAgreementId: AGREEMENT,
    billingInterval: null,
    plan: 'pro',
    status: 'active',
    pastDueSince: null,
    currentPeriodEnd: FUTURE,
    cancelAtPeriodEnd: false,
    updatedAt: new Date(),
    ...overrides,
  } as Subscription;
}

function event(
  detailType: string,
  detail: Record<string, unknown>,
  id = 'evt-1',
  source = 'aws.agreement-marketplace',
): string {
  return JSON.stringify({
    version: '0',
    id,
    'detail-type': detailType,
    source,
    account: '111122223333',
    region: 'us-east-1',
    detail,
  });
}

function uniqueViolation() {
  return new QueryFailedError(
    'INSERT',
    [],
    Object.assign(new Error('duplicate key'), { code: '23505' }),
  );
}

/** Matches a TypeORM where clause (plain values and In()) against a row. */
function matches(row: any, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([key, value]) => {
    if (value && typeof value === 'object' && (value as any).type === 'in') {
      return ((value as any).value as unknown[]).includes(row[key]);
    }
    return row[key] === value;
  });
}

describe('AwsMarketplaceService', () => {
  let service: AwsMarketplaceService;
  let config: AwsMarketplaceConfig;
  let rows: Subscription[];
  let savedRows: any[];
  let operations: any[];
  let registrations: Map<string, any>;
  let user: any;
  let manager: any;
  let subRepo: any;
  let userRepo: any;
  let orgRepo: any;
  let opRepo: any;
  let regRepo: any;
  let client: any;
  let billing: any;
  let entitlements: AwsEntitlement[];

  const find = (where: any) => {
    const clauses = Array.isArray(where) ? where : [where];
    return rows.filter((r) => clauses.some((c) => matches(r, c)));
  };

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    jest.spyOn(Logger.prototype, 'error').mockImplementation();

    user = {
      id: USER_ID,
      email: 'me@acme.example',
      username: 'me',
      organizationId: null,
      role: null,
    };
    rows = [];
    savedRows = [];
    operations = [];
    registrations = new Map();
    entitlements = [ent()];

    manager = {
      query: jest.fn().mockResolvedValue([]),
      findOne: jest.fn(
        async (_e: unknown, opts: any) => find(opts.where)[0] ?? null,
      ),
      save: jest.fn(async (_e: unknown, row: any) => {
        if (!rows.includes(row)) rows.push(row);
        savedRows.push({ ...row });
        return row;
      }),
      create: jest.fn((_e: unknown, row: unknown) => ({ ...(row as object) })),
    };
    subRepo = {
      findOne: jest.fn(async (opts: any) => find(opts.where)[0] ?? null),
      find: jest.fn(async (opts: any) => find(opts.where)),
      manager: {
        transaction: jest.fn(async (cb: (m: unknown) => unknown) =>
          cb(manager),
        ),
      },
    };
    userRepo = { findOne: jest.fn(async () => user) };
    orgRepo = {
      findOne: jest.fn().mockResolvedValue({ id: ORG_ID, name: 'Acme' }),
      exists: jest.fn().mockResolvedValue(true),
    };
    opRepo = {
      findOne: jest.fn(
        async (opts: any) =>
          operations.find((o) => o.id === opts.where.id) ?? null,
      ),
      insert: jest.fn(async (op: any) => {
        if (operations.some((o) => o.id === op.id)) throw uniqueViolation();
        operations.push(op);
      }),
    };
    regRepo = {
      insert: jest.fn(async (reg: any) => registrations.set(reg.id, reg)),
      findOne: jest.fn(
        async (opts: any) => registrations.get(opts.where.id) ?? null,
      ),
      delete: jest.fn().mockResolvedValue({ affected: 0 }),
    };
    client = {
      resolveCustomer: jest.fn().mockResolvedValue({
        customerAwsAccountId: ACCOUNT,
        licenseArn: LICENSE,
        productCode: PRODUCT,
        agreementId: AGREEMENT,
      }),
      getEntitlements: jest.fn(async () => entitlements),
    };
    billing = {
      getSubscription: jest.fn(async (userId: string) => {
        const where = user.organizationId
          ? { organizationId: user.organizationId }
          : { userId };
        return find(where)[0] ?? null;
      }),
      queueDissolution: jest.fn().mockResolvedValue(undefined),
    };
    config = makeConfig();
    service = new AwsMarketplaceService(
      subRepo,
      userRepo,
      orgRepo,
      opRepo,
      regRepo,
      config,
      client,
      billing,
    );
  });

  afterEach(() => jest.restoreAllMocks());

  /** Stores a registration the way register() does. */
  function registration(overrides: Record<string, unknown> = {}) {
    registrations.set(hashRegistrationId(REG_ID), {
      id: hashRegistrationId(REG_ID),
      customerAwsAccountId: ACCOUNT,
      licenseArn: LICENSE,
      productCode: PRODUCT,
      agreementId: AGREEMENT,
      offerType: null,
      expiresAt: new Date(Date.now() + 3600_000),
      ...overrides,
    });
  }

  it('answers 404 while switched off', () => {
    const off = new AwsMarketplaceService(
      subRepo,
      userRepo,
      orgRepo,
      opRepo,
      regRepo,
      makeConfig(false),
      client,
      billing,
    );
    expect(off.enabled).toBe(false);
    expect(() => off.assertEnabled('POST', '/x')).toThrow('Cannot POST /x');
    expect(() => service.assertEnabled('POST', '/x')).not.toThrow();
  });

  // ---------------------------------------------------------------------------
  describe('register (fulfillment URL)', () => {
    it('resolves the token, stores the purchase under a hashed id and redirects with that id', async () => {
      const url = new URL(await service.register(' tok-123 ', undefined));
      expect(client.resolveCustomer).toHaveBeenCalledWith('tok-123');
      expect(url.origin).toBe('https://app.example.test');
      expect(url.pathname).toBe('/aws-marketplace');
      const id = url.searchParams.get('registration')!;
      expect(id).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(url.toString()).not.toContain('tok-123');
      const stored = registrations.get(hashRegistrationId(id));
      expect(stored).toMatchObject({
        customerAwsAccountId: ACCOUNT,
        licenseArn: LICENSE,
        productCode: PRODUCT,
        agreementId: AGREEMENT,
        offerType: null,
      });
      expect(registrations.has(id)).toBe(false);
      expect(stored.expiresAt.getTime()).toBeGreaterThan(Date.now());
    });

    it('records the offer type AWS sends for free trials', async () => {
      await service.register('tok', 'free-trial');
      expect([...registrations.values()][0].offerType).toBe('free-trial');
    });

    it('redirects with an error when the token is missing', async () => {
      for (const token of [undefined, '', '  ', 42, 'x'.repeat(8193)]) {
        const url = new URL(await service.register(token, undefined));
        expect(url.searchParams.get('error')).toBe('missing_token');
      }
      expect(client.resolveCustomer).not.toHaveBeenCalled();
    });

    it('redirects with an error when AWS refuses the token', async () => {
      client.resolveCustomer.mockRejectedValue(
        new AwsMarketplaceTokenError('ExpiredTokenException'),
      );
      const url = new URL(await service.register('tok', undefined));
      expect(url.searchParams.get('error')).toBe('invalid_token');
      expect(registrations.size).toBe(0);
    });

    it('redirects with an error when AWS is unavailable', async () => {
      client.resolveCustomer.mockRejectedValue(
        new AwsMarketplaceApiError(
          'ResolveCustomer',
          'ThrottlingException',
          400,
        ),
      );
      const url = new URL(await service.register('tok', undefined));
      expect(url.searchParams.get('error')).toBe('unavailable');
    });

    it('redirects with an error when the purchase cannot be stored', async () => {
      regRepo.insert.mockRejectedValue(new Error('db down'));
      const url = new URL(await service.register('tok', undefined));
      expect(url.searchParams.get('error')).toBe('unavailable');
    });

    it('refuses a product not sold here', async () => {
      client.resolveCustomer.mockResolvedValue({
        customerAwsAccountId: ACCOUNT,
        licenseArn: LICENSE,
        productCode: 'someone-elses',
        agreementId: null,
      });
      const url = new URL(await service.register('tok', undefined));
      expect(url.searchParams.get('error')).toBe('unknown_product');
      expect(registrations.size).toBe(0);
    });

    it('never logs the token', async () => {
      const logs = [
        jest.spyOn(Logger.prototype, 'log'),
        jest.spyOn(Logger.prototype, 'warn'),
        jest.spyOn(Logger.prototype, 'error'),
      ];
      await service.register('super-secret-token', undefined);
      client.resolveCustomer.mockRejectedValue(
        new AwsMarketplaceTokenError('InvalidTokenException'),
      );
      await service.register('super-secret-token', undefined);
      for (const spy of logs) {
        for (const call of spy.mock.calls) {
          expect(String(call[0])).not.toContain('super-secret-token');
        }
      }
    });
  });

  // ---------------------------------------------------------------------------
  describe('describe (landing page)', () => {
    beforeEach(() => registration());

    it('refuses an unknown or expired registration', async () => {
      await expect(service.describe(USER_ID, 'nope')).rejects.toThrow(
        REGISTRATION_EXPIRED_MESSAGE,
      );
      registration({ expiresAt: new Date(Date.now() - 1) });
      await expect(service.describe(USER_ID, REG_ID)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('shows an entitled purchase as ready', async () => {
      await expect(service.describe(USER_ID, REG_ID)).resolves.toEqual({
        state: 'ready',
        awsAccountId: ACCOUNT,
        dimension: 'pro',
        plan: 'pro',
        expiresAt: FUTURE.toISOString(),
        target: { kind: 'user', name: 'me@acme.example' },
      });
      expect(client.getEntitlements).toHaveBeenCalledWith(PRODUCT, LICENSE);
    });

    it('shows a purchase AWS has not granted yet as awaiting the entitlement', async () => {
      entitlements = [];
      await expect(service.describe(USER_ID, REG_ID)).resolves.toMatchObject({
        state: 'awaiting_entitlement',
        dimension: null,
        plan: null,
      });
    });

    it('treats a failed entitlement read as not granted yet', async () => {
      client.getEntitlements.mockRejectedValue(
        new AwsMarketplaceApiError('GetEntitlements', 'Throttling', 400),
      );
      await expect(service.describe(USER_ID, REG_ID)).resolves.toMatchObject({
        state: 'awaiting_entitlement',
      });
    });

    it('shows an expired contract as ended', async () => {
      entitlements = [
        ent({
          expirationDate: new Date(Date.now() - EXPIRATION_GRACE_MS - 1000),
        }),
      ];
      await expect(service.describe(USER_ID, REG_ID)).resolves.toMatchObject({
        state: 'ended',
      });
    });

    it('shows an unmapped dimension as an unknown plan', async () => {
      entitlements = [ent({ dimension: 'platinum' })];
      await expect(service.describe(USER_ID, REG_ID)).resolves.toMatchObject({
        state: 'unknown_plan',
        dimension: 'platinum',
        plan: null,
      });
    });

    it('shows a purchase linked to this account as active or pending', async () => {
      rows.push(linkedRow());
      await expect(service.describe(USER_ID, REG_ID)).resolves.toMatchObject({
        state: 'active',
      });
      rows[0].marketplaceStatus = 'pending';
      await expect(service.describe(USER_ID, REG_ID)).resolves.toMatchObject({
        state: 'pending',
      });
    });

    it('shows a purchase linked to another account', async () => {
      rows.push(linkedRow({ id: 'other', userId: OTHER_USER }));
      await expect(service.describe(USER_ID, REG_ID)).resolves.toMatchObject({
        state: 'linked_elsewhere',
      });
    });

    it('lets an ended license be linked again only once AWS grants it again', async () => {
      rows.push(
        linkedRow({
          marketplaceStatus: 'ended',
          plan: 'free',
          status: 'canceled',
        }),
      );
      await expect(service.describe(USER_ID, REG_ID)).resolves.toMatchObject({
        state: 'ready',
      });
      entitlements = [];
      await expect(service.describe(USER_ID, REG_ID)).resolves.toMatchObject({
        state: 'ended',
      });
    });

    it('asks organization members to get the owner', async () => {
      user.organizationId = ORG_ID;
      user.role = 'member';
      await expect(service.describe(USER_ID, REG_ID)).resolves.toMatchObject({
        state: 'not_owner',
        target: { kind: 'organization', name: 'Acme' },
      });
    });

    it.each([
      [
        'a live Stripe subscription',
        { source: 'stripe', stripeSubscriptionId: 'sub_1', status: 'active' },
        /billed by KrakenKey/,
      ],
      [
        'a live Microsoft subscription',
        {
          source: 'marketplace',
          marketplaceSubscriptionId: 'ms-1',
          marketplaceStatus: 'Subscribed',
          status: 'active',
        },
        /Microsoft Marketplace/,
      ],
      [
        'another live AWS license',
        { marketplaceSubscriptionId: LICENSE_2 },
        /another AWS Marketplace subscription/,
      ],
      [
        'another AWS license waiting for its entitlement',
        {
          marketplaceSubscriptionId: LICENSE_2,
          marketplaceStatus: 'pending',
          status: 'incomplete',
          plan: 'free',
        },
        /another AWS Marketplace subscription/,
      ],
    ])('refuses an account with %s', async (_label, fields, message) => {
      rows.push(linkedRow({ id: 'own', ...(fields as Partial<Subscription>) }));
      const result = await service.describe(USER_ID, REG_ID);
      expect(result.state).toBe('conflict');
      expect(result.message).toMatch(message);
    });
  });

  // ---------------------------------------------------------------------------
  describe('link', () => {
    beforeEach(() => registration());

    it('claims the license as pending, then applies the entitlement', async () => {
      const result = await service.link(USER_ID, REG_ID);
      expect(result).toMatchObject({
        state: 'active',
        plan: 'pro',
        dimension: 'pro',
        expiresAt: FUTURE.toISOString(),
      });
      expect(savedRows[0]).toMatchObject({
        userId: USER_ID,
        organizationId: null,
        source: 'aws_marketplace',
        marketplaceSubscriptionId: LICENSE,
        marketplaceOfferId: PRODUCT,
        marketplaceStatus: 'pending',
        awsCustomerAccountId: ACCOUNT,
        awsAgreementId: AGREEMENT,
        plan: 'free',
        status: 'incomplete',
        stripeCustomerId: null,
      });
      expect(rows[0]).toMatchObject({
        marketplaceStatus: 'active',
        marketplacePlanId: 'pro',
        plan: 'pro',
        status: 'active',
        currentPeriodEnd: FUTURE,
      });
      expect(manager.query).toHaveBeenCalledWith(
        'SELECT pg_advisory_xact_lock(hashtext($1))',
        [`aws-marketplace:${LICENSE}`],
      );
    });

    it('keeps the link pending until AWS grants the entitlement', async () => {
      entitlements = [];
      await expect(service.link(USER_ID, REG_ID)).resolves.toMatchObject({
        state: 'pending',
      });
      expect(rows[0]).toMatchObject({
        marketplaceStatus: 'pending',
        plan: 'free',
        status: 'incomplete',
      });
    });

    it('keeps the link pending when the sync fails', async () => {
      client.getEntitlements
        .mockResolvedValueOnce([]) // landing page read
        .mockRejectedValueOnce(
          new AwsMarketplaceApiError('GetEntitlements', 'Throttling', 400),
        );
      await expect(service.link(USER_ID, REG_ID)).resolves.toMatchObject({
        state: 'pending',
      });
      expect(rows[0].marketplaceStatus).toBe('pending');
    });

    it('links to the organization for its owner', async () => {
      user.organizationId = ORG_ID;
      user.role = 'owner';
      await service.link(USER_ID, REG_ID);
      expect(rows[0]).toMatchObject({
        userId: null,
        organizationId: ORG_ID,
        plan: 'pro',
      });
    });

    it('replaces an ended Stripe subscription on the same row', async () => {
      const own = linkedRow({
        id: 'own',
        source: 'stripe',
        stripeCustomerId: 'cus_1',
        stripeSubscriptionId: 'sub_old',
        marketplaceSubscriptionId: null,
        marketplaceStatus: null,
        awsCustomerAccountId: null,
        awsAgreementId: null,
        status: 'canceled',
        plan: 'free',
        billingInterval: 'year',
      });
      rows.push(own);
      await service.link(USER_ID, REG_ID);
      expect(rows).toHaveLength(1);
      expect(own).toMatchObject({
        source: 'aws_marketplace',
        stripeCustomerId: 'cus_1',
        stripeSubscriptionId: null,
        billingInterval: null,
        plan: 'pro',
      });
    });

    it('returns an already linked purchase without changing it', async () => {
      rows.push(linkedRow());
      await expect(service.link(USER_ID, REG_ID)).resolves.toMatchObject({
        state: 'active',
      });
      expect(manager.save).not.toHaveBeenCalled();
    });

    it('refuses organization members who are not the owner', async () => {
      user.organizationId = ORG_ID;
      user.role = 'member';
      await expect(service.link(USER_ID, REG_ID)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(manager.save).not.toHaveBeenCalled();
    });

    it('refuses an account with a live subscription', async () => {
      rows.push(
        linkedRow({
          id: 'own',
          source: 'stripe',
          stripeSubscriptionId: 'sub_1',
          marketplaceSubscriptionId: null,
        }),
      );
      await expect(service.link(USER_ID, REG_ID)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(manager.save).not.toHaveBeenCalled();
    });

    it('refuses an ended contract', async () => {
      entitlements = [
        ent({
          expirationDate: new Date(Date.now() - EXPIRATION_GRACE_MS - 1000),
        }),
      ];
      await expect(service.link(USER_ID, REG_ID)).rejects.toThrow(
        'This AWS Marketplace contract has ended.',
      );
    });

    it('catches a live subscription that appeared after the page loaded', async () => {
      // Not visible to getSubscription, but the locked read in the claim sees it.
      billing.getSubscription.mockResolvedValue(null);
      rows.push(
        linkedRow({
          id: 'own',
          source: 'stripe',
          stripeSubscriptionId: 'sub_1',
          marketplaceSubscriptionId: null,
        }),
      );
      await expect(service.link(USER_ID, REG_ID)).rejects.toThrow(
        'This account already has a paid subscription.',
      );
    });

    it('reports a license another account linked first', async () => {
      manager.save.mockImplementationOnce(async () => {
        rows.push(linkedRow({ id: 'other', userId: OTHER_USER }));
        throw uniqueViolation();
      });
      await expect(service.link(USER_ID, REG_ID)).rejects.toThrow(
        'already linked to another KrakenKey account',
      );
    });

    it('treats a parallel link from the same account as done', async () => {
      manager.save.mockImplementationOnce(async () => {
        rows.push(
          linkedRow({
            marketplaceStatus: 'pending',
            plan: 'free',
            status: 'incomplete',
          }),
        );
        throw uniqueViolation();
      });
      await expect(service.link(USER_ID, REG_ID)).resolves.toMatchObject({
        state: 'active',
      });
    });
  });

  // ---------------------------------------------------------------------------
  describe('readEntitlement', () => {
    it('picks the highest mapped plan among current entitlements', async () => {
      entitlements = [
        ent({ dimension: 'pro' }),
        ent({ dimension: 'business' }),
      ];
      await expect(
        service.readEntitlement(PRODUCT, LICENSE),
      ).resolves.toMatchObject({
        kind: 'entitled',
        dimension: 'business',
        plan: 'business',
      });
    });

    it('ignores entries for other licenses and entries that grant nothing', async () => {
      entitlements = [
        ent({ licenseArn: LICENSE_2, dimension: 'business' }),
        ent({ dimension: 'business', value: { integer: 0 } }),
        ent({ dimension: 'business', value: { boolean: false } }),
      ];
      await expect(service.readEntitlement(PRODUCT, LICENSE)).resolves.toEqual({
        kind: 'none',
      });
    });

    it('matches a license ARN reported without its arn: prefix', async () => {
      entitlements = [ent({ licenseArn: LICENSE.replace(/^arn:/, '') })];
      await expect(
        service.readEntitlement(PRODUCT, LICENSE),
      ).resolves.toMatchObject({
        kind: 'entitled',
      });
    });

    it('keeps a just-expired entitlement for the renewal grace, then ends it', async () => {
      const now = new Date();
      entitlements = [
        ent({ expirationDate: new Date(now.getTime() - 3600_000) }),
      ];
      await expect(
        service.readEntitlement(PRODUCT, LICENSE, now),
      ).resolves.toMatchObject({ kind: 'entitled' });
      entitlements = [
        ent({
          expirationDate: new Date(now.getTime() - EXPIRATION_GRACE_MS - 1),
        }),
      ];
      await expect(
        service.readEntitlement(PRODUCT, LICENSE, now),
      ).resolves.toMatchObject({ kind: 'expired' });
    });

    it('reports an unmapped dimension without a plan', async () => {
      entitlements = [ent({ dimension: 'platinum', expirationDate: null })];
      await expect(service.readEntitlement(PRODUCT, LICENSE)).resolves.toEqual({
        kind: 'entitled',
        dimension: 'platinum',
        plan: null,
        expiresAt: null,
      });
    });
  });

  // ---------------------------------------------------------------------------
  describe('events', () => {
    const licenseDetail = (arn = LICENSE) => ({
      agreement: { id: 'agmt-2' },
      product: { code: PRODUCT, id: 'prod-x' },
      license: { arn },
      acceptor: { accountId: ACCOUNT },
    });

    it('activates a pending link on License Updated and records the event', async () => {
      rows.push(
        linkedRow({
          marketplaceStatus: 'pending',
          plan: 'free',
          status: 'incomplete',
          marketplacePlanId: null,
        }),
      );
      await expect(
        service.handleEventMessage(
          event('License Updated - Manufacturer', licenseDetail()),
        ),
      ).resolves.toBe('processed');
      expect(rows[0]).toMatchObject({
        marketplaceStatus: 'active',
        plan: 'pro',
        status: 'active',
        awsAgreementId: 'agmt-2',
      });
      expect(operations).toEqual([
        expect.objectContaining({
          id: 'aws:evt-1',
          subscriptionId: LICENSE,
          action: 'License Updated - Manufacturer',
          result: 'applied',
          ackStatus: null,
        }),
      ]);
    });

    it('applies an upgrade to a higher tier', async () => {
      rows.push(linkedRow());
      entitlements = [ent({ dimension: 'business' })];
      await service.handleEventMessage(
        event('License Updated - Manufacturer', licenseDetail()),
      );
      expect(rows[0]).toMatchObject({
        plan: 'business',
        marketplacePlanId: 'business',
      });
    });

    it('matches a license ARN without its arn: prefix', async () => {
      rows.push(
        linkedRow({
          marketplaceStatus: 'pending',
          plan: 'free',
          status: 'incomplete',
        }),
      );
      await service.handleEventMessage(
        event(
          'License Updated - Manufacturer',
          licenseDetail(LICENSE.replace(/^arn:/, '')),
        ),
      );
      expect(rows[0].marketplaceStatus).toBe('active');
    });

    it('drops the account to Starter on License Deprovisioned and dissolves its organization', async () => {
      rows.push(linkedRow({ userId: null, organizationId: ORG_ID }));
      entitlements = [];
      await service.handleEventMessage(
        event('License Deprovisioned - Manufacturer', licenseDetail()),
      );
      expect(rows[0]).toMatchObject({
        marketplaceStatus: 'ended',
        plan: 'free',
        status: 'canceled',
        currentPeriodEnd: null,
      });
      expect(billing.queueDissolution).toHaveBeenCalledWith(ORG_ID, true);
      expect(operations[0]).toMatchObject({
        dissolveOrganizationId: ORG_ID,
        dissolveCancel: true,
      });
    });

    it('keeps the plan when AWS still reports the entitlement after a deprovision event', async () => {
      rows.push(linkedRow());
      await service.handleEventMessage(
        event('License Deprovisioned - Manufacturer', {
          ...licenseDetail(),
          agreement: { id: AGREEMENT },
        }),
      );
      expect(rows[0]).toMatchObject({
        marketplaceStatus: 'active',
        plan: 'pro',
      });
      expect(operations[0].result).toBe('ignored');
    });

    it('ends a pending link when its agreement ends without an entitlement', async () => {
      rows.push(
        linkedRow({
          marketplaceStatus: 'pending',
          plan: 'free',
          status: 'incomplete',
        }),
      );
      entitlements = [];
      await service.handleEventMessage(
        event('Purchase Agreement Ended - Proposer', {
          agreement: { id: AGREEMENT, status: 'CANCELLED' },
          acceptor: { accountId: ACCOUNT },
        }),
      );
      expect(rows[0].marketplaceStatus).toBe('ended');
      expect(billing.queueDissolution).not.toHaveBeenCalled();
    });

    it('keeps a pending link pending on other events without an entitlement', async () => {
      rows.push(
        linkedRow({
          marketplaceStatus: 'pending',
          plan: 'free',
          status: 'incomplete',
        }),
      );
      entitlements = [];
      await service.handleEventMessage(
        event('Purchase Agreement Created - Proposer', {
          agreement: { id: AGREEMENT, intent: 'NEW' },
          acceptor: { accountId: ACCOUNT },
        }),
      );
      expect(rows[0].marketplaceStatus).toBe('pending');
    });

    it('records a renewal by agreement and the auto-renew choice from Amended', async () => {
      rows.push(linkedRow());
      const renewed = new Date(FUTURE.getTime() + 365 * 24 * 3600_000);
      entitlements = [ent({ expirationDate: renewed })];
      await service.handleEventMessage(
        event(
          'Purchase Agreement Created - Proposer',
          {
            agreement: {
              id: 'agmt-renewal',
              intent: 'RENEW',
              previousAgreementId: AGREEMENT,
            },
          },
          'evt-renew',
        ),
      );
      expect(rows[0].currentPeriodEnd).toEqual(renewed);

      await service.handleEventMessage(
        event(
          'Purchase Agreement Amended - Proposer',
          { agreement: { id: AGREEMENT, autoRenewalEnabled: false } },
          'evt-amend',
        ),
      );
      expect(rows[0].cancelAtPeriodEnd).toBe(true);
    });

    it('re-reads every license of the buyer account for agreement events', async () => {
      rows.push(linkedRow({ awsAgreementId: null }));
      rows.push(
        linkedRow({
          id: 'row-2',
          userId: OTHER_USER,
          marketplaceSubscriptionId: LICENSE_2,
          awsAgreementId: null,
        }),
      );
      await service.handleEventMessage(
        event('Purchase Agreement Amended - Proposer', {
          agreement: { id: 'agmt-unknown' },
          acceptor: { accountId: ACCOUNT },
        }),
      );
      expect(client.getEntitlements).toHaveBeenCalledWith(PRODUCT, LICENSE);
      expect(client.getEntitlements).toHaveBeenCalledWith(PRODUCT, LICENSE_2);
      expect(operations).toHaveLength(1);
    });

    it('skips a redelivered event and re-queues the dissolution it recorded', async () => {
      operations.push({
        id: 'aws:evt-1',
        dissolveOrganizationId: ORG_ID,
        dissolveCancel: true,
      });
      await expect(
        service.handleEventMessage(
          event('License Deprovisioned - Manufacturer', licenseDetail()),
        ),
      ).resolves.toBe('duplicate');
      expect(client.getEntitlements).not.toHaveBeenCalled();
      expect(billing.queueDissolution).toHaveBeenCalledWith(ORG_ID, true);
    });

    it('treats a concurrent delivery of the same event as done', async () => {
      rows.push(linkedRow());
      opRepo.insert.mockRejectedValueOnce(uniqueViolation());
      await expect(
        service.handleEventMessage(
          event('License Updated - Manufacturer', licenseDetail()),
        ),
      ).resolves.toBe('processed');
    });

    it('records events for licenses that are not linked yet', async () => {
      await expect(
        service.handleEventMessage(
          event('License Updated - Manufacturer', licenseDetail()),
        ),
      ).resolves.toBe('processed');
      expect(client.getEntitlements).not.toHaveBeenCalled();
      expect(operations[0]).toMatchObject({
        result: 'ignored',
        detail: 'not linked to an account',
      });
    });

    it('ignores other sources, detail types and products', async () => {
      await expect(
        service.handleEventMessage(
          event('Offer Released', {}, 'e1', 'aws.marketplacecatalog'),
        ),
      ).resolves.toBe('ignored');
      await expect(
        service.handleEventMessage(
          event('Purchase Agreement Ending - Proposer', {}, 'e2'),
        ),
      ).resolves.toBe('ignored');
      await expect(
        service.handleEventMessage(
          event(
            'License Updated - Manufacturer',
            { ...licenseDetail(), product: { code: 'other' } },
            'e3',
          ),
        ),
      ).resolves.toBe('ignored');
      expect(operations.map((o) => o.result)).toEqual([
        'ignored',
        'ignored',
        'ignored',
      ]);
      expect(client.getEntitlements).not.toHaveBeenCalled();
    });

    it('drops malformed messages without recording them', async () => {
      await expect(service.handleEventMessage('{oops')).resolves.toBe(
        'ignored',
      );
      expect(operations).toHaveLength(0);
    });

    it('throws, without recording, when AWS cannot be reached', async () => {
      rows.push(linkedRow());
      client.getEntitlements.mockRejectedValue(
        new AwsMarketplaceApiError(
          'GetEntitlements',
          'InternalServiceErrorException',
          500,
        ),
      );
      await expect(
        service.handleEventMessage(
          event('License Updated - Manufacturer', licenseDetail()),
        ),
      ).rejects.toBeInstanceOf(AwsMarketplaceApiError);
      expect(operations).toHaveLength(0);
    });

    it('does not touch a license a Stripe checkout replaced', async () => {
      rows.push(
        linkedRow({
          source: 'stripe',
          stripeSubscriptionId: 'sub_1',
          marketplaceSubscriptionId: null,
        }),
      );
      await service.handleEventMessage(
        event('License Updated - Manufacturer', licenseDetail()),
      );
      expect(rows[0].source).toBe('stripe');
      expect(operations[0].detail).toBe('not linked to an account');
    });
  });

  // ---------------------------------------------------------------------------
  describe('reconcile', () => {
    it('re-checks pending and active licenses and records changes', async () => {
      rows.push(
        linkedRow({
          marketplaceStatus: 'pending',
          plan: 'free',
          status: 'incomplete',
        }),
      );
      rows.push(
        linkedRow({
          id: 'row-2',
          userId: OTHER_USER,
          marketplaceSubscriptionId: LICENSE_2,
        }),
      );
      rows.push(
        linkedRow({
          id: 'row-3',
          userId: 'user-3',
          marketplaceSubscriptionId: 'arn:ended',
          marketplaceStatus: 'ended',
        }),
      );
      client.getEntitlements.mockImplementation(
        async (_p: string, arn: string) =>
          arn === LICENSE ? [ent()] : [ent({ licenseArn: LICENSE_2 })],
      );
      await expect(service.reconcile()).resolves.toEqual({
        checked: 2,
        changed: 1,
        failed: 0,
      });
      expect(rows[0].marketplaceStatus).toBe('active');
      expect(operations).toEqual([
        expect.objectContaining({
          id: expect.stringMatching(/^aws-reconcile:/),
          subscriptionId: LICENSE,
          action: 'Reconcile',
          result: 'applied',
        }),
      ]);
      expect(regRepo.delete).toHaveBeenCalled();
    });

    it('ends a contract that expired without an event', async () => {
      rows.push(linkedRow());
      entitlements = [
        ent({
          expirationDate: new Date(Date.now() - EXPIRATION_GRACE_MS - 1000),
        }),
      ];
      await service.reconcile();
      expect(rows[0]).toMatchObject({
        marketplaceStatus: 'ended',
        plan: 'free',
      });
    });

    it('keeps going after a license fails', async () => {
      rows.push(linkedRow());
      rows.push(
        linkedRow({
          id: 'row-2',
          userId: OTHER_USER,
          marketplaceSubscriptionId: LICENSE_2,
          marketplaceStatus: 'pending',
          plan: 'free',
          status: 'incomplete',
        }),
      );
      client.getEntitlements
        .mockRejectedValueOnce(
          new AwsMarketplaceApiError('GetEntitlements', 'Throttling', 400),
        )
        .mockResolvedValueOnce([ent({ licenseArn: LICENSE_2 })]);
      await expect(service.reconcile()).resolves.toEqual({
        checked: 2,
        changed: 1,
        failed: 1,
      });
      expect(rows[1].marketplaceStatus).toBe('active');
    });
  });
});
