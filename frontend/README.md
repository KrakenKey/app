# KrakenKey Web

React frontend for KrakenKey — certificate management dashboard, domain verification, and authentication UI.

## Quick Start

```bash
yarn install
yarn dev --host
```

The dev server runs on port 5173 with hot module replacement.

The API URL comes from `window.__env__.KK_API_URL`, which production sets in `/config.js` (see `docker-entrypoint.sh`). The dev server has no `/config.js`, so it uses `https://api-dev.krakenkey.io`, which the devcontainer routes to your local API.

## End-to-end tests

```bash
yarn test:e2e
```

The Playwright suite never talks to a real API. Specs import `test` from `e2e/fixtures/auth.ts`, which builds on `e2e/fixtures/network.ts`:

- `/config.js` is served with `KK_API_URL=http://api.e2e.invalid`, a host that cannot resolve.
- Mock API calls with `page.route(api('/path'), ...)`. The lists the dashboard loads on most pages (certificates, domains, endpoints, probes, connectors, alert channels) answer empty by default; a spec's own route wins over the default.
- Any other API call gets a `501` and fails the test, listing the method and path.
- Requests to krakenkey.io are blocked and fail the test. Other requests off localhost (web fonts, Stripe) are blocked quietly.

## Stack

- React + TypeScript
- Vite
- React Router (pages-based routing)

## Project Structure

```
src/
├── components/    # Shared UI components
├── context/       # React context providers
├── hooks/         # Custom hooks
├── pages/         # Route pages
├── services/      # API client services
└── utils/         # Utility functions
```

## Related Docs

- [Error Handling](../docs/ERROR_HANDLING.md)
- [Domain Verification](../docs/DOMAIN_VERIFICATION_GUIDE.md)
