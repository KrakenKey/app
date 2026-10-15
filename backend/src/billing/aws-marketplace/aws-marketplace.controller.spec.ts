import { Test } from '@nestjs/testing';
import {
  type ExecutionContext,
  type INestApplication,
  ValidationPipe,
} from '@nestjs/common';
import request from 'supertest';
import type * as http from 'http';
import { AwsMarketplaceController } from './aws-marketplace.controller';
import { AwsMarketplaceService } from './aws-marketplace.service';
import { AwsMarketplaceConfig } from './aws-marketplace.config';
import { JwtOrApiKeyGuard } from '../../auth/guards/jwt-or-api-key.guard';

const REG = 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcde';

async function appWith(enabled: boolean) {
  const config = new AwsMarketplaceConfig({
    get: (key: string) =>
      ({
        KK_AWS_MARKETPLACE_ENABLED: String(enabled),
        KK_APP_DOMAIN: 'app.example.test',
      })[key],
  } as any);
  const service = new AwsMarketplaceService(
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    config,
    {} as any,
    {} as any,
  );
  const register = jest
    .spyOn(service, 'register')
    .mockResolvedValue(
      `https://app.example.test/aws-marketplace?registration=${REG}`,
    );
  const describe = jest
    .spyOn(service, 'describe')
    .mockResolvedValue({ state: 'ready' } as any);
  const link = jest
    .spyOn(service, 'link')
    .mockResolvedValue({ state: 'active' } as any);

  const moduleRef = await Test.createTestingModule({
    controllers: [AwsMarketplaceController],
    providers: [{ provide: AwsMarketplaceService, useValue: service }],
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
  return { app, register, describe, link };
}

describe('AwsMarketplaceController', () => {
  let app: INestApplication;
  const server = () => app.getHttpServer() as http.Server;

  afterEach(async () => {
    await app?.close();
  });

  describe('with KK_AWS_MARKETPLACE_ENABLED off', () => {
    let mocks: Awaited<ReturnType<typeof appWith>>;
    beforeEach(async () => {
      mocks = await appWith(false);
      app = mocks.app;
    });

    it('reports AWS Marketplace as not available', async () => {
      await request(server())
        .get('/billing/aws-marketplace/status')
        .expect(200, { enabled: false });
    });

    it('answers 404 on every other route without looking at the request', async () => {
      await request(server())
        .post('/billing/aws-marketplace/register')
        .type('form')
        .send({ 'x-amzn-marketplace-token': 'tok' })
        .expect(404);
      await request(server())
        .post('/billing/aws-marketplace/resolve')
        .send({ registration: REG })
        .expect(404);
      await request(server())
        .post('/billing/aws-marketplace/link')
        .send({ registration: REG })
        .expect(404);
      expect(mocks.register).not.toHaveBeenCalled();
      expect(mocks.describe).not.toHaveBeenCalled();
      expect(mocks.link).not.toHaveBeenCalled();
    });
  });

  describe('with KK_AWS_MARKETPLACE_ENABLED on', () => {
    let mocks: Awaited<ReturnType<typeof appWith>>;
    beforeEach(async () => {
      mocks = await appWith(true);
      app = mocks.app;
    });

    it('reports AWS Marketplace as available', async () => {
      await request(server())
        .get('/billing/aws-marketplace/status')
        .expect(200, { enabled: true });
    });

    it('takes the form AWS posts and redirects the browser with 303', async () => {
      const res = await request(server())
        .post('/billing/aws-marketplace/register')
        .type('form')
        .send({
          'x-amzn-marketplace-token': 'tok+with/chars=',
          'x-amzn-marketplace-offer-type': 'free-trial',
        })
        .expect(303);
      expect(res.headers.location).toBe(
        `https://app.example.test/aws-marketplace?registration=${REG}`,
      );
      expect(res.headers['cache-control']).toBe('no-store');
      expect(res.headers['referrer-policy']).toBe('no-referrer');
      expect(mocks.register).toHaveBeenCalledWith(
        'tok+with/chars=',
        'free-trial',
      );
    });

    it('passes a missing token on for the friendly redirect', async () => {
      await request(server())
        .post('/billing/aws-marketplace/register')
        .type('form')
        .send({})
        .expect(303);
      expect(mocks.register).toHaveBeenCalledWith(undefined, undefined);
    });

    it('resolves and links a registration for the signed-in user', async () => {
      await request(server())
        .post('/billing/aws-marketplace/resolve')
        .send({ registration: REG })
        .expect(200, { state: 'ready' });
      expect(mocks.describe).toHaveBeenCalledWith('user-1', REG);
      await request(server())
        .post('/billing/aws-marketplace/link')
        .send({ registration: REG })
        .expect(200, { state: 'active' });
      expect(mocks.link).toHaveBeenCalledWith('user-1', REG);
    });

    it('validates the registration id', async () => {
      for (const registration of ['', 'has spaces', 'x'.repeat(129), 42]) {
        await request(server())
          .post('/billing/aws-marketplace/link')
          .send({ registration })
          .expect(400);
      }
      expect(mocks.link).not.toHaveBeenCalled();
    });
  });
});
