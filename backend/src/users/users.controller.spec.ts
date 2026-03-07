import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { AccountDeletionService } from './services/account-deletion.service';

describe('UsersController', () => {
  let controller: UsersController;
  let mockService: Record<string, jest.Mock>;
  let mockAccountDeletion: Record<string, jest.Mock>;

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
    mockAccountDeletion = {
      deleteAccount: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [
        {
          provide: UsersService,
          useValue: mockService,
        },
        {
          provide: AccountDeletionService,
          useValue: mockAccountDeletion,
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

    it('allows admin access to other users', () => {
      const adminReq = { user: { userId: 'admin-user', groups: ['authentik Admins'] } } as any;
      const user = { id: userId, username: 'alice' };
      mockService.findOne.mockReturnValue(user);

      const result = controller.findOne(userId, adminReq);

      expect(mockService.findOne).toHaveBeenCalledWith(userId);
      expect(result).toEqual(user);
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
      expect(() => controller.update(userId, {} as any, otherReq)).toThrow(
        ForbiddenException,
      );
    });
  });

  // ─── remove ───────────────────────────────────────────────────────────
  describe('remove', () => {
    it('delegates to accountDeletionService when authorized', () => {
      mockAccountDeletion.deleteAccount.mockResolvedValue({ deleted: true, certsRevoked: 0 });

      controller.remove(userId, mockReq);

      expect(mockAccountDeletion.deleteAccount).toHaveBeenCalledWith(userId);
    });

    it('throws ForbiddenException when unauthorized', () => {
      expect(() => controller.remove(userId, otherReq)).toThrow(
        ForbiddenException,
      );
    });
  });
});
