import {
  MalformedEventError,
  licenseArnCandidates,
  parseAwsMarketplaceEvent,
} from './aws-marketplace-events';

// Shapes from the Seller Guide's example events
// (https://docs.aws.amazon.com/marketplace/latest/userguide/notifications-eventbridge.html).
const licenseUpdated = {
  version: '0',
  id: '12345678-1234-1234-1234-123456789012',
  'detail-type': 'License Updated - Manufacturer',
  source: 'aws.agreement-marketplace',
  account: '123456789012',
  time: '2024-08-30T21:36:03Z',
  region: 'us-east-1',
  resources: [
    'arn:aws:aws-marketplace::aws:agreement:agmt-4mwg1nevbokzw95eca5797ixs',
  ],
  detail: {
    requestId: '3d4c9f9b-b809-4f5e-9fac-a9ae98b05cbb',
    catalog: 'AWSMarketplace',
    agreement: { id: 'agmt-4mwg1nevbokzw95eca5797ixs' },
    product: { code: 'aw4fgf5tyo5w2ap6fEXAMPLE', id: 'prod-qtwveEXAMPLE' },
    license: {
      arn: 'aws:license-manager:us-east-1:123456789012:l-e52ca6f38bf84d0fafb8802ca15ac11x',
    },
    acceptor: { accountId: '845735284135' },
    proposer: { accountId: '123456512334' },
    offer: { id: '8kkr91jo647j3qxlcjhlqce7y' },
  },
};

const agreementAmended = {
  version: '0',
  id: 'amend-1',
  'detail-type': 'Purchase Agreement Amended - Proposer',
  source: 'aws.agreement-marketplace',
  detail: {
    agreement: {
      id: 'agmt-1',
      intent: 'AMEND',
      status: 'ACTIVE',
      autoRenewalEnabled: false,
    },
    acceptor: { accountId: '845735284135' },
  },
};

describe('parseAwsMarketplaceEvent', () => {
  it('reads a License Updated event', () => {
    expect(parseAwsMarketplaceEvent(JSON.stringify(licenseUpdated))).toEqual({
      id: '12345678-1234-1234-1234-123456789012',
      detailType: 'License Updated - Manufacturer',
      source: 'aws.agreement-marketplace',
      agreementId: 'agmt-4mwg1nevbokzw95eca5797ixs',
      previousAgreementId: null,
      acceptorAccountId: '845735284135',
      licenseArn:
        'aws:license-manager:us-east-1:123456789012:l-e52ca6f38bf84d0fafb8802ca15ac11x',
      productCode: 'aw4fgf5tyo5w2ap6fEXAMPLE',
      autoRenewalEnabled: null,
    });
  });

  it('reads auto-renewal from an Amended event', () => {
    const event = parseAwsMarketplaceEvent(JSON.stringify(agreementAmended));
    expect(event.autoRenewalEnabled).toBe(false);
    expect(event.licenseArn).toBeNull();
    expect(event.productCode).toBeNull();
  });

  it('reads the previous agreement of a renewal', () => {
    const event = parseAwsMarketplaceEvent(
      JSON.stringify({
        id: 'renew-1',
        'detail-type': 'Purchase Agreement Created - Proposer',
        source: 'aws.agreement-marketplace',
        detail: {
          agreement: {
            id: 'agmt-new',
            intent: 'RENEW',
            previousAgreementId: 'agmt-old',
          },
        },
      }),
    );
    expect(event.agreementId).toBe('agmt-new');
    expect(event.previousAgreementId).toBe('agmt-old');
  });

  it('refuses bodies that are not EventBridge events', () => {
    expect(() => parseAwsMarketplaceEvent('not json')).toThrow(
      MalformedEventError,
    );
    expect(() => parseAwsMarketplaceEvent('[]')).toThrow(MalformedEventError);
    expect(() =>
      parseAwsMarketplaceEvent(JSON.stringify({ id: 'x', source: 'y' })),
    ).toThrow(MalformedEventError);
  });

  it('tolerates a missing or odd detail', () => {
    const event = parseAwsMarketplaceEvent(
      JSON.stringify({
        id: 'x',
        source: 'aws.agreement-marketplace',
        'detail-type': 'License Updated - Manufacturer',
        detail: { license: 'nope', agreement: [] },
      }),
    );
    expect(event.licenseArn).toBeNull();
    expect(event.agreementId).toBeNull();
  });
});

describe('licenseArnCandidates', () => {
  it('keeps a full ARN as is', () => {
    expect(
      licenseArnCandidates('arn:aws:license-manager::1:license:l-1'),
    ).toEqual(['arn:aws:license-manager::1:license:l-1']);
  });

  it('also tries a full ARN for one without the arn: prefix', () => {
    expect(licenseArnCandidates('aws:license-manager:us-east-1:1:l-1')).toEqual(
      [
        'aws:license-manager:us-east-1:1:l-1',
        'arn:aws:license-manager:us-east-1:1:l-1',
      ],
    );
  });
});
