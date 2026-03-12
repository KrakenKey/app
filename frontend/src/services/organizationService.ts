import api from './api';
import { API_ROUTES } from '@krakenkey/shared';
import type { OrgRole } from '@krakenkey/shared';

export interface OrgMember {
  id: string;
  username: string;
  email: string;
  displayName?: string | null;
  role: OrgRole;
}

export interface Organization {
  id: string;
  name: string;
  ownerId: string;
  plan: string;
  createdAt: string;
  members: OrgMember[];
}

export async function createOrganization(name: string): Promise<Organization> {
  const response = await api.post<Organization>(API_ROUTES.ORGANIZATIONS.BASE, {
    name,
  });
  return response.data;
}

export async function fetchOrganization(id: string): Promise<Organization> {
  const response = await api.get<Organization>(
    API_ROUTES.ORGANIZATIONS.BY_ID(id),
  );
  return response.data;
}

export async function inviteMember(
  orgId: string,
  userId: string,
  role: Exclude<OrgRole, 'owner'>,
): Promise<void> {
  await api.post(API_ROUTES.ORGANIZATIONS.MEMBERS(orgId), { userId, role });
}

export async function removeMember(
  orgId: string,
  userId: string,
): Promise<void> {
  await api.delete(API_ROUTES.ORGANIZATIONS.MEMBER(orgId, userId));
}

export async function updateOrganization(
  orgId: string,
  name: string,
): Promise<Organization> {
  const response = await api.patch<Organization>(
    API_ROUTES.ORGANIZATIONS.BY_ID(orgId),
    { name },
  );
  return response.data;
}

export async function deleteOrganization(orgId: string): Promise<void> {
  await api.delete(API_ROUTES.ORGANIZATIONS.BY_ID(orgId));
}

export async function transferOwnership(
  orgId: string,
  targetUserId: string,
): Promise<void> {
  await api.post(API_ROUTES.ORGANIZATIONS.TRANSFER_OWNERSHIP(orgId), {
    targetUserId,
  });
}

export async function updateMemberRole(
  orgId: string,
  userId: string,
  role: Exclude<OrgRole, 'owner'>,
): Promise<void> {
  await api.patch(API_ROUTES.ORGANIZATIONS.MEMBER(orgId, userId), { role });
}
