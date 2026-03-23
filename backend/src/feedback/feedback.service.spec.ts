import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { FeedbackService } from './feedback.service';
import { Feedback } from './entities/feedback.entity';

describe('FeedbackService', () => {
  let service: FeedbackService;
  let mockRepo: Record<string, jest.Mock>;

  beforeEach(async () => {
    mockRepo = {
      create: jest.fn(),
      save: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FeedbackService,
        { provide: getRepositoryToken(Feedback), useValue: mockRepo },
      ],
    }).compile();

    service = module.get<FeedbackService>(FeedbackService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    it('should create and save feedback with the userId', async () => {
      const dto = { message: 'Works well', rating: 4 };
      const userId = 'user-abc';
      const entity = { id: 'fb-1', ...dto, userId, createdAt: new Date() };

      mockRepo.create.mockReturnValue(entity);
      mockRepo.save.mockResolvedValue(entity);

      const result = await service.create(userId, dto);

      expect(mockRepo.create).toHaveBeenCalledWith({ ...dto, userId });
      expect(mockRepo.save).toHaveBeenCalledWith(entity);
      expect(result).toEqual(entity);
    });
  });
});
