import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

describe('UsersController', () => {
  let controller: UsersController;
  let mockService: Record<string, jest.Mock>;

  const userId = 'user-123';
  const mockReq = { user: { userId } } as any;
  const otherReq = { user: { userId: 'other-user' } } as any;

  beforeEach(async () => {
    mockService = {
      create: jest.fn(),
      findAll: jest.fn(),
      findOne: jest.fn(),
      findByEmail: jest.fn(),
      update: jest.fn(),
      remove: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [
        {
          provide: UsersService,
          useValue: mockService,
        },
      ],
    }).compile();

    controller = module.get<UsersController>(UsersController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  // ─── findOne ──────────────────────────────────────────────────────────
  describe('findOne', () => {
    it('delegates to service when authorized', () => {
      const user = { id: userId, username: 'alice' };
      mockService.findOne.mockReturnValue(user);

      const result = controller.findOne(userId, mockReq);

      expect(mockService.findOne).toHaveBeenCalledWith(userId);
      expect(result).toEqual(user);
    });

    it('throws ForbiddenException when userId does not match', () => {
      expect(() => controller.findOne(userId, otherReq)).toThrow(
        ForbiddenException,
      );
    });
  });

  // ─── update ───────────────────────────────────────────────────────────
  describe('update', () => {
    it('delegates to service when authorized', () => {
      const dto = { username: 'bob' };
      mockService.update.mockReturnValue({ affected: 1 });

      controller.update(userId, dto as any, mockReq);

      expect(mockService.update).toHaveBeenCalledWith(userId, dto);
    });

    it('throws ForbiddenException when unauthorized', () => {
      expect(() =>
        controller.update(userId, {} as any, otherReq),
      ).toThrow(ForbiddenException);
    });
  });

  // ─── remove ───────────────────────────────────────────────────────────
  describe('remove', () => {
    it('delegates to service when authorized', () => {
      mockService.remove.mockReturnValue({ affected: 1 });

      controller.remove(userId, mockReq);

      expect(mockService.remove).toHaveBeenCalledWith(userId);
    });

    it('throws ForbiddenException when unauthorized', () => {
      expect(() => controller.remove(userId, otherReq)).toThrow(
        ForbiddenException,
      );
    });
  });
});
