import 'reflect-metadata';
import * as fs from 'fs';
import * as path from 'path';
import { PATH_METADATA } from '@nestjs/common/constants';
import { DECORATORS } from '@nestjs/swagger/dist/constants';
import { OPENAPI_CONTROLLERS } from './openapi-controllers';

function controllerFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return controllerFiles(p);
    return e.name.endsWith('.controller.ts') ? [p] : [];
  });
}

describe('OPENAPI_CONTROLLERS', () => {
  it('lists every controller that is not excluded from Swagger', () => {
    const missing: string[] = [];

    for (const file of controllerFiles(path.resolve(__dirname, '..'))) {
      const mod = jest.requireActual<Record<string, unknown>>(file);
      for (const [name, value] of Object.entries(mod)) {
        if (typeof value !== 'function') continue;
        if (Reflect.getMetadata(PATH_METADATA, value) === undefined) continue;
        if (Reflect.getMetadata(DECORATORS.API_EXCLUDE_CONTROLLER, value)) {
          continue;
        }
        if (!OPENAPI_CONTROLLERS.includes(value as never)) missing.push(name);
      }
    }

    expect(missing).toEqual([]);
  });
});
