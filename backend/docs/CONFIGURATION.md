# Configuration Guide

## Environment Variables

All configuration is managed via environment variables loaded by `ConfigModule`.

### Application Configuration

| Variable | Type | Required | Default | Description |
|----------|------|----------|---------|-------------|
| `PORT` | number | No | 8080 | HTTP server port |
| `API_VERSION` | string | No | "unknown" | API version string |
| `NODE_ENV` | string | No | "development" | Execution environment |

**Example**:
```env
PORT=3000
API_VERSION=0.1.0
NODE_ENV=production
```

---

## Database Configuration

### PostgreSQL

| Variable | Type | Required | Default | Description |
|----------|------|----------|---------|-------------|
| `TYPEORM_HOST` | string | Yes | - | Database hostname |
| `TYPEORM_PORT` | number | No | 5432 | Database port |
| `TYPEORM_USERNAME` | string | Yes | - | Database user |
| `TYPEORM_PASSWORD` | string | Yes | - | Database password |
| `TYPEORM_DATABASE` | string | Yes | - | Database name |
| `TYPEORM_SSL` | string | No | "false" | Enable SSL connection |
| `TYPEORM_SYNCHRONIZE` | string | No | "false" | Auto-sync schema (dev only) |

**Example**:
```env
TYPEORM_HOST=localhost
TYPEORM_PORT=5432
TYPEORM_USERNAME=postgres
TYPEORM_PASSWORD=securepassword
TYPEORM_DATABASE=krakenkey
TYPEORM_SSL=false
TYPEORM_SYNCHRONIZE=false
```

### TypeORM Connection Configuration

```typescript
// src/app.module.ts
TypeOrmModule.forRootAsync({
  imports: [ConfigModule],
  useFactory: (configService: ConfigService) => ({
    type: 'postgres',
    host: configService.get('TYPEORM_HOST'),
    port: parseInt(configService.get('TYPEORM_PORT', '5432')),
    username: configService.get('TYPEORM_USERNAME'),
    password: configService.get('TYPEORM_PASSWORD'),
    database: configService.get('TYPEORM_DATABASE'),
    entities: [__dirname + '/**/*.entity{.ts,.js}'],
    ssl: configService.get('TYPEORM_SSL') === 'true',
    synchronize: configService.get('TYPEORM_SYNCHRONIZE') === 'true',
  }),
  inject: [ConfigService],
})
```

---

## Redis / BullMQ Configuration

### Job Queue

| Variable | Type | Required | Default | Description |
|----------|------|----------|---------|-------------|
| `BULLMQ_HOST` | string | No | "localhost" | Redis hostname |
| `BULLMQ_PORT` | number | No | 6379 | Redis port |
| `BULLMQ_PASSWORD` | string | No | "" | Redis password (if auth required) |

**Example**:
```env
BULLMQ_HOST=redis.example.com
BULLMQ_PORT=6379
BULLMQ_PASSWORD=redispassword
```

### BullMQ Module Configuration

```typescript
// src/app.module.ts
BullModule.forRootAsync({
  useFactory: (configService: ConfigService) => ({
    connection: {
      host: configService.get<string>('BULLMQ_HOST', 'localhost'),
      port: parseInt(configService.get('BULLMQ_PORT', '6379')),
      password: configService.get<string>('BULLMQ_PASSWORD', ''),
    },
  }),
  imports: [ConfigModule],
  inject: [ConfigService],
})
```

---

## ACME Configuration

### Let's Encrypt Account

| Variable | Type | Required | Default | Description |
|----------|------|----------|---------|-------------|
| `ACME_ACCOUNT_KEY` | string | Yes | - | ACME account private key (PEM) |
| `ACME_DIRECTORY_URL` | string | No | Staging | ACME directory URL |

**Example**:
```env
ACME_ACCOUNT_KEY="-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA...\n-----END RSA PRIVATE KEY-----"
ACME_DIRECTORY_URL=https://acme-staging-v02.api.letsencrypt.org/directory
```

### Generating ACME Account Key

```bash
# Generate 2048-bit RSA key
openssl genrsa -out acme-account.key 2048

# Read the key
cat acme-account.key

# For environment variable, replace newlines with \n
sed ':a;N;$!ba;s/\n/\\n/g' acme-account.key
```

**Important**: 
- Account key should be backed up securely
- Keep different keys for staging and production
- Never commit keys to version control

### ACME Environments

#### Staging (Testing)
```env
ACME_DIRECTORY_URL=https://acme-staging-v02.api.letsencrypt.org/directory
```

- **Rate Limits**: Generous (1000x higher)
- **Certificates**: Untrusted (marked as staging)
- **Purpose**: Testing and development
- **Trust**: Won't be recognized by browsers

#### Production (Live)
```env
ACME_DIRECTORY_URL=https://acme-v02.api.letsencrypt.org/directory
```

- **Rate Limits**: Strict (50/domain/week)
- **Certificates**: Trusted by browsers
- **Purpose**: Live certificate issuance
- **Trust**: Widely recognized

---

## Cloudflare DNS Configuration

### DNS Provider

