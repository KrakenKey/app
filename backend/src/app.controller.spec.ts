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
        });
      });
  });
});
