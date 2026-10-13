import { Test } from '@nestjs/testing';
import {
  type ExecutionContext,
  type INestApplication,
  ValidationPipe,
} from '@nestjs/common';
import request from 'supertest';
import type * as http from 'http';
import { MarketplaceController } from './marketplace.controller';
import { MarketplaceService } from './marketplace.service';
import { MarketplaceConfig } from './marketplace.config';
import { JwtOrApiKeyGuard } from '../../auth/guards/jwt-or-api-key.guard';

async function appWith(enabled: boolean) {
  const config = new MarketplaceConfig({
    get: (key: string) =>
      key === 'KK_MARKETPLACE_ENABLED' ? String(enabled) : undefined,
  } as any);
  const service = new MarketplaceService(
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    config,
    {} as any,
    {} as any,
    {} as any,
  );
  const handleWebhook = jest
    .spyOn(service, 'handleWebhook')
    .mockResolvedValue('processed');
  const describe = jest.spyOn(service, 'describe').mockResolvedValue({
    state: 'ready',
  } as any);
  const activate = jest.spyOn(service, 'activate').mockResolvedValue({
    state: 'active',
  } as any);

  const moduleRef = await Test.createTestingModule({
    controllers: [MarketplaceController],
    providers: [{ provide: MarketplaceService, useValue: service }],
  })
    .overrideGuard(JwtOrApiKeyGuard)
    .useValue({
      canActivate: (ctx: ExecutionContext) => {
        ctx.switchToHttp().getRequest().user = { userId: 'user-1' };
        return true;
      },
    })
    .compile();
  const app = moduleRef.createNestApplication();
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.init();
  return { app, handleWebhook, describe, activate };
}

describe('MarketplaceController', () => {
  let app: INestApplication;
  const server = () => app.getHttpServer() as http.Server;

  afterEach(async () => {
    await app?.close();
  });

  describe('with KK_MARKETPLACE_ENABLED off', () => {
    let mocks: Awaited<ReturnType<typeof appWith>>;
    beforeEach(async () => {
      mocks = await appWith(false);
      app = mocks.app;
    });

    it('reports the Marketplace as not available', async () => {
      await request(server())
        .get('/billing/marketplace/status')
        .expect(200, { enabled: false });
    });

    it('answers 404 on the webhook without looking at it', async () => {
      await request(server())
        .post('/billing/marketplace/webhook')
        .set('Authorization', 'Bearer anything')
        .send({ id: 'op-1', subscriptionId: 's', action: 'Unsubscribe' })
        .expect(404);
      expect(mocks.handleWebhook).not.toHaveBeenCalled();
    });

    it.each(['resolve', 'activate'])('answers 404 on %s', async (route) => {
      await request(server())
        .post(`/billing/marketplace/${route}`)
        .send({ token: 'abc' })
        .expect(404);
      expect(mocks.describe).not.toHaveBeenCalled();
      expect(mocks.activate).not.toHaveBeenCalled();
    });
  });

  describe('with KK_MARKETPLACE_ENABLED on', () => {
    let mocks: Awaited<ReturnType<typeof appWith>>;
    beforeEach(async () => {
      mocks = await appWith(true);
      app = mocks.app;
    });

    it('reports the Marketplace as available', async () => {
      await request(server())
        .get('/billing/marketplace/status')
        .expect(200, { enabled: true });
    });

    it('answers the webhook with 200 and passes the raw body on', async () => {
      const body = {
        id: 'op-1',
        subscriptionId: 's',
        action: 'Renew',
        newField: { from: 'Microsoft' },
      };
      await request(server())
        .post('/billing/marketplace/webhook')
        .set('Authorization', 'Bearer abc')
        .send(body)
        .expect(200, { received: true });
      expect(mocks.handleWebhook).toHaveBeenCalledWith('Bearer abc', body);
    });

    it('resolves and activates for the signed-in user', async () => {
      await request(server())
        .post('/billing/marketplace/resolve')
        .send({ token: 'ab+cd/ef' })
        .expect(200);
      expect(mocks.describe).toHaveBeenCalledWith('user-1', 'ab+cd/ef');

      await request(server())
        .post('/billing/marketplace/activate')
        .send({ token: 'ab+cd/ef' })
        .expect(200);
      expect(mocks.activate).toHaveBeenCalledWith('user-1', 'ab+cd/ef');
    });

    it('requires a token', async () => {
      await request(server())
        .post('/billing/marketplace/resolve')
        .send({})
        .expect(400);
    });
  });
});
