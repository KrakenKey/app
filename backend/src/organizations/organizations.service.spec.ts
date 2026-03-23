import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
  BadRequestException,
  HttpException,
} from '@nestjs/common';
import { OrganizationsService } from './organizations.service';
import { Organization } from './entities/organization.entity';
import { User } from '../users/entities/user.entity';
import { BillingService } from '../billing/billing.service';

describe('OrganizationsService', () => {
  let service: OrganizationsService;
  let mockOrgRepo: Record<string, any>;
  let mockUserRepo: Record<string, jest.Mock>;
  let mockBillingService: Record<string, jest.Mock>;

  const ownerId = 'user-owner';
  const orgId = 'org-1';

  beforeEach(async () => {
    const mockManager = {
      create: jest.fn(),
      save: jest.fn(),
      update: jest.fn(),
    };

    mockOrgRepo = {
      findOne: jest.fn(),
      update: jest.fn(),
      manager: {
        transaction: jest.fn((cb: any) => cb(mockManager)),
      },
      _mockManager: mockManager,
    };

    mockUserRepo = {
      findOne: jest.fn(),
      update: jest.fn(),
    };

    mockBillingService = {
      resolveUserTier: jest.fn(),
      convertToOrgSubscription: jest.fn(),
      getSubscription: jest.fn(),
      queueDissolution: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrganizationsService,
        { provide: getRepositoryToken(Organization), useValue: mockOrgRepo },
        { provide: getRepositoryToken(User), useValue: mockUserRepo },
        { provide: BillingService, useValue: mockBillingService },
      ],
    }).compile();

    service = module.get<OrganizationsService>(OrganizationsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    it('should create an org and set the creator as owner', async () => {
      mockBillingService.resolveUserTier.mockResolvedValue('team');
      mockUserRepo.findOne.mockResolvedValue({
        id: ownerId,
        organizationId: null,
      });
      const savedOrg = { id: orgId, name: 'Acme', ownerId };
      mockOrgRepo._mockManager.create.mockReturnValue(savedOrg);
      mockOrgRepo._mockManager.save.mockResolvedValue(savedOrg);

      const result = await service.create(ownerId, 'Acme');

      expect(result).toEqual(savedOrg);
      expect(mockBillingService.convertToOrgSubscription).toHaveBeenCalledWith(
        ownerId,
        orgId,
        expect.anything(),
      );
    });

    it('should reject if plan is not org-eligible', async () => {
      mockBillingService.resolveUserTier.mockResolvedValue('free');

      await expect(service.create(ownerId, 'Acme')).rejects.toThrow(
        HttpException,
      );
    });

    it('should reject if user already belongs to an org', async () => {
      mockBillingService.resolveUserTier.mockResolvedValue('team');
      mockUserRepo.findOne.mockResolvedValue({
        id: ownerId,
        organizationId: 'other-org',
      });

      await expect(service.create(ownerId, 'Acme')).rejects.toThrow(
        ConflictException,
      );
    });
  });

  describe('findById', () => {
    it('should return org with members', async () => {
      const org = { id: orgId, name: 'Acme', members: [] };
      mockOrgRepo.findOne.mockResolvedValue(org);

      const result = await service.findById(orgId);

      expect(result).toEqual(org);
    });

    it('should throw NotFoundException if not found', async () => {
      mockOrgRepo.findOne.mockResolvedValue(null);

      await expect(service.findById(orgId)).rejects.toThrow(NotFoundException);
    });
  });

  describe('inviteMember', () => {
    beforeEach(() => {
      // assertOrgAdmin passes
      mockUserRepo.findOne.mockResolvedValueOnce({
        id: ownerId,
        organizationId: orgId,
        role: 'owner',
      });
      mockOrgRepo.findOne.mockResolvedValue({ id: orgId, status: 'active' });
    });

    it('should invite a user who exists and has no org', async () => {
      mockUserRepo.findOne.mockResolvedValueOnce({
        id: 'target',
        organizationId: null,
        role: null,
      });
      mockBillingService.getSubscription.mockResolvedValue(null);

      await service.inviteMember(
        orgId,
        ownerId,
        'target@example.com',
        'member',
      );

      expect(mockUserRepo.update).toHaveBeenCalledWith('target', {
        organizationId: orgId,
        role: 'member',
      });
    });

    it('should throw if target user not found', async () => {
      mockUserRepo.findOne.mockResolvedValueOnce(null);

      await expect(
        service.inviteMember(orgId, ownerId, 'nobody@example.com', 'member'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw if target is in another org', async () => {
      mockUserRepo.findOne.mockResolvedValueOnce({
        id: 'target',
        organizationId: 'other-org',
        role: 'member',
      });

      await expect(
        service.inviteMember(orgId, ownerId, 'taken@example.com', 'member'),
      ).rejects.toThrow(ConflictException);
    });

    it('should throw if target has active paid subscription', async () => {
      mockUserRepo.findOne.mockResolvedValueOnce({
        id: 'target',
        organizationId: null,
        role: null,
      });
      mockBillingService.getSubscription.mockResolvedValue({
        plan: 'starter',
        status: 'active',
        cancelAtPeriodEnd: false,
      });

      await expect(
        service.inviteMember(orgId, ownerId, 'paid@example.com', 'member'),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('removeMember', () => {
    beforeEach(() => {
      // assertOrgAdmin passes
      mockUserRepo.findOne.mockResolvedValueOnce({
        id: ownerId,
        organizationId: orgId,
        role: 'owner',
      });
      mockOrgRepo.findOne.mockResolvedValue({ id: orgId, status: 'active' });
    });

    it('should remove a member', async () => {
      mockUserRepo.findOne.mockResolvedValueOnce({
        id: 'target',
        organizationId: orgId,
        role: 'member',
      });

      await service.removeMember(orgId, ownerId, 'target');

      expect(mockUserRepo.update).toHaveBeenCalledWith('target', {
        organizationId: null,
        role: null,
      });
    });

    it('should throw if target not in org', async () => {
      mockUserRepo.findOne.mockResolvedValueOnce({
        id: 'target',
        organizationId: 'other',
        role: 'member',
      });

      await expect(
        service.removeMember(orgId, ownerId, 'target'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw if trying to remove the owner', async () => {
      mockUserRepo.findOne.mockResolvedValueOnce({
        id: 'the-owner',
        organizationId: orgId,
        role: 'owner',
      });

      await expect(
        service.removeMember(orgId, ownerId, 'the-owner'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should allow self-removal without admin check', async () => {
      // Reset mock to track calls fresh
      mockUserRepo.findOne.mockReset();
      // For self-removal, assertOrgAdmin is skipped, so first call is the target lookup
      mockUserRepo.findOne.mockResolvedValueOnce({
        id: 'self-user',
        organizationId: orgId,
        role: 'member',
      });

      await service.removeMember(orgId, 'self-user', 'self-user');

      expect(mockUserRepo.update).toHaveBeenCalledWith('self-user', {
        organizationId: null,
        role: null,
      });
    });
  });

  describe('update', () => {
    it('should update org name', async () => {
      // assertOrgAdmin
      mockUserRepo.findOne.mockResolvedValueOnce({
        id: ownerId,
        organizationId: orgId,
        role: 'owner',
      });
      mockOrgRepo.findOne
        .mockResolvedValueOnce({ id: orgId, status: 'active' }) // assertOrgAdmin
        .mockResolvedValueOnce({ id: orgId, name: 'NewName', members: [] }); // findById

      const result = await service.update(orgId, ownerId, 'NewName');

      expect(mockOrgRepo.update).toHaveBeenCalledWith(orgId, {
        name: 'NewName',
      });
      expect(result).toEqual({ id: orgId, name: 'NewName', members: [] });
    });
  });

  describe('delete', () => {
    it('should queue dissolution when called by owner', async () => {
      mockUserRepo.findOne.mockResolvedValueOnce({
        id: ownerId,
        organizationId: orgId,
        role: 'owner',
      });

      await service.delete(orgId, ownerId);

      expect(mockBillingService.queueDissolution).toHaveBeenCalledWith(orgId);
    });

    it('should throw if caller is not the owner', async () => {
      mockUserRepo.findOne.mockResolvedValueOnce({
        id: 'admin-user',
        organizationId: orgId,
        role: 'admin',
      });

      await expect(service.delete(orgId, 'admin-user')).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe('transferOwnership', () => {
    it('should transfer ownership to another member', async () => {
      mockUserRepo.findOne
        .mockResolvedValueOnce({
          id: ownerId,
          organizationId: orgId,
          role: 'owner',
        })
        .mockResolvedValueOnce({
          id: 'new-owner',
          organizationId: orgId,
          role: 'admin',
        });

      await service.transferOwnership(orgId, ownerId, 'new-owner@example.com');

      expect(mockOrgRepo.update).toHaveBeenCalledWith(orgId, {
        ownerId: 'new-owner',
      });
      expect(mockUserRepo.update).toHaveBeenCalledWith('new-owner', {
        role: 'owner',
      });
      expect(mockUserRepo.update).toHaveBeenCalledWith(ownerId, {
        role: 'admin',
      });
    });

    it('should throw if actor is not the owner', async () => {
      mockUserRepo.findOne.mockResolvedValueOnce({
        id: 'admin',
        organizationId: orgId,
        role: 'admin',
      });

      await expect(
        service.transferOwnership(orgId, 'admin', 'other@example.com'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should throw if target not in org', async () => {
      mockUserRepo.findOne
        .mockResolvedValueOnce({
          id: ownerId,
          organizationId: orgId,
          role: 'owner',
        })
        .mockResolvedValueOnce(null);

      await expect(
        service.transferOwnership(orgId, ownerId, 'nobody@example.com'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw if transferring to self', async () => {
      mockUserRepo.findOne
        .mockResolvedValueOnce({
          id: ownerId,
          organizationId: orgId,
          role: 'owner',
        })
        .mockResolvedValueOnce({
          id: ownerId,
          organizationId: orgId,
          role: 'owner',
        });

      await expect(
        service.transferOwnership(orgId, ownerId, 'self@example.com'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('updateMemberRole', () => {
    beforeEach(() => {
      // assertOrgAdmin
      mockUserRepo.findOne.mockResolvedValueOnce({
        id: ownerId,
        organizationId: orgId,
        role: 'owner',
      });
      mockOrgRepo.findOne.mockResolvedValue({ id: orgId, status: 'active' });
    });

    it('should update a member role', async () => {
      mockUserRepo.findOne.mockResolvedValueOnce({
        id: 'target',
        organizationId: orgId,
        role: 'member',
      });

      await service.updateMemberRole(orgId, ownerId, 'target', 'admin');

      expect(mockUserRepo.update).toHaveBeenCalledWith('target', {
        role: 'admin',
      });
    });

    it('should throw if target not in org', async () => {
      mockUserRepo.findOne.mockResolvedValueOnce(null);

      await expect(
        service.updateMemberRole(orgId, ownerId, 'nobody', 'admin'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw if trying to change owner role', async () => {
      mockUserRepo.findOne.mockResolvedValueOnce({
        id: 'the-owner',
        organizationId: orgId,
        role: 'owner',
      });

      await expect(
        service.updateMemberRole(orgId, ownerId, 'the-owner', 'admin'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('assertOrgAdmin (via inviteMember)', () => {
    it('should throw ForbiddenException if actor is not admin/owner', async () => {
      mockUserRepo.findOne.mockResolvedValueOnce({
        id: 'viewer',
        organizationId: orgId,
        role: 'viewer',
      });

      await expect(
        service.inviteMember(orgId, 'viewer', 'someone@example.com', 'member'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should throw ConflictException if org is dissolving', async () => {
      mockUserRepo.findOne.mockResolvedValueOnce({
        id: ownerId,
        organizationId: orgId,
        role: 'owner',
      });
      mockOrgRepo.findOne.mockResolvedValue({
        id: orgId,
        status: 'dissolving',
      });

      await expect(
        service.inviteMember(orgId, ownerId, 'someone@example.com', 'member'),
      ).rejects.toThrow(ConflictException);
    });
  });
});
