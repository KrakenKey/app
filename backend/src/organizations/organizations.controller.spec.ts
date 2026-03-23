import { Test, TestingModule } from '@nestjs/testing';
import { OrganizationsController } from './organizations.controller';
import { OrganizationsService } from './organizations.service';

describe('OrganizationsController', () => {
  let controller: OrganizationsController;
  let mockOrgsService: Record<string, jest.Mock>;

  const userId = 'user-owner';
  const orgId = 'org-1';
  const mockReq = { user: { userId } } as any;

  beforeEach(async () => {
    mockOrgsService = {
      create: jest.fn(),
      findById: jest.fn(),
      inviteMember: jest.fn(),
      removeMember: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      transferOwnership: jest.fn(),
      updateMemberRole: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [OrganizationsController],
      providers: [{ provide: OrganizationsService, useValue: mockOrgsService }],
    }).compile();

    controller = module.get<OrganizationsController>(OrganizationsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('create', () => {
    it('should create an organization', async () => {
      const org = { id: orgId, name: 'Acme', ownerId: userId };
      mockOrgsService.create.mockResolvedValue(org);

      const result = await controller.create(mockReq, { name: 'Acme' });

      expect(mockOrgsService.create).toHaveBeenCalledWith(userId, 'Acme');
      expect(result).toEqual(org);
    });
  });

  describe('findOne', () => {
    it('should return organization details', async () => {
      const org = { id: orgId, name: 'Acme', members: [] };
      mockOrgsService.findById.mockResolvedValue(org);

      const result = await controller.findOne(orgId);

      expect(mockOrgsService.findById).toHaveBeenCalledWith(orgId);
      expect(result).toEqual(org);
    });
  });

  describe('inviteMember', () => {
    it('should invite a member', async () => {
      mockOrgsService.inviteMember.mockResolvedValue(undefined);

      await controller.inviteMember(orgId, mockReq, {
        email: 'new@example.com',
        role: 'member',
      });

      expect(mockOrgsService.inviteMember).toHaveBeenCalledWith(
        orgId,
        userId,
        'new@example.com',
        'member',
      );
    });
  });

  describe('removeMember', () => {
    it('should remove a member', async () => {
      mockOrgsService.removeMember.mockResolvedValue(undefined);

      await controller.removeMember(orgId, 'user-target', mockReq);

      expect(mockOrgsService.removeMember).toHaveBeenCalledWith(
        orgId,
        userId,
        'user-target',
      );
    });
  });

  describe('update', () => {
    it('should update the organization name', async () => {
      const updated = { id: orgId, name: 'NewName' };
      mockOrgsService.update.mockResolvedValue(updated);

      const result = await controller.update(orgId, mockReq, {
        name: 'NewName',
      });

      expect(mockOrgsService.update).toHaveBeenCalledWith(
        orgId,
        userId,
        'NewName',
      );
      expect(result).toEqual(updated);
    });
  });

  describe('deleteOrg', () => {
    it('should delete the organization', async () => {
      mockOrgsService.delete.mockResolvedValue(undefined);

      await controller.deleteOrg(orgId, mockReq);

      expect(mockOrgsService.delete).toHaveBeenCalledWith(orgId, userId);
    });
  });

  describe('transferOwnership', () => {
    it('should transfer ownership', async () => {
      mockOrgsService.transferOwnership.mockResolvedValue(undefined);

      await controller.transferOwnership(orgId, mockReq, {
        email: 'new-owner@example.com',
      });

      expect(mockOrgsService.transferOwnership).toHaveBeenCalledWith(
        orgId,
        userId,
        'new-owner@example.com',
      );
    });
  });

  describe('updateMemberRole', () => {
    it('should update a member role', async () => {
      mockOrgsService.updateMemberRole.mockResolvedValue(undefined);

      await controller.updateMemberRole(orgId, 'user-target', mockReq, {
        role: 'admin',
      });

      expect(mockOrgsService.updateMemberRole).toHaveBeenCalledWith(
        orgId,
        userId,
        'user-target',
        'admin',
      );
    });
  });
});
