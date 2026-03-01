# General

## MVP STATUS

### Minimal Testable Features

- ~~Issue a certificate~~
- Renew a certificate
- Revoke a certificate
- Query cert status
- List/manage API credentials

## 🔴 Critical Security Issues

### 1. Environment Variables in Git

Your `.env` file appears to contain actual credentials and should never be committed to git.

**Action required:**

```bash
# Add to .gitignore immediately
echo ".env" >> .gitignore
git rm --cached backend/.env
```

Create a `.env.example` template instead with placeholder values.

---

### 2. API Key Hashing Strategy

In `user-api-key.entity.ts`, you're using SHA-256 for API keys. Consider using bcrypt/argon2 with salt instead:

```typescript
// Instead of SHA-256, use bcrypt for better security
import * as bcrypt from 'bcrypt';
const hashedKey = await bcrypt.hash(apiKey, 10);
```

---

### 3. Database Synchronization in Production

Your `.env` has `TYPEORM_SYNCHRONIZE=true` - this is dangerous in production as it auto-alters schema. Use migrations instead:

```env
# In production .env:
TYPEORM_SYNCHRONIZE=false
TYPEORM_MIGRATIONS_RUN=true
```

---

### 4. JWT Secret Management

I don't see a `JWT_SECRET` in your env vars. Ensure you're using a strong, randomly generated secret:

```bash
# Add to .env
JWT_SECRET=$(openssl rand -base64 32)
```

---

## 🟡 Important Improvements

### 5. Error Handling & Validation

Add global exception filter and validation pipe in `main.ts`:

```typescript
import { ValidationPipe } from '@nestjs/common';

app.useGlobalPipes(new ValidationPipe({
  whitelist: true,           // Strip unknown properties
  forbidNonWhitelisted: true, // Throw error on unknown properties
  transform: true,            // Auto-transform payloads to DTO types
}));
```

---

### 6. JWT Strategy - Token Refresh

Your `jwt.strategy.ts` doesn't handle token refresh. Consider implementing:

- Short-lived access tokens (15-30 min)
- Long-lived refresh tokens (7-30 days)
- Refresh endpoint: `/auth/refresh`

---

### 7. Rate Limiting

Add rate limiting to prevent abuse:

```bash
yarn add @nestjs/throttler
```

```typescript
// In app.module.ts
ThrottlerModule.forRoot({
  ttl: 60,
  limit: 10,
}),
```

---

### 8. CORS Configuration

In `main.ts`, make CORS configuration more explicit:

```typescript
app.enableCors({
  origin: process.env.NODE_ENV === 'production'
    ? ['https://dev.krakenkey.io']
    : ['http://localhost:5173', 'http://localhost:3000'],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
});
```

---

## 🟢 Code Quality & Maintainability

### 9. Health Checks

Add proper health checks for Docker/Kubernetes:

```bash
yarn add @nestjs/terminus
```

```typescript
// Create health.controller.ts
@Get('health')
check() {
  return this.health.check([
    () => this.db.pingCheck('database'),
    () => this.redis.pingCheck('redis'),
  ]);
}
```

---

### 10. Logging Strategy

Implement structured logging (replace `console.log`):

```bash
yarn add pino pino-pretty
```

```typescript
// Use NestJS Logger or Pino for production-grade logging
private readonly logger = new Logger(TlsService.name);
this.logger.log('Certificate issued', { certId, userId });
```

---

### 11. Database Migrations

Set up TypeORM migrations instead of auto-sync:

```bash
yarn typeorm migration:generate -n InitialSchema
yarn typeorm migration:run
```

---

### 12. Frontend Error Handling

In `api.ts`, add response interceptor for error handling:

```typescript
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      // Clear auth and redirect to login
      localStorage.removeItem('token');
      window.location.href = '/';
    }
    return Promise.reject(error);
  }
);
```

---

### 13. Frontend Token Refresh

Add token expiry check and auto-refresh logic in `AuthContext.tsx`.

---

### 14. BullMQ Dashboard

Add Bull Board for monitoring background jobs:

```bash
yarn add @bull-board/nestjs @bull-board/express
```

---

### 15. Input Validation DTOs

Ensure all controllers use DTOs with class-validator decorators:

```typescript
// Example: create-domain.dto.ts
export class CreateDomainDto {
  @IsString()
  @IsNotEmpty()
  @Matches(/^[a-z0-9]+([\-\.]{1}[a-z0-9]+)*\.[a-z]{2,}$/)
  hostname: string;
}
```

---

## 📝 Testing & Documentation

### 16. E2E Tests

Add comprehensive E2E tests for critical flows:

- Full auth flow (login → callback → authenticated request)
- Domain verification flow
- Certificate issuance flow

