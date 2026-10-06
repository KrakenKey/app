import * as dns from 'dns';
import * as https from 'https';
import type { LookupAddress, LookupAllOptions } from 'dns';
import { isPrivateIP } from '../../common/net/ssrf';

export class HttpPostError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = 'HttpPostError';
  }
}

type LookupCallback = (
  err: NodeJS.ErrnoException | null,
  address: string | LookupAddress[],
  family?: number,
) => void;

/**
 * dns.lookup replacement for outbound sockets: resolves the host and fails
 * the connection if any address is private. Checking at connect time (not
 * only when the URL is saved) stops a DNS record that changes later from
 * pointing deliveries at internal services.
 */
type DnsLookupAll = (
  hostname: string,
  options: LookupAllOptions,
  callback: (
    err: NodeJS.ErrnoException | null,
    addresses: LookupAddress[],
  ) => void,
) => void;

/** Builds a public-only lookup on top of a resolver (dns.lookup by default). */
export function createPublicOnlyLookup(
  resolve: DnsLookupAll = dns.lookup as unknown as DnsLookupAll,
) {
  return function publicOnlyLookup(
    hostname: string,
    options: { all?: boolean; family?: number },
    callback: LookupCallback,
  ): void {
    const opts = { family: options?.family, all: true } as LookupAllOptions;
    resolve(hostname, opts, (err, addresses) => {
      if (err) {
        callback(err, '');
        return;
      }
      if (
        addresses.length === 0 ||
        addresses.some((a) => isPrivateIP(a.address))
      ) {
        const blocked: NodeJS.ErrnoException = new Error(
          'Destination resolves to a private or internal address',
        );
        blocked.code = 'EPRIVATEADDR';
        callback(blocked, '');
        return;
      }
      if (options?.all) callback(null, addresses);
      else callback(null, addresses[0].address, addresses[0].family);
    });
  };
}

export const publicOnlyLookup = createPublicOnlyLookup();

export interface PostOptions {
  timeoutMs: number;
  /** Override for tests; defaults to publicOnlyLookup. */
  lookup?: typeof publicOnlyLookup;
}

/**
 * POSTs a body and resolves with the HTTP status. Redirects are never
 * followed (https.request does not follow them). Rejects with HttpPostError
 * on network errors and timeouts.
 */
export function postJson(
  url: URL,
  body: string,
  headers: Record<string, string>,
  opts: PostOptions,
): Promise<{ status: number }> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };

    const req = https.request(
      {
        protocol: 'https:',
        hostname: url.hostname.replace(/^\[|\]$/g, ''),
        port: url.port || 443,
        path: `${url.pathname}${url.search}`,
        method: 'POST',
        headers: { ...headers, 'Content-Length': Buffer.byteLength(body) },
        agent: false,
        lookup: (opts.lookup ?? publicOnlyLookup) as never,
      },
      (res) => {
        res.resume();
        res.on('end', () =>
          finish(() => resolve({ status: res.statusCode ?? 0 })),
        );
        res.on('error', () =>
          finish(() => resolve({ status: res.statusCode ?? 0 })),
        );
      },
    );

    const timer = setTimeout(() => {
      req.destroy();
      finish(() =>
        reject(
          new HttpPostError(
            `Timed out after ${Math.round(opts.timeoutMs / 1000)}s`,
            'ETIMEDOUT',
          ),
        ),
      );
    }, opts.timeoutMs);

    req.on('error', (err: NodeJS.ErrnoException) => {
      const code = err.code ?? 'ENETWORK';
      const message =
        code === 'EPRIVATEADDR' ? err.message : `Network error (${code})`;
      finish(() => reject(new HttpPostError(message, code)));
    });

    req.end(body);
  });
}
