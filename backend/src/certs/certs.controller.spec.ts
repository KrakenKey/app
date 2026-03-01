import { Test, TestingModule } from '@nestjs/testing';
import { CertsController } from './certs.controller';
import { CertsService } from './certs.service';

describe('CertsController', () => {
  let controller: CertsController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [CertsController],
      providers: [CertsService],
    }).compile();

    controller = module.get<CertsController>(CertsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
