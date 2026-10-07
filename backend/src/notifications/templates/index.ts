import type {
  CertEmailContext,
  DomainVerificationFailedContext,
  PlanLimitReachedContext,
  WelcomeContext,
  ActivationReminderContext,
  ApiKeyExpiredUseContext,
} from '../email.service';

export interface EmailContent {
  html: string;
  text: string;
}

export interface EmailBranding {
  /** Base URL of the dashboard, e.g. https://app.krakenkey.io */
  appUrl: string;
  /** Absolute URL of the logo image shown in the header. */
  logoUrl: string;
  /** Postal address shown in the footer when set. */
  postalAddress?: string;
}

type Tone = 'success' | 'warning' | 'danger' | 'info';

const TONES: Record<Tone, string> = {
  success: '#16a34a',
  warning: '#d97706',
  danger: '#dc2626',
  info: '#0891b2',
};

const FONT =
  "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const MONO =
  "ui-monospace,SFMono-Regular,Menlo,Consolas,'Liberation Mono',monospace";

const SUPPORT_EMAIL = 'support@krakenkey.io';

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Escapes text, renders `backtick` spans as inline code and links email
 * addresses, so clients don't auto-link them in their own colors.
 */
function inline(text: string): string {
  return escapeHtml(text)
    .replace(
      /`([^`]+)`/g,
      `<code style="font-family:${MONO};font-size:13px;background:#f4f4f5;border:1px solid #e4e4e7;border-radius:4px;padding:1px 5px;color:#18181b">$1</code>`,
    )
    .replace(
      /\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+\b/g,
      '<a href="mailto:$&" style="color:#0e7490;text-decoration:underline">$&</a>',
    );
}

function plain(text: string): string {
  return text.replace(/`([^`]+)`/g, '$1');
}

