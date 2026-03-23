import { Test, TestingModule } from '@nestjs/testing';
import { FeedbackController } from './feedback.controller';
import { FeedbackService } from './feedback.service';
import type { CreateFeedbackDto } from './dto/create-feedback.dto';

describe('FeedbackController', () => {
  let controller: FeedbackController;
  let mockFeedbackService: Record<string, jest.Mock>;

  const userId = 'user-123';
  const mockReq = { user: { userId } } as any;

  beforeEach(async () => {
    mockFeedbackService = {
      create: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [FeedbackController],
      providers: [{ provide: FeedbackService, useValue: mockFeedbackService }],
    }).compile();

    controller = module.get<FeedbackController>(FeedbackController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('create', () => {
    const dto: CreateFeedbackDto = { message: 'Great service!', rating: 5 };
    const savedFeedback = { id: 'fb-1', ...dto, userId, createdAt: new Date() };

    it('should submit feedback for the authenticated user', async () => {
      mockFeedbackService.create.mockResolvedValue(savedFeedback);

      const result = await controller.create(mockReq, dto);

      expect(mockFeedbackService.create).toHaveBeenCalledWith(userId, dto);
      expect(result).toEqual(savedFeedback);
    });
  });
});