| Variable | Type | Required | Default | Description |
|----------|------|----------|---------|-------------|
| `CLOUDFLARE_API_TOKEN` | string | Yes | - | Cloudflare API token |
| `CLOUDFLARE_ZONE_ID` | string | Yes | - | Cloudflare zone ID |

**Example**:
```env
CLOUDFLARE_API_TOKEN=aB_C1d2E3f4g5H6i7j8K9l0m1N2o3P4q
CLOUDFLARE_ZONE_ID=a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6
```

### Getting Cloudflare API Token

1. Go to https://dash.cloudflare.com/profile/api-tokens
2. Click "Create Token"
3. Select "Edit zone DNS" template
4. Configure permissions:
   - Zone > DNS > Edit
   - Include > Specific zone > Select your domain
5. Copy token and store in `CLOUDFLARE_API_TOKEN`

### Getting Zone ID

1. Go to https://dash.cloudflare.com
2. Select your domain
3. Copy "Zone ID" from right sidebar
4. Store in `CLOUDFLARE_ZONE_ID`

### Cloudflare DNS Integration

```typescript
// src/certs/tls/services/cloudflare-dns.strategy.ts
@Injectable()
export class CloudflareDnsStrategy implements DnsProvider {
  private readonly client: Cloudflare;
  private readonly authZoneDomain = 'test.cloudwalker.it';

  constructor(private readonly configService: ConfigService) {
    this.client = new Cloudflare({
      apiToken: this.configService.get('CLOUDFLARE_API_TOKEN'),
    });
  }

  async createRecord(
    clientDomain: string,
    challengeToken: string,
  ): Promise<void> {
    const zoneId = this.configService.get<string>('CLOUDFLARE_ZONE_ID');
    const recordName = `${clientDomain.replace(/\./g, '-')}.${this.authZoneDomain}`;

    await this.client.dns.records.create({
      zone_id: zoneId || '',
      type: 'TXT',
      name: recordName,
      content: challengeToken,
      ttl: 60,
    });
  }
  // ...
}
```

---

## Complete .env Example

```env
# Application
PORT=8080
API_VERSION=0.1.0
NODE_ENV=development

# Database
TYPEORM_HOST=localhost
TYPEORM_PORT=5432
TYPEORM_USERNAME=postgres
TYPEORM_PASSWORD=krakenkey_password
TYPEORM_DATABASE=krakenkey
TYPEORM_SSL=false
TYPEORM_SYNCHRONIZE=false

# Redis/BullMQ
BULLMQ_HOST=localhost
BULLMQ_PORT=6379
BULLMQ_PASSWORD=

# ACME (Let's Encrypt)
ACME_ACCOUNT_KEY="-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA...\n-----END RSA PRIVATE KEY-----"

# Cloudflare DNS
CLOUDFLARE_API_TOKEN=your_cloudflare_api_token_here
CLOUDFLARE_ZONE_ID=your_cloudflare_zone_id_here
```

---

## Environment-Specific Configurations

### Development (.env.development)

```env
PORT=8080
NODE_ENV=development

TYPEORM_HOST=localhost
TYPEORM_PORT=5432
TYPEORM_USERNAME=postgres
TYPEORM_PASSWORD=dev_password
TYPEORM_DATABASE=krakenkey_dev
TYPEORM_SYNCHRONIZE=false

BULLMQ_HOST=localhost
BULLMQ_PORT=6379

# Use staging for testing
ACME_ACCOUNT_KEY="dev_account_key"
```

### Production (.env.production)

```env
PORT=3000
NODE_ENV=production

TYPEORM_HOST=db.production.com
TYPEORM_PORT=5432
TYPEORM_USERNAME=krakenkey_user
TYPEORM_PASSWORD=secure_password_here
TYPEORM_DATABASE=krakenkey
TYPEORM_SSL=true
TYPEORM_SYNCHRONIZE=false

BULLMQ_HOST=redis.production.com
BULLMQ_PORT=6379
BULLMQ_PASSWORD=redis_secure_password

# Use production ACME
ACME_ACCOUNT_KEY="production_account_key"
```

---

## Configuration Loading

### ConfigModule Setup

```typescript
// src/app.module.ts
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,  // Available in all modules
      envFilePath: process.env.NODE_ENV === 'production'
        ? '.env.production'
        : '.env',
    }),
    // ... other modules
  ],
})
export class AppModule {}
```

### Using Configuration in Services

```typescript
import { ConfigService } from '@nestjs/config';

@Injectable()
export class MyService {
  constructor(private readonly configService: ConfigService) {}

  getConfig() {
    const port = this.configService.get<number>('PORT');
    const dbHost = this.configService.get<string>('TYPEORM_HOST');
    const dbPort = parseInt(this.configService.get('TYPEORM_PORT', '5432'));
    
    return { port, dbHost, dbPort };
  }
}
```

---

## Secrets Management

### Best Practices

1. **Never commit secrets to git**:
   ```bash
   # Add to .gitignore
   echo ".env" >> .gitignore
   echo ".env.local" >> .gitignore
   echo "*.key" >> .gitignore
   ```

