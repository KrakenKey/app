import type {
  CertEmailContext,
  DomainVerificationFailedContext,
} from '../email.service';

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function layout(title: string, body: string): string {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#09090b;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
  <div style="max-width:560px;margin:40px auto;background:#18181b;border:1px solid #27272a;border-radius:12px;overflow:hidden">
    <div style="padding:24px 32px;border-bottom:1px solid #27272a">
      <span style="font-size:18px;font-weight:600;color:#fafafa">KrakenKey</span>
    </div>
    <div style="padding:32px">
      <h2 style="margin:0 0 16px;font-size:20px;color:#fafafa">${title}</h2>
      ${body}
    </div>
    <div style="padding:16px 32px;border-top:1px solid #27272a;text-align:center">
      <span style="font-size:12px;color:#71717a">KrakenKey Certificate Management</span>
    </div>
  </div>
</body>
</html>`;
}

function p(text: string): string {
  return `<p style="margin:0 0 12px;font-size:14px;line-height:1.6;color:#a1a1aa">${escapeHtml(text)}</p>`;
}

function detail(label: string, value: string): string {
  return `<div style="margin:0 0 8px;font-size:14px"><span style="color:#71717a">${escapeHtml(label)}:</span> <span style="color:#fafafa">${escapeHtml(value)}</span></div>`;
}

export function certIssuedTemplate(ctx: CertEmailContext): string {
  return layout(
    'Certificate Issued',
    [
      p(
        `Hi ${ctx.username}, your TLS certificate has been successfully issued.`,
      ),
      detail('Certificate ID', String(ctx.certId)),
      detail('Common Name', ctx.commonName),
      ctx.expiresAt
        ? detail('Expires', ctx.expiresAt.toISOString().split('T')[0])
        : '',
    ].join(''),
  );
}

export function certRenewedTemplate(ctx: CertEmailContext): string {
  return layout(
    'Certificate Renewed',
    [
      p(`Hi ${ctx.username}, your TLS certificate has been renewed.`),
      detail('Certificate ID', String(ctx.certId)),
      detail('Common Name', ctx.commonName),
      ctx.expiresAt
        ? detail('New Expiry', ctx.expiresAt.toISOString().split('T')[0])
        : '',
    ].join(''),
  );
}

export function certExpiryWarningTemplate(ctx: CertEmailContext): string {
  return layout(
    'Certificate Expiring Soon',
    [
      `<p style="margin:0 0 12px;font-size:14px;line-height:1.6;color:#a1a1aa">Hi ${escapeHtml(ctx.username)}, your TLS certificate will expire in <strong style="color:#f59e0b">${ctx.daysUntilExpiry ?? 0} days</strong>.</p>`,
      detail('Certificate ID', String(ctx.certId)),
      detail('Common Name', ctx.commonName),
      ctx.expiresAt
        ? detail('Expires', ctx.expiresAt.toISOString().split('T')[0])
        : '',
      p('Auto-renewal will be attempted if enabled for this certificate.'),
    ].join(''),
  );
}

export function certFailedTemplate(ctx: CertEmailContext): string {
  return layout(
    'Certificate Issuance Failed',
    [
      p(`Hi ${ctx.username}, we were unable to issue your TLS certificate.`),
      detail('Certificate ID', String(ctx.certId)),
      detail('Common Name', ctx.commonName),
      ctx.errorMessage ? detail('Error', ctx.errorMessage) : '',
      p(
        'The system will retry automatically. If this persists, please check your domain configuration.',
      ),
    ].join(''),
  );
}

export function certRevokedTemplate(ctx: CertEmailContext): string {
  return layout(
    'Certificate Revoked',
    [
      p(`Hi ${ctx.username}, your TLS certificate has been revoked.`),
      detail('Certificate ID', String(ctx.certId)),
      detail('Common Name', ctx.commonName),
      p('If you did not request this, please contact support immediately.'),
    ].join(''),
  );
}

export function domainVerificationFailedTemplate(
  ctx: DomainVerificationFailedContext,
): string {
  return layout(
    'Domain Verification Failed',
    [
      p(
        `Hi ${ctx.username}, the DNS verification record for your domain is no longer detected.`,
      ),
      detail('Domain', ctx.hostname),
      p(
        'The domain has been marked as unverified. New certificate requests for this domain will be blocked until the TXT record is restored and the domain is re-verified.',
      ),
      detail('Expected TXT Record', ctx.verificationCode),
      p(
        'Please add the TXT record back to your DNS configuration and re-verify the domain in KrakenKey.',
      ),
    ].join(''),
  );
}