function formatDate(date: Date): string {
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

// Content blocks. Each renders to HTML and to plain text from the same input.

type Block =
  | { kind: 'para'; text: string }
  | { kind: 'details'; rows: [string, string, boolean?][] }
  | { kind: 'steps'; title?: string; items: string[] }
  | { kind: 'button'; label: string; href: string };

const para = (text: string): Block => ({ kind: 'para', text });
/** Rows of [label, value, monospace?]. Empty values are dropped. */
const details = (...rows: [string, string | undefined, boolean?][]): Block => ({
  kind: 'details',
  rows: rows.filter((r): r is [string, string, boolean?] => !!r[1]),
});
const steps = (items: string[], title?: string): Block => ({
  kind: 'steps',
  items,
  title,
});
const button = (label: string, href: string): Block => ({
  kind: 'button',
  label,
  href,
});

function blockHtml(block: Block, accent: string): string {
  switch (block.kind) {
    case 'para':
      return `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#3f3f46">${inline(block.text)}</p>`;
    case 'details':
      return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 20px;background:#fafafa;border:1px solid #e4e4e7;border-radius:8px">
${block.rows
  .map(([label, value, mono], i) => {
    const sep = i ? 'border-top:1px solid #e4e4e7;' : '';
    const valueStyle = `font-size:14px;color:#18181b;word-break:break-word;${mono ? `font-family:${MONO};font-size:13px;` : ''}`;
    // Long values get the full width under their label so they don't wrap
    // into a narrow column on phones.
    if (value.length > 32) {
      return `<tr><td colspan="2" style="padding:10px 16px;${sep}">
  <div style="font-size:13px;color:#71717a;margin:0 0 4px">${escapeHtml(label)}</div>
  <div style="${valueStyle}">${escapeHtml(value)}</div>
</td></tr>`;
    }
    return `<tr>
  <td style="padding:10px 16px;${sep}font-size:13px;color:#71717a;width:34%;vertical-align:top">${escapeHtml(label)}</td>
  <td style="padding:10px 16px;${sep}vertical-align:top;${valueStyle}">${escapeHtml(value)}</td>
</tr>`;
  })
  .join('\n')}
</table>`;
    case 'steps':
      return `${block.title ? `<p style="margin:0 0 10px;font-size:15px;font-weight:600;color:#18181b">${escapeHtml(block.title)}</p>` : ''}<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px">
${block.items
  .map(
    (item, i) => `<tr>
  <td style="width:28px;padding:0 0 10px;vertical-align:top"><div style="width:22px;height:22px;line-height:22px;border-radius:11px;background:${accent};color:#ffffff;font-size:12px;font-weight:600;text-align:center">${i + 1}</div></td>
  <td style="padding:2px 0 10px 8px;font-size:15px;line-height:1.5;color:#3f3f46;vertical-align:top">${inline(item)}</td>
</tr>`,
  )
  .join('\n')}
</table>`;
    case 'button':
      return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 24px">
<tr><td style="border-radius:6px;background:#0e7490">
  <a href="${escapeHtml(block.href)}" style="display:inline-block;padding:12px 22px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:6px">${escapeHtml(block.label)}</a>
</td></tr>
</table>`;
  }
}

function blockText(block: Block): string {
  switch (block.kind) {
    case 'para':
      return plain(block.text);
    case 'details': {
      const width = Math.max(...block.rows.map(([l]) => l.length)) + 2;
      return block.rows
        .map(([l, v]) => `${(l + ':').padEnd(width)}${v}`)
        .join('\n');
    }
    case 'steps':
      return [
        ...(block.title ? [block.title] : []),
        ...block.items.map((s, i) => `${i + 1}. ${plain(s)}`),
      ].join('\n');
    case 'button':
      return `${block.label}: ${block.href}`;
  }
}

interface EmailSpec {
  tone: Tone;
  /** Short status label above the title. */
  label: string;
  title: string;
  /** Inbox preview text shown after the subject line. */
  preheader: string;
  blocks: Block[];
  /** Why the recipient got this email; shown in the footer. */
  reason: string;
  /** Whether the footer links to notification settings. */
  manageable?: boolean;
}

function render(spec: EmailSpec, brand: EmailBranding): EmailContent {
  const accent = TONES[spec.tone];
  const settingsUrl = `${brand.appUrl}/settings`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${escapeHtml(spec.title)}</title>
</head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:${FONT};-webkit-text-size-adjust:100%">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${escapeHtml(spec.preheader)}${'&#847;&zwnj;&nbsp;'.repeat(40)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f4f4f5">
<tr><td align="center" style="padding:32px 16px">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px">
    <tr><td style="background:#18181b;border-radius:10px 10px 0 0;padding:18px 28px">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
        <td style="vertical-align:middle"><img src="${escapeHtml(brand.logoUrl)}" width="36" height="36" alt="" style="display:block;border:0"></td>
        <td style="vertical-align:middle;padding-left:10px;font-size:18px;font-weight:600;color:#fafafa;letter-spacing:-0.01em">KrakenKey</td>
      </tr></table>
    </td></tr>
    <tr><td style="height:4px;line-height:4px;font-size:0;background:${accent}">&nbsp;</td></tr>
    <tr><td style="background:#ffffff;border:1px solid #e4e4e7;border-top:0;border-radius:0 0 10px 10px;padding:28px 28px 8px">
      <p style="margin:0 0 6px;font-size:12px;font-weight:600;letter-spacing:0.06em;text-transform:uppercase;color:${accent}">${escapeHtml(spec.label)}</p>
      <h1 style="margin:0 0 20px;font-size:22px;line-height:1.3;font-weight:600;color:#18181b">${escapeHtml(spec.title)}</h1>
      ${spec.blocks.map((b) => blockHtml(b, accent)).join('\n      ')}
    </td></tr>
    <tr><td style="padding:20px 28px 0;font-size:12px;line-height:1.6;color:#71717a">
      <p style="margin:0 0 8px">${escapeHtml(spec.reason)}${spec.manageable ? ` <a href="${escapeHtml(settingsUrl)}" style="color:#0e7490;text-decoration:underline">Manage email notifications</a>.` : ''}</p>
      <p style="margin:0">KrakenKey LLC${brand.postalAddress ? ` &middot; ${escapeHtml(brand.postalAddress)}` : ''} &middot; <a href="https://krakenkey.io" style="color:#71717a;text-decoration:underline">krakenkey.io</a> &middot; <a href="mailto:${SUPPORT_EMAIL}" style="color:#71717a;text-decoration:underline">${SUPPORT_EMAIL}</a></p>
    </td></tr>
  </table>
</td></tr>
</table>
</body>
</html>`;

  const text = [
    spec.title,
    '',
    ...spec.blocks.flatMap((b) => [blockText(b), '']),
    '--',
    spec.reason +
      (spec.manageable ? ` Manage email notifications: ${settingsUrl}` : ''),
    [
      'KrakenKey LLC',
      brand.postalAddress,
      'https://krakenkey.io',
      SUPPORT_EMAIL,
    ]
      .filter(Boolean)
      .join(' | '),
    '',
  ].join('\n');

  return { html, text };
}

const CERT_REASON =
  'You received this because certificate notifications are on for your KrakenKey account.';
const ACCOUNT_REASON = 'You received this email about your KrakenKey account.';
const SECURITY_REASON =
  'This is a security notice about your KrakenKey account and is always sent.';

function certRows(ctx: CertEmailContext, expiryLabel = 'Valid until') {
  return details(
    ['Domain', ctx.commonName, true],
    ['Certificate ID', String(ctx.certId), true],
    [expiryLabel, ctx.expiresAt ? formatDate(ctx.expiresAt) : undefined],
  );
}

export function certIssuedTemplate(
  ctx: CertEmailContext,
  brand: EmailBranding,
): EmailContent {
  return render(
    {
      tone: 'success',
      label: 'Certificate issued',
      title: `Your certificate for ${ctx.commonName} is ready`,
      preheader: `Download it from the dashboard or with krakenkey cert download ${ctx.certId}.`,
      blocks: [
        para(
          `Hi ${ctx.username}, your TLS certificate has been issued and is ready to download.`,
        ),
        certRows(ctx),
        button('View certificate', `${brand.appUrl}/dashboard/certificates`),
        para(
          `From the CLI, run \`krakenkey cert download ${ctx.certId}\`. Most web servers want the full chain file.`,
        ),
      ],
      reason: CERT_REASON,
      manageable: true,
    },
    brand,
  );
}