---

### 17. Frontend Tests

Add React Testing Library:

```bash
cd frontend && yarn add -D @testing-library/react @testing-library/jest-dom vitest
```

---

### 18. API Documentation

Your Swagger setup is good, but ensure all DTOs have `@ApiProperty()` decorators for better docs.

---

### 19. README Files

Create `README.md` files in `/backend`, `/frontend`, and `/shared` with:

- Setup instructions
- Environment variables documentation
- Development workflow
- Testing instructions

---

## 🔧 DevOps & Monitoring

### 20. Docker Healthchecks

Add healthcheck to Dockerfile:

```dockerfile
HEALTHCHECK --interval=30s --timeout=3s --start-period=40s \
  CMD node -e "require('http').get('http://localhost:8888/health')"
```

---

### 21. Graceful Shutdown

Handle SIGTERM for graceful shutdown in `main.ts`:

```typescript
async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.enableShutdownHooks();

  // ... rest of bootstrap
}
```

---

### 22. Error Tracking

Consider adding Sentry or similar:

```bash
yarn add @sentry/node @sentry/nestjs
```

---

## 📊 Priority Recommendation

If I had to prioritize, I'd tackle in this order:

1. **Security:** Remove .env from git, fix API key hashing, disable sync in prod
2. **Reliability:** Add global validation, error handling, rate limiting
3. **Observability:** Health checks, structured logging
4. **Testing:** E2E tests for critical flows
5. **DX:** README files, database migrations

Would you like me to help implement any of these recommendations? I can start with the critical security issues if you'd like.

# MVP Focused

## 🚀 MVP-Focused Recommendations

### 1. Token Refresh Logic (High Impact)

You'll quickly hit issues with JWT expiration. Add a simple refresh mechanism in `AuthContext.tsx`:

```typescript
// Check token expiry and auto-refresh before it expires
useEffect(() => {
  const checkTokenExpiry = () => {
    const token = localStorage.getItem('token');
    if (!token) return;

    const payload = JSON.parse(atob(token.split('.')[1]));
    const expiresIn = payload.exp * 1000 - Date.now();

    // Refresh 5 minutes before expiry
    if (expiresIn < 5 * 60 * 1000 && expiresIn > 0) {
      // Call refresh endpoint
    }
  };

  const interval = setInterval(checkTokenExpiry, 60000); // Check every minute
  return () => clearInterval(interval);
}, []);
```

---

### 2. Better Error Messages in Frontend

Add toast notifications or error display in `api.ts`:

```typescript
api.interceptors.response.use(
  (response) => response,
  (error) => {
    const message = error.response?.data?.message || 'Something went wrong';
    // Display error to user (toast, alert, etc.)
    console.error('API Error:', message);
    return Promise.reject(error);
  }
);
```

---

### 3. Loading States in Dashboard

Add loading states to avoid confusion while data fetches. In `Dashboard.tsx`:

```typescript
const [loading, setLoading] = useState(true);
const [domains, setDomains] = useState([]);

useEffect(() => {
  api.get('/domains')
    .then(res => setDomains(res.data))
    .finally(() => setLoading(false));
}, []);

if (loading) return <div>Loading...</div>;
```

---

### 4. BullMQ Job Status Polling

For certificate issuance, users need to see progress. Add polling in the frontend:

```typescript
// Poll certificate status every 5 seconds
useEffect(() => {
  if (cert.status === 'pending' || cert.status === 'processing') {
    const interval = setInterval(() => {
      fetchCertStatus(cert.id);
    }, 5000);
    return () => clearInterval(interval);
  }
}, [cert.status]);
```

---

### 5. Database Seed Script

Create a seed script for quick testing in `backend/scripts/seed.ts`:

```typescript
// Quick way to create test users/domains without going through auth flow
async function seed() {
  const user = await userRepo.save({
    id: 'test-user-1',
    email: 'test@example.com',
    username: 'testuser',
  });

  await domainRepo.save({
    hostname: 'test.example.com',
    user,
    isVerified: true, // Skip verification for testing
  });
}
```

---

### 6. Global Validation Pipe (Prevents bugs)

Add this to `main.ts` to catch validation errors early:

```typescript
import { ValidationPipe } from '@nestjs/common';

app.useGlobalPipes(new ValidationPipe({
  whitelist: true,      // Auto-strip unknown properties
  transform: true,      // Auto-convert types (string -> number, etc.)
}));
```

---

### 7. Development Logging

Add simple request logging to see what's happening in `main.ts`:

```typescript
if (process.env.NODE_ENV === 'dev') {
  app.use((req, res, next) => {
    console.log(`${req.method} ${req.url}`);
    next();
  });
}
```

