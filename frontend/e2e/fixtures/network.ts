import {
  test as base,
  type BrowserContext,
  type Route,
} from '@playwright/test';

/**
 * API base URL the app gets in e2e runs. The `.invalid` TLD never resolves
 * (RFC 6761), so a request that slips past the mocks below cannot reach a
 * real server.
 */
export const E2E_API_URL = 'http://api.e2e.invalid';
const E2E_API_ORIGIN = new URL(E2E_API_URL).origin;

/**
 * API URL for a path, for scoping page.route() to API calls (and not to
 * Vite page navigation on localhost). Usage: `page.route(api('/domains'), h)`
 */
export function api(path: string): string {
  return `${E2E_API_URL}${path}`;
}

/**
 * Answers for the requests the dashboard shell makes on every page (the
 * account health behind the Overview and the sidebar badges). Empty lists,
 * so a spec that does not care about them still renders. A spec overrides
 * any of these with its own page.route(), which takes precedence.
 */
const DEFAULT_GET_MOCKS: Array<[RegExp, unknown]> = [
  [/^\/certs\/tls$/, []],
  [/^\/domains$/, []],
  [/^\/endpoints$/, []],
  [/^\/endpoints\/probes\/mine$/, []],
  [/^\/endpoints\/[^/]+\/results\/latest$/, []],
  [/^\/connectors$/, []],
  [/^\/notifications\/channels$/, []],
  // Billing page: monthly Stripe prices only, as before yearly ones exist
  [
    /^\/billing\/plans$/,
    {
      plans: [
        { plan: 'pro', intervals: ['month'] },
        { plan: 'business', intervals: ['month'] },
      ],
    },
  ],
];

const isLocal = (url: URL) =>
  url.hostname === 'localhost' ||
  url.hostname === '127.0.0.1' ||
  url.hostname === '[::1]';

const isKrakenKey = (url: URL) =>
  url.hostname === 'krakenkey.io' || url.hostname.endsWith('.krakenkey.io');

/**
 * Keeps e2e runs off the network:
 *
 * - The app's runtime config (/config.js, written by docker-entrypoint.sh
 *   in production) is served with KK_API_URL set to E2E_API_URL.
 * - API requests a spec does not mock get the shell defaults above or a 501,
 *   and an unmocked request fails the test, naming the method and path.
 * - Every other request off localhost is aborted. One to krakenkey.io fails
 *   the test; others (web fonts, Stripe redirects) are dropped quietly.
 *
 * These routes are on the browser context, so page.route() in a spec always
 * wins over them, and route.fallback() in a spec hands a request back here.
 */
async function guardNetwork(context: BrowserContext) {
  const unmocked: string[] = [];
  const blocked: string[] = [];

  await context.route('**/config.js', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      body: `window.__env__ = ${JSON.stringify({ KK_API_URL: E2E_API_URL })};`,
    }),
  );

  await context.route(
    (url) => !isLocal(url),
    (route: Route) => {
      const request = route.request();
      const url = new URL(request.url());

      if (url.origin === E2E_API_ORIGIN) {
        if (request.method() === 'GET') {
          const mock = DEFAULT_GET_MOCKS.find(([path]) =>
            path.test(url.pathname),
          );
          if (mock) return route.fulfill({ status: 200, json: mock[1] });
        }
        const call = `${request.method()} ${url.pathname}${url.search}`;
        unmocked.push(call);
        return route.fulfill({
          status: 501,
          json: {
            statusCode: 501,
            message: `No e2e mock for ${call}`,
            error: 'Not Implemented',
          },
        });
      }

      if (isKrakenKey(url)) blocked.push(`${request.method()} ${url.href}`);
      return route.abort('blockedbyclient');
    },
  );

  return { unmocked, blocked };
}

function summarize(calls: string[]): string {
  const counts = new Map<string, number>();
  for (const call of calls) counts.set(call, (counts.get(call) ?? 0) + 1);
  return [...counts]
    .map(([call, n]) => `  ${call}${n > 1 ? ` (x${n})` : ''}`)
    .join('\n');
}

/** Base test for every spec: same as Playwright's, with the network guard. */
export const test = base.extend({
  context: async ({ context }, run) => {
    const { unmocked, blocked } = await guardNetwork(context);
    await run(context);

    const problems: string[] = [];
    if (unmocked.length > 0) {
      problems.push(
        'API requests without an e2e mock (answered 501). Mock them with ' +
          "page.route(api('/path'), ...) or add a shell default in " +
          'e2e/fixtures/network.ts:\n' +
          summarize(unmocked),
      );
    }
    if (blocked.length > 0) {
      problems.push(
        'Requests to krakenkey.io (blocked; e2e must not reach real ' +
          'services):\n' +
          summarize(blocked),
      );
    }
    if (problems.length > 0) throw new Error(problems.join('\n\n'));
  },
});

export { expect } from '@playwright/test';
