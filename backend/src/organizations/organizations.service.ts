import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  ConflictException,
  BadRequestException,
  HttpException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Organization } from './entities/organization.entity';
import { User } from '../users/entities/user.entity';
import { BillingService } from '../billing/billing.service';
import type { OrgRole } from '@krakenkey/shared';

@Injectable()
export class OrganizationsService {
  private static readonly ORG_ELIGIBLE_PLANS = new Set([
    'team',
    'business',
    'enterprise',
  ]);

  constructor(
    @InjectRepository(Organization)
    private readonly orgRepo: Repository<Organization>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly billingService: BillingService,
  ) {}

  /**
   * Creates a new organization and sets the creator as owner.
   * A user may only be the owner of one organization at a time.
   */
  async create(ownerId: string, name: string): Promise<Organization> {
    const plan = await this.billingService.resolveUserTier(ownerId);
    if (!OrganizationsService.ORG_ELIGIBLE_PLANS.has(plan)) {
      throw new HttpException(
        {
          message:
            'Organizations require a Team plan or higher. Please upgrade to create an organization.',
          plan,
        },
        402,
      );
    }

    const existing = await this.userRepo.findOne({
      where: { id: ownerId },
      select: { id: true, organizationId: true },
    });
    if (existing?.organizationId) {
      throw new ConflictException(
        'You are already a member of an organization',
      );
    }

    const org = this.orgRepo.create({ name, ownerId, plan: 'free' });
    const savedOrg = await this.orgRepo.save(org);

    await this.userRepo.update(ownerId, {
      organizationId: savedOrg.id,
      role: 'owner',
    });

    return savedOrg;
  }

  async findById(orgId: string): Promise<Organization> {
    const org = await this.orgRepo.findOne({
      where: { id: orgId },
      relations: ['members'],
    });
    if (!org) throw new NotFoundException(`Organization ${orgId} not found`);
    return org;
  }

  /**
   * Invites a user into the organization by directly assigning their role.
   * Only owners and admins may invite. The target user must exist in the system.
   * Cannot invite someone already in a different organization.
   */
  async inviteMember(
    orgId: string,
    actorId: string,
    targetEmail: string,
    role: Exclude<OrgRole, 'owner'> = 'member',
  ): Promise<void> {
    await this.assertOrgAdmin(orgId, actorId);

    const target = await this.userRepo.findOne({
      where: { email: targetEmail },
      select: { id: true, organizationId: true, role: true },
    });
    if (!target) {
      throw new NotFoundException(
        `No user found with email ${targetEmail}. They must log in at least once before being invited.`,
      );
    }
    if (target.organizationId && target.organizationId !== orgId) {
      throw new ConflictException(
        'That user is already a member of another organization',
      );
    }

    await this.userRepo.update(target.id, { organizationId: orgId, role });
  }

  /**
   * Removes a member from the organization (resets their role and organizationId to null).
   * Only owners and admins may remove members. The owner cannot be removed.
   * A member may remove themselves.
   */
  async removeMember(
    orgId: string,
    actorId: string,
    targetUserId: string,
  ): Promise<void> {
    // Allow self-removal; otherwise require owner/admin
    if (actorId !== targetUserId) {
      await this.assertOrgAdmin(orgId, actorId);
    }

    const target = await this.userRepo.findOne({
      where: { id: targetUserId },
      select: { id: true, organizationId: true, role: true },
    });
    if (!target || target.organizationId !== orgId) {
      throw new NotFoundException(
        `User ${targetUserId} is not a member of this organization`,
      );
    }
    if (target.role === 'owner') {
      throw new BadRequestException(
        'The organization owner cannot be removed. Transfer ownership first.',
      );
    }

    await this.userRepo.update(targetUserId, {
      organizationId: null,
      role: null,
    });
  }

  /**
   * Updates mutable org fields (currently: name).
   * Only owners and admins may update.
   */
  async update(
    orgId: string,
    actorId: string,
    name: string,
  ): Promise<Organization> {
    await this.assertOrgAdmin(orgId, actorId);
    await this.orgRepo.update(orgId, { name });
    return this.findById(orgId);
  }

  /**
   * Deletes the organization and removes all members from it.
   * Only the owner may delete.
   */
  async delete(orgId: string, actorId: string): Promise<void> {
    const actor = await this.userRepo.findOne({
      where: { id: actorId },
      select: { id: true, organizationId: true, role: true },
    });
    if (!actor || actor.organizationId !== orgId || actor.role !== 'owner') {
      throw new ForbiddenException(
        'Only the organization owner can delete the organization',
      );
    }

    // Clear all member associations before deleting
    await this.userRepo
      .createQueryBuilder()
      .update()
      .set({ organizationId: () => 'NULL', role: () => 'NULL' })
      .where('organizationId = :orgId', { orgId })
      .execute();

    await this.orgRepo.delete(orgId);
  }

  /**
   * Transfers ownership to another member of the org.
   * The current owner becomes an admin. Only the owner may call this.
   */
  async transferOwnership(
    orgId: string,
    actorId: string,
    targetEmail: string,
  ): Promise<void> {
    const actor = await this.userRepo.findOne({
      where: { id: actorId },
      select: { id: true, organizationId: true, role: true },
    });
    if (!actor || actor.organizationId !== orgId || actor.role !== 'owner') {
      throw new ForbiddenException(
        'Only the current owner can transfer ownership',
      );
    }

    const target = await this.userRepo.findOne({
      where: { email: targetEmail },
      select: { id: true, organizationId: true, role: true },
    });
    if (!target || target.organizationId !== orgId) {
      throw new NotFoundException(
        `No member found with email ${targetEmail} in this organization`,
      );
    }

    if (actorId === target.id) {
      throw new BadRequestException('You are already the owner');
    }

    // Transfer: new owner gets 'owner', previous owner becomes 'admin'
    await this.orgRepo.update(orgId, { ownerId: target.id });
    await this.userRepo.update(target.id, { role: 'owner' });
    await this.userRepo.update(actorId, { role: 'admin' });
  }

  /**
   * Updates a member's role. Cannot be used to assign the 'owner' role
   * (use transferOwnership for that). Only owners and admins may update roles.
   */
  async updateMemberRole(
    orgId: string,
    actorId: string,
    targetUserId: string,
    role: Exclude<OrgRole, 'owner'>,
  ): Promise<void> {
    await this.assertOrgAdmin(orgId, actorId);

    const target = await this.userRepo.findOne({
      where: { id: targetUserId },
      select: { id: true, organizationId: true, role: true },
    });
    if (!target || target.organizationId !== orgId) {
      throw new NotFoundException(
        `User ${targetUserId} is not a member of this organization`,
      );
    }
    if (target.role === 'owner') {
      throw new BadRequestException(
        "Cannot change the owner's role. Transfer ownership first.",
      );
    }

    await this.userRepo.update(targetUserId, { role });
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  private async assertOrgAdmin(orgId: string, actorId: string): Promise<void> {
    const actor = await this.userRepo.findOne({
      where: { id: actorId },
      select: { id: true, organizationId: true, role: true },
    });
    if (
      !actor ||
      actor.organizationId !== orgId ||
      !['owner', 'admin'].includes(actor.role ?? '')
    ) {
      throw new ForbiddenException(
        'Only an owner or admin of this organization can perform this action',
      );
    }
  }
}
