import { ForbiddenException } from '@nestjs/common';
import { GUARDS_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { ConnectorsController } from './connectors.controller';
import { ConnectorsService } from './connectors.service';
import { JwtOrApiKeyGuard } from '../auth/guards/jwt-or-api-key.guard';
import { SESSION_ONLY_KEY } from '../auth/decorators/session-only.decorator';
import { RATE_LIMIT_CATEGORY_KEY } from '../throttler/decorators/rate-limit-category.decorator';
import { RateLimitCategory } from '../throttler/interfaces/rate-limit-category.enum';
import type { RequestWithUser } from '../auth/interfaces/request-with-user.interface';

const CID = '3f1c2b9e-1111-4111-8111-111111111111';

describe('ConnectorsController config summary', () => {
  let repo: { update: jest.Mock };
  let controller: ConnectorsController;

  const req = (apiKey?: Record<string, unknown>) =>
    ({ user: { userId: 'u1', apiKey } }) as unknown as RequestWithUser;
  const SUMMARY = {
    hash: 'e'.repeat(64),
    version: '0.3.0',
    plugins: [],
    certificates: [],
  } as any;

  beforeEach(() => {
    repo = { update: jest.fn().mockResolvedValue({ affected: 1 }) };
    const service = new ConnectorsService(
      repo as any,
      {} as any,
      {} as any,
      {} as any,
    );
    controller = new ConnectorsController(service, {} as any);
  });

  it('accepts a key issued to a connector', async () => {
    const connector = req({ id: 'k1', connectorId: CID });
    await controller.putConfig(connector, SUMMARY);
    await controller.deleteConfig(connector);
    expect(repo.update).toHaveBeenCalledTimes(2);
    expect(repo.update.mock.calls[0][0]).toMatchObject({ id: CID });
  });

  it('403s a user API key and a dashboard session, like the report route', async () => {
    for (const r of [req({ id: 'k2', connectorId: null }), req()]) {
      await expect(controller.putConfig(r, SUMMARY)).rejects.toThrow(
        ForbiddenException,
      );
      await expect(controller.deleteConfig(r)).rejects.toThrow(
        ForbiddenException,
      );
    }
    expect(repo.update).not.toHaveBeenCalled();
  });

  it('uses the report route guard and rate limit, not session-only', () => {
    const proto = ConnectorsController.prototype;
    for (const handler of [proto.putConfig, proto.deleteConfig, proto.report]) {
      expect(Reflect.getMetadata(GUARDS_METADATA, handler)).toEqual([
        JwtOrApiKeyGuard,
      ]);
      expect(Reflect.getMetadata(RATE_LIMIT_CATEGORY_KEY, handler)).toBe(
        RateLimitCategory.CONNECTOR_REPORT,
      );
      expect(Reflect.getMetadata(SESSION_ONLY_KEY, handler)).toBeUndefined();
    }
  });

  it('declares /config before /:id, so "config" is not read as an id', () => {
    const paths = Object.getOwnPropertyNames(
      ConnectorsController.prototype,
    ).map(
      (name) =>
        Reflect.getMetadata(
          PATH_METADATA,
          (ConnectorsController.prototype as unknown as Record<string, object>)[
            name
          ],
        ) as string | undefined,
    );
    expect(paths.indexOf('config')).toBeGreaterThanOrEqual(0);
    expect(paths.indexOf('config')).toBeLessThan(paths.indexOf(':id'));
  });
});
