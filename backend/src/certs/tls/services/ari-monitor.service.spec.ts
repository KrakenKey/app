import * as x509 from '@peculiar/x509';
import { webcrypto } from 'node:crypto';
import { AriMonitorService } from './ari-monitor.service';
import { ariCertId } from '../util/ari';

const DAY = 86_400_000;
const NOT_BEFORE = new Date('2026-10-01T00:00:00Z');
const NOT_AFTER = new Date(NOT_BEFORE.getTime() + 90 * DAY);
// Day 40 of the certificate's life
const NOW = new Date(NOT_BEFORE.getTime() + 40 * DAY);

let LEAF_PEM: string;

beforeAll(async () => {
  x509.cryptoProvider.set(webcrypto as unknown as Crypto);
  const alg = { name: 'ECDSA', namedCurve: 'P-256', hash: 'SHA-256' };
  const ca = await webcrypto.subtle.generateKey(alg, false, ['sign', 'verify']);
  const keys = await webcrypto.subtle.generateKey(alg, false, [
    'sign',
    'verify',
  ]);
  const leaf = await x509.X509CertificateGenerator.create({
    serialNumber: '0abc',
    subject: 'CN=labxp.io',
    issuer: 'CN=Test CA',
    notBefore: NOT_BEFORE,
    notAfter: NOT_AFTER,
    signingAlgorithm: alg,
    publicKey: keys.publicKey,
    signingKey: ca.privateKey,
    extensions: [
      await x509.AuthorityKeyIdentifierExtension.create(ca.publicKey),
    ],
  });
  LEAF_PEM = leaf.toString('pem');
});

const at = (day: number) => new Date(NOT_BEFORE.getTime() + day * DAY);

