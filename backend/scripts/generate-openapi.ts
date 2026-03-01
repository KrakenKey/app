import { NestFactory } from '@nestjs/core';
import { SwaggerModule } from '@nestjs/swagger';
import { AppModule } from '../src/app.module';
import { createSwaggerConfig } from '../src/config/swagger.config';
import * as fs from 'fs';
import * as path from 'path';

async function generateSpec() {
  const app = await NestFactory.create(AppModule, { logger: false });

  const document = SwaggerModule.createDocument(app, createSwaggerConfig());

  const outputPath = path.resolve(__dirname, '..', 'openapi.json');
  fs.writeFileSync(outputPath, JSON.stringify(document, null, 2));
  console.log(`OpenAPI spec written to ${outputPath}`);

  await app.close();
}

generateSpec().catch((err) => {
  console.error('Failed to generate OpenAPI spec:', err);
  process.exit(1);
});
