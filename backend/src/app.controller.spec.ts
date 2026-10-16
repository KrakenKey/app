import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import request from 'supertest';
import * as http from 'http';

describe('AppController (e2e)', () => {
  let app: INestApplication;

  beforeEach(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [AppService],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('should return Server Info', async () => {
    const server = app.getHttpServer() as http.Server;
    await request(server)
      .get('/')
      .expect(200)
      .expect((res) => {
        expect(res.body).toEqual({
          status: 'ok',
          version: expect.any(String) as string,
          commit: expect.any(String) as string,
        });
      });
  });

  it('reports the commit the image was built from', async () => {
    const previous = process.env.KK_GIT_SHA;
    process.env.KK_GIT_SHA = '7fa851e0c0ffee';
    try {
      const server = app.getHttpServer() as http.Server;
      const res = await request(server).get('/').expect(200);
      expect((res.body as { commit: string }).commit).toBe('7fa851e0c0ffee');
    } finally {
      if (previous === undefined) delete process.env.KK_GIT_SHA;
      else process.env.KK_GIT_SHA = previous;
    }
  });
});
