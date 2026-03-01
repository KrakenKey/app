import { Test, TestingModule } from '@nestjs/testing';
import { CertsService } from './certs.service';

describe('CertsService', () => {
  let service: CertsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [CertsService],
    }).compile();

    service = module.get<CertsService>(CertsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
