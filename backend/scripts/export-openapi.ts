/**
 * export-openapi.ts
 *
 * Generates an OpenAPI JSON spec from NestJS controller/DTO metadata
 * WITHOUT requiring live PostgreSQL, Redis, or any external service.
 *
 * Uses SwaggerExplorer to scan controllers directly, creating properly
 * prototyped instances so the metadata scanner can discover route methods.
 */

import 'reflect-metadata';
import * as fs from 'fs';
import * as path from 'path';

import { SwaggerExplorer } from '@nestjs/swagger/dist/swagger-explorer';
import { SchemaObjectFactory } from '@nestjs/swagger/dist/services/schema-object-factory';
import { SwaggerTypesMapper } from '@nestjs/swagger/dist/services/swagger-types-mapper';
import { ModelPropertiesAccessor } from '@nestjs/swagger/dist/services/model-properties-accessor';
import { ApplicationConfig } from '@nestjs/core';
import { createSwaggerConfig } from 'src/config/swagger.config';

// ── Controllers ────────────────────────────────────────────────────
import { AppController } from 'src/app.controller';
import { AuthController } from 'src/auth/auth.controller';
import { TlsController } from 'src/certs/tls/tls.controller';
import { DomainsController } from 'src/domains/domains.controller';
import { UsersController } from 'src/users/users.controller';
// CertsController uses @ApiExcludeController, so skip it

const log = (msg: string) => process.stderr.write(msg + '\n');

/**
 * Create a fake instance that has the correct prototype chain
 * so MetadataScanner.scanFromPrototype can find the methods,
 * but all constructor dependencies are bypassed.
 */
function createFakeInstance(controllerClass: any): any {
  // Object.create() sets up the prototype chain without calling the constructor
  return Object.create(controllerClass.prototype);
}

function main() {
  log('Generating OpenAPI spec from controller metadata...');

  const config = createSwaggerConfig();
  const controllers = [
    AppController,
    AuthController,
    TlsController,
    DomainsController,
    UsersController,
  ];

  const modelPropertiesAccessor = new ModelPropertiesAccessor();
  const swaggerTypesMapper = new SwaggerTypesMapper();
  const schemaObjectFactory = new SchemaObjectFactory(
    modelPropertiesAccessor,
    swaggerTypesMapper,
  );
  const explorer = new SwaggerExplorer(schemaObjectFactory);
  const appConfig = new ApplicationConfig();

  const allDocs: any[] = [];

  for (const controller of controllers) {
    log(`  Scanning: ${controller.name}`);

    const instance = createFakeInstance(controller);

    const wrapper = {
      metatype: controller,
      instance,
      name: controller.name,
    } as any;

    const docs = explorer.exploreController(wrapper, appConfig, {
      modulePath: undefined,
      globalPrefix: undefined,
      operationIdFactory: (controllerKey: string, methodKey: string) =>
        `${controllerKey}_${methodKey}`,
    });

    log(`    Found ${docs.length} route(s)`);
    allDocs.push(...docs);
  }

  // Collect schemas from the explorer
  const schemas = explorer.getSchemas();

  // Build paths from denormalized docs
  const paths: Record<string, any> = {};
  for (const doc of allDocs) {
    if (!doc.root) continue;
    const { method, path: routePath, ...operation } = doc.root;
    if (!routePath || !method) continue;

    const methodKey = method.toLowerCase();
    if (!paths[routePath]) paths[routePath] = {};

    // Merge tags, security, callbacks, responses into the operation
    const fullOperation = {
      ...operation,
    };
    if (doc.tags && doc.tags.length > 0) {
      fullOperation.tags = doc.tags;
    }
    if (doc.security && doc.security.length > 0) {
      fullOperation.security = doc.security;
    }
    if (doc.responses && Object.keys(doc.responses).length > 0) {
      fullOperation.responses = {
        ...fullOperation.responses,
        ...doc.responses,
      };
    }

    paths[routePath][methodKey] = fullOperation;
  }

  const document: any = {
    openapi: '3.0.0',
    info: (config as any).info ?? { title: 'API', version: '1.0' },
    servers: (config as any).servers ?? [],
    paths,
    components: {
      schemas,
      securitySchemes: (config as any).components?.securitySchemes ?? {},
    },
    tags: (config as any).tags ?? [],
    security: (config as any).security ?? [],
  };

  const outputPath = path.resolve(__dirname, '..', 'openapi.json');
  fs.writeFileSync(outputPath, JSON.stringify(document, null, 2));

  const pathCount = Object.keys(document.paths).length;
  const schemaCount = Object.keys(schemas).length;

  log(`\nOpenAPI spec written to ${outputPath}`);
  log(`  paths  : ${pathCount}`);
  log(`  schemas: ${schemaCount}`);
}

try {
  main();
} catch (err: any) {
  log('ERROR:');
  log(err.stack ?? err.message ?? String(err));
  process.exit(1);
}
