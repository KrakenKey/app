# KrakenKey Backend Documentation

This directory contains comprehensive documentation for the KrakenKey backend API, a NestJS-based service for TLS certificate management and issuance via ACME protocol.

## Table of Contents

1. [Architecture Overview](./ARCHITECTURE.md) - System design and module structure
2. [API Reference](./API_REFERENCE.md) - Endpoint documentation
3. [Database Schema](./DATABASE.md) - Data model and entities

## Quick Start

### Prerequisites
- Node.js 18+
- PostgreSQL 12+
- Redis 6+ (for BullMQ queue)
- Cloudflare account (for DNS challenge)
- Let's Encrypt ACME account

### Installation

```bash
# Install dependencies
yarn install

# Set up environment variables
cp .env.example .env

# Create database
yarn run db:create

# Start in development mode
yarn run start:dev
```

### Running Tests

```bash
# Unit tests
yarn run test

# Test coverage
yarn run test:cov

# E2E tests
yarn run test:e2e
```

## Project Structure

```
src/
├── app.module.ts           # Root module
├── app.controller.ts       # Root controller (health check)
├── app.service.ts          # Root service
├── main.ts                 # Application entry point
└── certs/                  # Certificate management module
    ├── certs.module.ts
    ├── certs.controller.ts
    ├── certs.service.ts
    └── tls/                # TLS certificate issuance submodule
        ├── tls.module.ts
        ├── tls.controller.ts
        ├── tls.service.ts
        ├── entities/       # Database entities
        ├── dto/            # Data transfer objects
        ├── interfaces/     # TypeScript interfaces
        ├── services/       # ACME and DNS strategies
        ├── processors/     # BullMQ job processors
        └── util/           # Utilities (CSR parsing)
```

## Key Features

- **TLS Certificate Request Handling**: Submit Certificate Signing Requests (CSRs) for processing
- **ACME Protocol Integration**: Automated Certificate Management Environment support for Let's Encrypt
- **DNS-01 Challenge**: Cloudflare DNS provider for DNS-01 ACME challenges
- **Job Queue**: BullMQ-based asynchronous certificate issuance pipeline
- **CSR Validation**: Comprehensive CSR signature, domain, and key strength validation
- **API Documentation**: Swagger/OpenAPI documentation at `/swagger`

## Main Modules

### App Module
- **Purpose**: Root application module
- **Endpoints**: Health check endpoint `/` returning API status and version
- **Dependencies**: TypeORM, ConfigModule, BullModule

### Certs Module
- **Purpose**: Container for certificate management functionality
- **Submodules**: TLS module

### TLS Module
- **Purpose**: Core functionality for TLS certificate issuance
- **Endpoints**:
  - `POST /certs/tls` - Submit CSR for certificate issuance
  - `GET /certs/tls/:id` - Retrieve certificate status and data
  - `PATCH /certs/tls/:id` - Update certificate information
  - `DELETE /certs/tls/:id` - Revoke certificate
- **Key Services**:
  - TlsService: Business logic for certificate management
  - AcmeIssuerStrategy: ACME protocol implementation
  - CloudflareDnsStrategy: DNS challenge management
  - CsrUtilService: CSR validation and parsing

## External Integrations

### Let's Encrypt (ACME)
- **Purpose**: Certificate authority for issuing TLS certificates
- **Environment**: Staging environment by default (configurable)
- **Key Library**: `acme-client`

### Cloudflare DNS
- **Purpose**: DNS provider for DNS-01 challenge solving
- **Key Features**: Automated record creation/deletion, TXT record management
- **Key Library**: `cloudflare` SDK

## Technology Stack

- **Framework**: NestJS 11.x
- **Language**: TypeScript
- **Database**: PostgreSQL with TypeORM
- **Queue**: BullMQ (Redis-backed)
- **ACME Client**: acme-client
- **DNS Management**: Cloudflare SDK
- **Cryptography**: node-forge
- **Documentation**: Swagger/OpenAPI

## Security Considerations

- CSR signatures are verified using embedded public keys
- Minimum RSA key length: 2048 bits
- Domain authorization via DNS-01 challenges
- Secure credential storage via environment variables
- Certificate validation with Let's Encrypt staging/production endpoints

## Performance & Scalability

- Asynchronous job processing with BullMQ
- Exponential backoff retry strategy for failed operations
- DNS propagation polling with configurable timeout
- Database connection pooling via TypeORM
- PostgreSQL for persistent storage

## For More Details

Refer to the specific documentation files listed in the Table of Contents for detailed information about architecture, API endpoints, database schema, and integration procedures.
