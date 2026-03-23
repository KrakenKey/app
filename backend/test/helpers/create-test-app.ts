import { Test, TestingModuleBuilder } from '@nestjs/testing';
import {
  Type,
  ValidationPipe,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtOrApiKeyGuard } from '../../src/auth/guards/jwt-or-api-key.guard';
import { HttpExceptionFilter } from '../../src/filters/http-exception.filter';
import { MOCK_USER } from './mock-data';

export interface CreateTestAppOptions {
  controllers: Type<any>[];
  providers?: any[];
  imports?: any[];
  /**
   * Guard override mode:
   *  - 'passthrough' (default): guard always passes, injects req.user
   *  - 'reject': guard always throws 401 UnauthorizedException
   *  - 'none': no guard override (use real guards as registered)
   */
  guardMode?: 'passthrough' | 'reject' | 'none';
  /** Additional guards to override with the same behaviour */
  extraGuards?: Type<any>[];
  /** User object injected by the mocked guard (only used in passthrough mode) */
  mockUser?: Record<string, any>;
}

const PASS_THROUGH_GUARD = (user: Record<string, any>) => ({
  canActivate: (ctx: ExecutionContext) => {
    ctx.switchToHttp().getRequest().user = user;
    return true;
  },
});

const REJECT_GUARD = {
  canActivate: () => {
    throw new UnauthorizedException();
  },
};

export async function createTestApp(options: CreateTestAppOptions) {
  const {
    controllers,
    providers = [],
    imports = [],
    guardMode = 'passthrough',
    extraGuards = [],
    mockUser = MOCK_USER,
  } = options;

  let builder: TestingModuleBuilder = Test.createTestingModule({
    imports,
    controllers,
    providers,
  });

  if (guardMode === 'passthrough') {
    builder = builder
      .overrideGuard(JwtOrApiKeyGuard)
      .useValue(PASS_THROUGH_GUARD(mockUser));

    for (const guard of extraGuards) {
      builder = builder
        .overrideGuard(guard)
        .useValue(PASS_THROUGH_GUARD(mockUser));
    }
  } else if (guardMode === 'reject') {
    builder = builder.overrideGuard(JwtOrApiKeyGuard).useValue(REJECT_GUARD);

    for (const guard of extraGuards) {
      builder = builder.overrideGuard(guard).useValue(REJECT_GUARD);
    }
  }

  const module = await builder.compile();
  const app = module.createNestApplication();

  // Match production setup (src/main.ts:62-70)
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useGlobalFilters(new HttpExceptionFilter());

  await app.init();
  return { app, module };
}
