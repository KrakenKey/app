import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { SwaggerModule } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import { HttpExceptionFilter } from './filters/http-exception.filter';
import { Request, Response, NextFunction } from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { createSwaggerConfig } from './config/swagger.config';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { rawBody: true });

  app.use(helmet());
  app.use(cookieParser());

  // Trust the first proxy hop so req.ip returns the real client IP
  const expressApp = app.getHttpAdapter().getInstance();
  expressApp.set('trust proxy', 1);

  // Always generate the OpenAPI document so /swagger-json is available for the
  // public docs site (Scalar viewer at /docs/api).
  const document = SwaggerModule.createDocument(app, createSwaggerConfig());

  // Always serve the OpenAPI JSON spec
  const httpAdapter = app.getHttpAdapter();
  httpAdapter.get('/swagger-json', (_req: Request, res: Response) => {
    res.json(document);
  });

  // Only enable the interactive Swagger UI in development
  const swaggerUiEnabled =
    process.env.NODE_ENV === 'dev' || process.env.SWAGGER_ENABLED === 'true';

  if (swaggerUiEnabled) {
    SwaggerModule.setup('swagger', app, document, {
      swaggerOptions: {
        persistAuthorization: true,
      },
    });
  }

  const configService = app.get(ConfigService);

  const appDomain = configService.get<string>('KK_APP_DOMAIN');
  const webDomain = configService.get<string>('KK_WEB_DOMAIN');

  const corsOrigins: string[] = [
    `https://${appDomain}`,
    `https://${webDomain}`,
  ];
  if (process.env.NODE_ENV === 'dev') {
    corsOrigins.push('http://localhost:5173', 'http://localhost:5174');
  }

  app.enableCors({
    origin: corsOrigins,
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // Auto-strip unknown properties
      transform: true, // Auto-convert types (string -> number, etc.)
    }),
  );

  // Global exception filter for consistent error responses
  app.useGlobalFilters(new HttpExceptionFilter());

  // Development request logging
  if (process.env.NODE_ENV === 'dev') {
    app.use((req: Request, _res: Response, next: NextFunction) => {
      Logger.log(`${req.method} ${req.url}`, 'HTTP');
      next();
    });
  }

  const port = process.env.KK_API_PORT ?? 8080;
  await app.listen(port);
  Logger.log(`API listening on port ${port}`);
}
bootstrap().catch((err) => {
  Logger.error('Failed to bootstrap application', err);
  process.exit(1);
});