export function certRenewedTemplate(
  ctx: CertEmailContext,
  brand: EmailBranding,
): EmailContent {
  return render(
    {
      tone: 'success',
      label: 'Certificate renewed',
      title: `${ctx.commonName} has been renewed`,
      preheader: ctx.expiresAt
        ? `The new certificate is valid until ${formatDate(ctx.expiresAt)}.`
        : 'Your renewed certificate is ready to download.',
      blocks: [
        para(
          `Hi ${ctx.username}, your TLS certificate has been renewed. The private key is unchanged, so only the certificate file needs replacing.`,
        ),
        certRows(ctx),
        button('View certificate', `${brand.appUrl}/dashboard/certificates`),
        para(
          'If you install certificates yourself, download the new one and reload your server. Tools that use the KrakenKey CLI or GitHub Action pick it up on their next run.',
        ),
      ],
      reason: CERT_REASON,
      manageable: true,
    },
    brand,
  );
}

export function certExpiryWarningTemplate(
  ctx: CertEmailContext,
  brand: EmailBranding,
): EmailContent {
  const days = ctx.daysUntilExpiry ?? 0;
  const when = days === 1 ? 'tomorrow' : `in ${days} days`;
  return render(
    {
      tone: 'warning',
      label: 'Expiring soon',
      title: `${ctx.commonName} expires ${when}`,
      preheader: `Renew it before ${ctx.expiresAt ? formatDate(ctx.expiresAt) : 'it expires'} to avoid downtime.`,
      blocks: [
        para(
          `Hi ${ctx.username}, your TLS certificate expires ${when}. Once it expires, browsers and API clients will refuse to connect.`,
        ),
        certRows(ctx, 'Expires'),
        para(
          `If auto-renewal is on for this certificate, KrakenKey renews it before then and you don't need to do anything. Otherwise, renew it from the dashboard or run \`krakenkey cert renew ${ctx.certId}\`.`,
        ),
        button('Review certificate', `${brand.appUrl}/dashboard/certificates`),
      ],
      reason: CERT_REASON,
      manageable: true,
    },
    brand,
  );
}

