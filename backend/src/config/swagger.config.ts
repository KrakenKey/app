import { DocumentBuilder } from '@nestjs/swagger';

export function createSwaggerConfig() {
  return new DocumentBuilder()
    .setTitle('KrakenKey API')
    .setDescription(
      'Public API for KrakenKey — TLS certificate management and domain verification',
    )
    .setVersion(process.env.KK_API_VERSION || '0.1.0')
    .addTag('Health', 'API status and health checks')
    .addTag(
      'Authentication',
      'OAuth login, user profiles, and API key management',
    )
    .addTag('Users', 'User management')
    .addTag('Domains', 'Domain registration and DNS verification')
    .addTag('TLS Certificates', 'Certificate issuance, renewal, and management')
    .addBearerAuth({
      type: 'http',
      scheme: 'bearer',
      bearerFormat: 'JWT',
      description:
        'JWT access token obtained from the /auth/callback OAuth flow',
    })
    .addApiKey(
      {
        type: 'apiKey',
        in: 'header',
        name: 'Authorization',
        description:
          'API key prefixed with "Bearer " (e.g., "Bearer kk_abc123...")',
      },
      'api-key',
    )
    .addServer(`https://${process.env.KK_API_DOMAIN}`)
    .build();
}