describe('AriMonitorService', () => {
  let repo: { find: jest.Mock; update: jest.Mock };
  let users: { findOneBy: jest.Mock };
  let tls: { renewInternal: jest.Mock };
  let ari: { isEnabled: jest.Mock; getRenewalInfo: jest.Mock };
  let billing: { resolveUserTier: jest.Mock };
  let metrics: { ariChecksTotal: { inc: jest.Mock } };
  let svc: AriMonitorService;

  const cert = (over: Record<string, unknown> = {}) => ({
    id: 7,
    userId: 'u1',
    crtPem: LEAF_PEM,
    ariCertId: null,
    ariWindowStart: null,
    ariReplacementRequestedAt: null,
    ...over,
  });
  const window = (startDay: number, endDay: number, explanationUrl = null) => ({
    window: { start: at(startDay), end: at(endDay), explanationUrl },
    retryAfterSeconds: 6 * 3600,
  });
  const saved = () => repo.update.mock.calls.at(-1)![1];

  beforeEach(() => {
    repo = { find: jest.fn(), update: jest.fn() };
    users = {
      findOneBy: jest
        .fn()
        .mockResolvedValue({ autoRenewalConfirmedAt: new Date() }),
    };
    tls = { renewInternal: jest.fn() };
    ari = {
      isEnabled: jest.fn().mockReturnValue(true),
      getRenewalInfo: jest.fn(),
    };
    billing = { resolveUserTier: jest.fn().mockResolvedValue('starter') };
    metrics = { ariChecksTotal: { inc: jest.fn() } };
    svc = new AriMonitorService(
      repo as any,
      users as any,
      tls as any,
      ari as any,
      billing as any,
      metrics as any,
    );
  });

  it('does nothing when ARI is disabled', async () => {
    ari.isEnabled.mockReturnValue(false);
    await svc.checkRenewalInfo(NOW);
    expect(repo.find).not.toHaveBeenCalled();
  });

  it('stores a normal window and leaves renewal to the plan window', async () => {
    repo.find.mockResolvedValue([cert()]);
    ari.getRenewalInfo.mockResolvedValue(window(60, 62));
    await svc.checkRenewalInfo(NOW);

    expect(ari.getRenewalInfo).toHaveBeenCalledWith(ariCertId(LEAF_PEM));
    expect(saved()).toMatchObject({
      ariCertId: ariCertId(LEAF_PEM),
      ariWindowStart: at(60),
      ariWindowEnd: at(62),
      ariReplacementRequestedAt: null,
      ariNextCheckAt: new Date(NOW.getTime() + 6 * 3600 * 1000),
    });
    expect(tls.renewInternal).not.toHaveBeenCalled();
    expect(metrics.ariChecksTotal.inc).toHaveBeenCalledWith({ result: 'ok' });
  });

  it('renews right away when the CA moves an open window earlier', async () => {
    repo.find.mockResolvedValue([cert({ ariWindowStart: at(60) })]);
    ari.getRenewalInfo.mockResolvedValue(window(38, 39));
    await svc.checkRenewalInfo(NOW);

    expect(saved().ariReplacementRequestedAt).toEqual(NOW);
    expect(tls.renewInternal).toHaveBeenCalledWith(7);
    expect(metrics.ariChecksTotal.inc).toHaveBeenCalledWith({
      result: 'early_replacement',
    });
  });

  it('waits for an early window that has not opened, and checks again when it does', async () => {
    repo.find.mockResolvedValue([cert({ ariWindowStart: at(60) })]);
    ari.getRenewalInfo.mockResolvedValue(window(40.1, 41));
    await svc.checkRenewalInfo(NOW);

    expect(saved().ariReplacementRequestedAt).toEqual(NOW);
    expect(saved().ariNextCheckAt).toEqual(at(40.1));
    expect(tls.renewInternal).not.toHaveBeenCalled();
  });

  it('treats an explanation URL as an early replacement request', async () => {
    repo.find.mockResolvedValue([cert({ ariWindowStart: at(39) })]);
    ari.getRenewalInfo.mockResolvedValue(
      window(39, 40, 'https://letsencrypt.org/incident' as never),
    );
    await svc.checkRenewalInfo(NOW);
    expect(saved().ariExplanationUrl).toBe('https://letsencrypt.org/incident');
    expect(tls.renewInternal).toHaveBeenCalledWith(7);
  });

  it('keeps a request already recorded even if the next window looks normal', async () => {
    repo.find.mockResolvedValue([
      cert({ ariWindowStart: at(30), ariReplacementRequestedAt: at(35) }),
    ]);
    ari.getRenewalInfo.mockResolvedValue(window(30, 31));
    await svc.checkRenewalInfo(NOW);
    expect(saved().ariReplacementRequestedAt).toEqual(at(35));
    expect(tls.renewInternal).toHaveBeenCalledWith(7);
  });

  it('does not renew early for a free owner whose auto-renewal lapsed', async () => {
    billing.resolveUserTier.mockResolvedValue('free');
    users.findOneBy.mockResolvedValue({ autoRenewalConfirmedAt: null });
    repo.find.mockResolvedValue([cert({ ariWindowStart: at(60) })]);
    ari.getRenewalInfo.mockResolvedValue(window(38, 39));
    await svc.checkRenewalInfo(NOW);
    expect(saved().ariReplacementRequestedAt).toEqual(NOW);
    expect(tls.renewInternal).not.toHaveBeenCalled();
  });

  it('backs off a day when the CA has no info, six hours after an error', async () => {
    repo.find.mockResolvedValue([cert()]);
    ari.getRenewalInfo.mockResolvedValueOnce(null);
    await svc.checkRenewalInfo(NOW);
    expect(saved().ariNextCheckAt).toEqual(new Date(NOW.getTime() + DAY));

    ari.getRenewalInfo.mockRejectedValueOnce(new Error('503'));
    await svc.checkRenewalInfo(NOW);
    expect(saved().ariNextCheckAt).toEqual(
      new Date(NOW.getTime() + 6 * 3600 * 1000),
    );
    expect(metrics.ariChecksTotal.inc).toHaveBeenCalledWith({
      result: 'error',
    });
  });

  it('skips certificates without a readable leaf', async () => {
    repo.find.mockResolvedValue([cert({ crtPem: null })]);
    await svc.checkRenewalInfo(NOW);
    expect(ari.getRenewalInfo).not.toHaveBeenCalled();
    expect(saved().ariNextCheckAt).toEqual(new Date(NOW.getTime() + DAY));
  });
});