export function certFailedTemplate(
  ctx: CertEmailContext,
  brand: EmailBranding,
): EmailContent {
  return render(
    {
      tone: 'danger',
      label: 'Issuance failed',
      title: `We couldn't issue a certificate for ${ctx.commonName}`,
      preheader: 'Automatic retries didn’t succeed. Check DNS, then retry.',
      blocks: [
        para(
          `Hi ${ctx.username}, we tried several times to issue your TLS certificate and each attempt failed.`,
        ),
        details(
          ['Domain', ctx.commonName, true],
          ['Certificate ID', String(ctx.certId), true],
          ['Error', ctx.errorMessage, true],
        ),
        para(
          `Check that the \`_acme-challenge\` CNAME record for this domain is still in place, then retry from the dashboard or run \`krakenkey cert retry ${ctx.certId}\`.`,
        ),
        button(
          'Retry from dashboard',
          `${brand.appUrl}/dashboard/certificates`,
        ),
      ],
      reason: CERT_REASON,
      manageable: true,
    },
    brand,
  );
}

export function certRevokedTemplate(
  ctx: CertEmailContext,
  brand: EmailBranding,
): EmailContent {
  return render(
    {
      tone: 'danger',
      label: 'Certificate revoked',
      title: `The certificate for ${ctx.commonName} was revoked`,
      preheader:
        'Clients will stop trusting it. Replace it if it is still in use.',
      blocks: [
        para(
          `Hi ${ctx.username}, your TLS certificate has been revoked. Clients that check revocation will stop trusting it, so replace it anywhere it's still installed.`,
        ),
        details(
          ['Domain', ctx.commonName, true],
          ['Certificate ID', String(ctx.certId), true],
        ),
        para(
          `If you didn't revoke this certificate, review your API keys and contact ${SUPPORT_EMAIL} right away.`,
        ),
        button('View certificates', `${brand.appUrl}/dashboard/certificates`),
      ],
      reason: CERT_REASON,
      manageable: true,
    },
    brand,
  );
}

export function planLimitReachedTemplate(
  ctx: PlanLimitReachedContext,
  brand: EmailBranding,
): EmailContent {
  const plan = ctx.plan.charAt(0).toUpperCase() + ctx.plan.slice(1);
  return render(
    {
      tone: 'warning',
      label: 'Plan limit reached',
      title: `An automatic action was skipped`,
      preheader: `Your ${plan} plan has reached its limit for ${ctx.resourceType}.`,
      blocks: [
        para(
          `Hi ${ctx.username}, KrakenKey skipped an automatic action because your ${plan} plan has reached its limit.`,
        ),
        details(
          ['Limit', ctx.resourceType],
          ['Usage', `${ctx.current} of ${ctx.limit}`],
          ['Plan', plan],
        ),
        para(
          'Upgrade your plan to raise the limit, or free up capacity by removing resources you no longer need.',
        ),
        button('View plans', `${brand.appUrl}/dashboard/billing`),
      ],
      reason: ACCOUNT_REASON,
      manageable: true,
    },
    brand,
  );
}

export function domainVerificationFailedTemplate(
  ctx: DomainVerificationFailedContext,
  brand: EmailBranding,
): EmailContent {
  return render(
    {
      tone: 'danger',
      label: 'Verification lost',
      title: `${ctx.hostname} is no longer verified`,
      preheader:
        'The DNS TXT record is missing. New certificates are blocked until it is restored.',
      blocks: [
        para(
          `Hi ${ctx.username}, our daily check could no longer find the verification TXT record for ${ctx.hostname}, so the domain has been marked as unverified.`,
        ),
        para(
          'Existing certificates keep working, but new certificate requests for this domain are blocked until it is verified again.',
        ),
        details(
          ['Domain', ctx.hostname, true],
          ['Record type', 'TXT'],
          ['Expected value', ctx.verificationCode, true],
        ),
        para('Add the record back to your DNS, then verify the domain again.'),
        button('Go to domains', `${brand.appUrl}/dashboard/domains`),
      ],
      reason: ACCOUNT_REASON,
      manageable: true,
    },
    brand,
  );
}

