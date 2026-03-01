import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { UsersService } from './users.service';
import { User } from './entities/user.entity';

describe('UsersService', () => {
  let service: UsersService;
  let mockRepository: Record<string, jest.Mock>;

  beforeEach(async () => {
    mockRepository = {
      create: jest.fn(),
      save: jest.fn(),
      find: jest.fn(),
      findOneBy: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        {
          provide: getRepositoryToken(User),
          useValue: mockRepository,
        },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    it('creates and saves a user', async () => {
      const dto = { id: 'u1', username: 'alice', email: 'alice@example.com' };
      const user = { ...dto };
      mockRepository.create.mockReturnValue(user);
      mockRepository.save.mockResolvedValue(user);

      const result = await service.create(dto as any);

      expect(mockRepository.create).toHaveBeenCalledWith(dto);
      expect(mockRepository.save).toHaveBeenCalledWith(user);
      expect(result).toEqual(user);
    });
  });

  describe('findAll', () => {
    it('returns all users', async () => {
      const users = [{ id: 'u1' }, { id: 'u2' }];
      mockRepository.find.mockResolvedValue(users);

      expect(await service.findAll()).toEqual(users);
      expect(mockRepository.find).toHaveBeenCalled();
    });
  });

  describe('findOne', () => {
    it('finds user by id', async () => {
      const user = { id: 'u1', username: 'alice' };
      mockRepository.findOneBy.mockResolvedValue(user);

      expect(await service.findOne('u1')).toEqual(user);
      expect(mockRepository.findOneBy).toHaveBeenCalledWith({ id: 'u1' });
    });
  });

  describe('findByEmail', () => {
    it('finds user by email', async () => {
      const user = { id: 'u1', email: 'alice@example.com' };
      mockRepository.findOneBy.mockResolvedValue(user);

      expect(await service.findByEmail('alice@example.com')).toEqual(user);
      expect(mockRepository.findOneBy).toHaveBeenCalledWith({
        email: 'alice@example.com',
      });
    });
  });

  describe('update', () => {
    it('updates user by id', async () => {
      const dto = { username: 'bob' };
      mockRepository.update.mockResolvedValue({ affected: 1 });

      await service.update('u1', dto as any);

      expect(mockRepository.update).toHaveBeenCalledWith('u1', dto);
    });
  });

  describe('remove', () => {
    it('deletes user by id', async () => {
      mockRepository.delete.mockResolvedValue({ affected: 1 });

      await service.remove('u1');

      expect(mockRepository.delete).toHaveBeenCalledWith('u1');
    });
  });
});
