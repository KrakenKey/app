# KrakenKey Web

React frontend for KrakenKey — certificate management dashboard, domain verification, and authentication UI.

## Quick Start

```bash
yarn install
yarn dev --host
```

The dev server runs on port 5173 with hot module replacement.

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