2. **Use environment variable files**:
   - `.env.development` for development
   - `.env.production` for production
   - `.env.local` for local overrides (not committed)

3. **Docker secrets** (for containerized deployment):
   ```dockerfile
   # docker-compose.yaml
   services:
     backend:
       environment:
         TYPEORM_PASSWORD_FILE: /run/secrets/db_password
   secrets:
     db_password:
       file: ./secrets/db_password.txt
   ```

4. **Vault/Secrets Manager** (for enterprise):
   - HashiCorp Vault
   - AWS Secrets Manager
   - Google Cloud Secret Manager

### Reading Secrets from Files

```typescript
// For file-based secrets
import * as fs from 'fs';

@Injectable()
export class ConfigService {
  getDbPassword(): string {
    const passwordFile = process.env.TYPEORM_PASSWORD_FILE;
    if (passwordFile) {
      return fs.readFileSync(passwordFile, 'utf-8').trim();
    }
    return process.env.TYPEORM_PASSWORD || '';
  }
}
```

---

## Validation

### Schema Validation

```typescript
import { plainToInstance } from 'class-transformer';
import { IsNotEmpty, IsNumber, validate } from 'class-validator';

class EnvironmentVariables {
  @IsNotEmpty()
  TYPEORM_HOST: string;

  @IsNumber()
  TYPEORM_PORT: number;

  @IsNotEmpty()
  TYPEORM_USERNAME: string;

  @IsNotEmpty()
  TYPEORM_PASSWORD: string;

  @IsNotEmpty()
  CLOUDFLARE_API_TOKEN: string;

  @IsNotEmpty()
  CLOUDFLARE_ZONE_ID: string;
}

// In app.module.ts
ConfigModule.forRoot({
  isGlobal: true,
  validate: (config) => {
    const validatedConfig = plainToInstance(
      EnvironmentVariables,
      config,
      { enableImplicitConversion: true },
    );
    validate(validatedConfig);
    return validatedConfig;
  },
})
```

---

## Troubleshooting

### Configuration Not Applied

**Problem**: Environment variables not being read

**Solutions**:
1. Verify `.env` file exists in project root
2. Check `NODE_ENV` is set correctly
3. Restart application after changing `.env`
4. Ensure `.env` is readable

```bash
# Check if .env exists and is readable
ls -la .env

# Check environment variables are loaded
node -e "require('dotenv').config(); console.log(process.env.PORT);"
```

### Database Connection Failed

**Problem**: Cannot connect to PostgreSQL

**Debug**:
```bash
# Test connection manually
psql -h localhost -U postgres -d krakenkey

# Check environment variables
echo $TYPEORM_HOST
echo $TYPEORM_PORT
echo $TYPEORM_USERNAME
echo $TYPEORM_DATABASE
```

### Redis Connection Failed

**Problem**: Cannot connect to Redis/BullMQ

**Debug**:
```bash
# Test Redis connection
redis-cli -h localhost -p 6379 PING

# Check Redis is running
systemctl status redis-server
# or
docker ps | grep redis
```

### ACME Account Key Error

**Problem**: Invalid ACME account key format

**Solution**:
```bash
# Verify key is properly formatted
openssl pkey -in acme-account.key -text -noout

# Properly escape for environment variable
ACME_ACCOUNT_KEY="$(sed ':a;N;$!ba;s/\n/\\n/g' acme-account.key)"
```

---

## Configuration Checklist

- [ ] Database host, port, credentials configured
- [ ] PostgreSQL database created and accessible
- [ ] Redis/BullMQ host and port configured
- [ ] ACME account key generated and stored
- [ ] Cloudflare API token created and stored
- [ ] Cloudflare zone ID obtained and stored
- [ ] All environment variables in `.env` or Docker secrets
- [ ] `.env` files in `.gitignore`
- [ ] Development and production `.env` files differ
- [ ] Secrets are not logged in application output
- [ ] Configuration is validated on startup

---

## Advanced Configuration

### Logging Configuration

```typescript
// src/main.ts
const logger = new Logger();
app.useLogger(logger);

// Enable debug logging
if (process.env.DEBUG) {
  logger.setLogLevels(['log', 'debug', 'error', 'warn']);
}
```

### Swagger Configuration

```typescript
// src/main.ts
const config = new DocumentBuilder()
  .setTitle('Krakenkey API')
  .setDescription('API docs for KrakenKey')
  .setVersion('0.1.0')
  .addBearerAuth()
  .build();

SwaggerModule.setup('swagger', app, 
  SwaggerModule.createDocument(app, config)
);
```

### CORS Configuration

```typescript
// src/main.ts
const allowedOrigins = process.env.CORS_ORIGINS?.split(',') || ['http://localhost:3000'];

app.enableCors({
  origin: allowedOrigins,
  credentials: true,
});
```

### Rate Limiting

```typescript
// Future: Add rate limiting configuration
app.use(rateLimit({
  windowMs: 15 * 60 * 1000,  // 15 minutes
  max: 100,                   // limit each IP to 100 requests per windowMs
}));
```
