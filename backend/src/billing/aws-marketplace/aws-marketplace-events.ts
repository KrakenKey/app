/**
 * AWS Marketplace EventBridge events, as forwarded to SQS.
 *
 * Source and detail types are from the Seller Guide:
 * - https://docs.aws.amazon.com/marketplace/latest/userguide/saas-eventbridge-integration.html
 *   (which events a SaaS seller receives, and when)
 * - https://docs.aws.amazon.com/marketplace/latest/userguide/notifications-eventbridge.html
 *   (example payloads, "Events for agreements" and "Events for licenses")
 *
 * When the seller is both manufacturer and proposer (a public or private
 * offer it makes itself), AWS sends only the "- Proposer" agreement events;
 * the "- Manufacturer" ones arrive for channel partner offers. Both are
 * handled the same way.
 *
 * Agreement events identify the agreement (`detail.agreement.id`) and the
 * buyer (`detail.acceptor.accountId`) but not the license. License events
 * add `detail.license.arn` and `detail.product.code`. Nothing in an event is
 * trusted for state: every event only says which licenses to re-read with
 * GetEntitlements.
 */
export const AWS_MARKETPLACE_EVENT_SOURCE = 'aws.agreement-marketplace';

/** Detail types that can change what a license entitles. */
export const AGREEMENT_EVENT_TYPES = new Set([
  'Purchase Agreement Created - Proposer',
  'Purchase Agreement Created - Manufacturer',
  'Purchase Agreement Amended - Proposer',
  'Purchase Agreement Amended - Manufacturer',
  'Purchase Agreement Ended - Proposer',
  'Purchase Agreement Ended - Manufacturer',
]);

export const LICENSE_EVENT_TYPES = new Set([
  'License Updated - Manufacturer',
  'License Deprovisioned - Manufacturer',
]);

/**
 * Events after which a license with no entitlement left is over, even if it
 * was still waiting for its first entitlement.
 */
export const ENDING_EVENT_TYPES = new Set([
  'Purchase Agreement Ended - Proposer',
  'Purchase Agreement Ended - Manufacturer',
  'License Deprovisioned - Manufacturer',
]);

/** The fields KrakenKey reads from an event. */
export interface AwsMarketplaceEvent {
  /** EventBridge event id; unique per event, repeated on redelivery. */
  id: string;
  detailType: string;
  source: string;
  agreementId: string | null;
  /** Set on renewals (`intent` RENEW): the agreement this one replaces. */
  previousAgreementId: string | null;
  acceptorAccountId: string | null;
  licenseArn: string | null;
  productCode: string | null;
  /**
   * `detail.agreement.autoRenewalEnabled` from an Amended event, or null
   * when the event doesn't say.
   */
  autoRenewalEnabled: boolean | null;
}

export class MalformedEventError extends Error {}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
}

/**
 * Parses an SQS message body holding an EventBridge event (the rule's
 * target sends the event as is, without an input transformer). Throws
 * MalformedEventError when it isn't one.
 */
export function parseAwsMarketplaceEvent(body: string): AwsMarketplaceEvent {
  let raw: unknown;
  try {
    raw = JSON.parse(body);
  } catch {
    throw new MalformedEventError('message body is not JSON');
  }
  const event = obj(raw);
  const id = str(event.id);
  const detailType = str(event['detail-type']);
  const source = str(event.source);
  if (!id || !detailType || !source) {
    throw new MalformedEventError(
      'message is not an EventBridge event (id, source and detail-type are required)',
    );
  }
  const detail = obj(event.detail);
  const agreement = obj(detail.agreement);
  const auto = agreement.autoRenewalEnabled;
  return {
    id,
    detailType,
    source,
    agreementId: str(agreement.id),
    previousAgreementId: str(agreement.previousAgreementId),
    acceptorAccountId: str(obj(detail.acceptor).accountId),
    licenseArn: str(obj(detail.license).arn),
    productCode: str(obj(detail.product).code),
    autoRenewalEnabled: typeof auto === 'boolean' ? auto : null,
  };
}

/**
 * The forms a license ARN from an event may be stored under. The Seller
 * Guide's License Updated example shows the ARN without its `arn:` prefix
 * (`aws:license-manager:...`), while ResolveCustomer and GetEntitlements
 * return full ARNs, so both are tried.
 */
export function licenseArnCandidates(arn: string): string[] {
  if (arn.startsWith('arn:')) return [arn];
  return [arn, `arn:${arn}`];
}