export function welcomeTemplate(
  ctx: WelcomeContext,
  brand: EmailBranding,
): EmailContent {
  return render(
    {
      tone: 'info',
      label: 'New account',
      title: 'Welcome to KrakenKey',
      preheader:
        'Three steps to your first certificate. It takes about five minutes.',
      blocks: [
        para(
          `Hi ${ctx.username}, thanks for signing up. KrakenKey issues, renews and monitors your TLS certificates so they don't expire on you.`,
        ),
        steps(
          [
            'Add a domain and verify it with a DNS TXT record.',
            'Add the `_acme-challenge` CNAME so KrakenKey can answer certificate challenges.',
            'Issue your first certificate. Your private key is created on your device and never leaves it.',
          ],
          'Get started in three steps',
        ),
        button('Add your first domain', `${brand.appUrl}/dashboard/domains`),
        para(
          `Questions or feedback? Write to ${SUPPORT_EMAIL}. We read every message.`,
        ),
      ],
      reason: ACCOUNT_REASON,
      manageable: true,
    },
    brand,
  );
}

export function activationReminderTemplate(
  ctx: ActivationReminderContext,
  brand: EmailBranding,
): EmailContent {
  return render(
    {
      tone: 'info',
      label: 'Getting started',
      title: 'Your first certificate is five minutes away',
      preheader: "You haven't added a domain yet. Here's how to start.",
      blocks: [
        para(
          `Hi ${ctx.username}, you signed up for KrakenKey but haven't added a domain yet. That's the first step, and it takes about five minutes.`,
        ),
        steps([
          'Add your domain in the dashboard.',
          'Add the TXT and CNAME records it shows you to your DNS.',
          'Click Verify, and you can start requesting certificates.',
        ]),
        button('Add your first domain', `${brand.appUrl}/dashboard/domains`),
        para(`Stuck on a step? Write to ${SUPPORT_EMAIL} and we'll help.`),
      ],
      reason: ACCOUNT_REASON,
      manageable: true,
    },
    brand,
  );
}

export function autoRenewalPausedTemplate(
  ctx: { username: string },
  brand: EmailBranding,
): EmailContent {
  return render(
    {
      tone: 'warning',
      label: 'Action required',
      title: 'Auto-renewal is paused',
      preheader: 'Confirm in the dashboard to keep your certificates renewing.',
      blocks: [
        para(
          `Hi ${ctx.username}, auto-renewal on your account is paused because it hasn't been confirmed in the last six months.`,
        ),
        para(
          'Your certificates are safe. Nothing has been revoked or deleted, and auto-renewal resumes as soon as you confirm.',
        ),
        button('Keep auto-renewal on', `${brand.appUrl}/dashboard`),
        para(
          "If you don't need auto-renewal anymore, you can ignore this email and turn it back on from the dashboard later.",
        ),
      ],
      reason: ACCOUNT_REASON,
      manageable: true,
    },
    brand,
  );
}

export function apiKeyExpiredUseTemplate(
  ctx: ApiKeyExpiredUseContext,
  brand: EmailBranding,
): EmailContent {
  return render(
    {
      tone: 'danger',
      label: 'Security notice',
      title: 'An expired API key was used',
      preheader: `Someone tried to use the expired key "${ctx.keyName}". The request was rejected.`,
      blocks: [
        para(
          `Hi ${ctx.username}, an expired API key on your account was just used to make a request. We rejected it, but it usually means the key is still configured somewhere, or that it has leaked.`,
        ),
        details(
          ['Key name', ctx.keyName],
          ['Key ID', ctx.keyId, true],
          ['Source IP', ctx.ip, true],
        ),
        para(
          "If it's one of your own systems, switch it to a current key. If you don't recognize the activity, delete the key and review your account.",
        ),
        button('Manage API keys', `${brand.appUrl}/dashboard/api-keys`),
      ],
      reason: SECURITY_REASON,
    },
    brand,
  );
}