---

### 8. Swagger UI Enabled by Default

Make sure Swagger is easily accessible for API testing at `http://localhost:8080/api`:

```typescript
const config = new DocumentBuilder()
  .setTitle('KrakenKey API')
  .setVersion('0.0.1')
  .addBearerAuth()  // Test authenticated endpoints in Swagger UI
  .build();
```

---

### 9. Quick Domain Verification Bypass (Dev Only)

Add a dev-only bypass for DNS verification in `domains.service.ts`:

```typescript
async verifyDomain(id: string, userId: string) {
  // DEV ONLY: Auto-verify if domain ends with .local
  if (process.env.NODE_ENV === 'dev' && domain.hostname.endsWith('.local')) {
    domain.isVerified = true;
    return await this.domainsRepository.save(domain);
  }

  // Real verification logic...
}
```

---

### 10. Hot Reload for Backend Changes

Make sure you're using `yarn start:dev` with watch mode. If it's not reloading properly, check `nest-cli.json`:

```json
{
  "watchAssets": true,
  "deleteOutDir": true
}
```

---

### 11. Simple Frontend Error Boundary

Catch React errors to avoid white screens in `App.tsx`:

```typescript
class ErrorBoundary extends React.Component {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  render() {
    if (this.state.hasError) {
      return <div>Something went wrong. <button onClick={() => window.location.reload()}>Reload</button></div>;
    }
    return this.props.children;
  }
}
```

---

### 12. Better TypeORM Query Logging

In `app.module.ts`, enable query logging to debug database issues:

```typescript
TypeOrmModule.forRoot({
  // ... other config
  logging: process.env.NODE_ENV === 'dev' ? ['query', 'error'] : ['error'],
  logger: 'advanced-console',
}),
```

---

### 13. API Route Constants in Frontend

You already have `routes.ts` in shared - make sure frontend uses it consistently:

```typescript
// In frontend services/api.ts
import { API_ROUTES } from '@krakenkey/shared';

api.get(API_ROUTES.DOMAINS.LIST);  // Instead of hardcoded '/domains'
```

---

### 14. Docker Compose for Full Stack

Create a root `docker-compose.yml` that runs backend + frontend + postgres + redis together for easy full-stack testing.

---

### 15. Quick Database Reset Script

Add to `package.json`:

```json
{
  "scripts": {
    "db:reset": "yarn typeorm schema:drop && yarn typeorm schema:sync && yarn db:seed"
  }
}
```

---

## 🎯 Top 5 for Immediate MVP Work

If I had to pick just 5 things to implement now:

1. **Global Validation Pipe (#6)** - Saves hours of debugging
2. **Loading States (#3)** - Better UX immediately
3. **Error Interceptor (#2)** - See what's failing
4. **Dev Domain Bypass (#9)** - Test cert flow without DNS setup
5. **Seed Script (#5)** - Quick test data creation

---

## ⚡ Quick Wins You Can Do Right Now

Want me to implement any of these? I'd suggest starting with:

1. Request logging (1 min)
2. Seed script (10 min)
3. Dev domain bypass (5 min)

This will make your development cycle much faster. Which would you like me to tackle first?

 Missing for MVP
Critical (Blocking MVP):
Certificate Request UI - No frontend component to:

Submit a CSR
View certificate status (pending → issuing → issued/failed)
Download issued certificates
List all user certificates
Certificate Listing Endpoint - Backend missing GET /certs/tls to list user's certificates

Domain Ownership Validation - Backend doesn't verify that domains in CSR are owned & verified by the user before issuing

Important (Should Have):
Guided User Flow - UI doesn't clearly show: Add Domain → Verify → Submit CSR → Get Cert
Error Recovery - No user-facing retry for failed issuance
Production Config - No docker-compose for production deployment, no reverse proxy setup
Security Hardening:
No rate limiting
ACME email hardcoded (admin@cloudwalker.it)
Missing comprehensive input sanitization
Nice to Have:
Certificate expiry tracking & renewal reminders
Testing (unit, integration, e2e)
Monitoring (BullMQ dashboard, metrics)
Better error messages & help documentation
🎯 MVP Checklist (Priority Order)
To complete the core user journey, you need:

[Backend] Add GET /certs/tls endpoint to list certificates
[Backend] Add domain ownership check in certificate issuance flow
[Frontend] Create CertificateManagement.tsx component with:
CSR upload/paste form
Certificate status table
Download button for issued certs
[Frontend] Add certificate section to Dashboard
[Docs] Create user guide for: Domain verification → CSR generation → Certificate retrieval
Once these 5 items are done, you'd have a working MVP where users can get TLS certificates end-to-end. Would you like me to help implement any of these?