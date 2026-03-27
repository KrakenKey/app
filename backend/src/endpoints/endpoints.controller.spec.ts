import { Test, TestingModule } from '@nestjs/testing';
import { EndpointsController } from './endpoints.controller';
import { EndpointsService } from './endpoints.service';
import { MetricsService } from '../metrics/metrics.service';
import type { RequestWithUser } from '../auth/interfaces/request-with-user.interface';

describe('EndpointsController', () => {
  let controller: EndpointsController;
  let service: Record<string, jest.Mock>;

  const mockReq = {
    user: { userId: 'user-123' },
  } as unknown as RequestWithUser;

  beforeEach(async () => {
    service = {
      create: jest.fn().mockResolvedValue({ id: 'ep-1', host: 'example.com' }),
      findAll: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue({ id: 'ep-1' }),
      update: jest.fn().mockResolvedValue({ id: 'ep-1' }),
      delete: jest.fn().mockResolvedValue(undefined),
      addHostedRegion: jest
        .fn()
        .mockResolvedValue({ id: 'ehr-1', region: 'us-east-1' }),
      removeHostedRegion: jest.fn().mockResolvedValue(undefined),
      getResults: jest.fn().mockResolvedValue({ data: [], total: 0 }),
      getLatestResults: jest.fn().mockResolvedValue([]),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [EndpointsController],
      providers: [
        { provide: EndpointsService, useValue: service },
        {
          provide: MetricsService,
          useValue: { authTotal: { inc: jest.fn() } },
        },
      ],
    }).compile();

    controller = module.get<EndpointsController>(EndpointsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('create should call service.create with userId and dto', async () => {
    const dto = { host: 'example.com' };
    await controller.create(mockReq, dto);
    expect(service.create).toHaveBeenCalledWith('user-123', dto);
  });

  it('findAll should call service.findAll with userId', async () => {
    await controller.findAll(mockReq);
    expect(service.findAll).toHaveBeenCalledWith('user-123');
  });

  it('findOne should call service.findOne', async () => {
    await controller.findOne(mockReq, 'ep-1');
    expect(service.findOne).toHaveBeenCalledWith('ep-1', 'user-123');
  });

  it('update should call service.update', async () => {
    const dto = { label: 'Test' };
    await controller.update(mockReq, 'ep-1', dto);
    expect(service.update).toHaveBeenCalledWith('ep-1', 'user-123', dto);
  });

  it('remove should call service.delete', async () => {
    await controller.remove(mockReq, 'ep-1');
    expect(service.delete).toHaveBeenCalledWith('ep-1', 'user-123');
  });

  it('addRegion should call service.addHostedRegion', async () => {
    await controller.addRegion(mockReq, 'ep-1', { region: 'us-east-1' });
    expect(service.addHostedRegion).toHaveBeenCalledWith(
      'ep-1',
      'user-123',
      'us-east-1',
    );
  });

  it('removeRegion should call service.removeHostedRegion', async () => {
    await controller.removeRegion(mockReq, 'ep-1', 'us-east-1');
    expect(service.removeHostedRegion).toHaveBeenCalledWith(
      'ep-1',
      'user-123',
      'us-east-1',
    );
  });

  it('getResults should parse page and limit', async () => {
    await controller.getResults(mockReq, 'ep-1', '2', '50');
    expect(service.getResults).toHaveBeenCalledWith('ep-1', 'user-123', 2, 50);
  });

  it('getResults should cap limit at 100', async () => {
    await controller.getResults(mockReq, 'ep-1', '1', '200');
    expect(service.getResults).toHaveBeenCalledWith('ep-1', 'user-123', 1, 100);
  });

  it('getLatestResults should call service', async () => {
    await controller.getLatestResults(mockReq, 'ep-1');
    expect(service.getLatestResults).toHaveBeenCalledWith('ep-1', 'user-123');
  });
});
