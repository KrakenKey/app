# Organizations

Organizations allow teams to share domains, certificates, and endpoints under a single account with role-based access control.

## Requirements

- Organizations require a **Team** plan or higher
- A user can only belong to one organization at a time
- Users with an active paid personal subscription cannot join an organization (cancel first or let it lapse)

## Roles

| Role | Manage Members | Manage Settings | Billing | View Resources | Create Resources |
|------|---------------|----------------|---------|---------------|-----------------|
| **Owner** | Yes | Yes | Yes | Yes | Yes |
| **Admin** | Yes | Yes | No | Yes | Yes |
| **Member** | No | No | No | Yes | Yes |
| **Viewer** | No | No | No | Yes | No |

- Each organization has exactly one owner
- Only owners can transfer ownership, delete the organization, or manage billing
- Admins can invite/remove members and update settings but cannot change the owner or access billing
- Members can create and manage resources (domains, certs, endpoints) but cannot manage the organization itself
- Viewers have read-only access

## API Endpoints

### Create Organization

```
POST /organizations
```

**Request:**
```json
{
  "name": "My Team"
}
```

The creating user becomes the owner. Their personal subscription is converted to an organization subscription.

Name must be 2–80 characters.

### Get Organization

```
GET /organizations/:id
```

Returns the organization with its member list:

```json
{
  "id": "uuid",
  "name": "My Team",
  "ownerId": "user-id",
  "status": "active",
  "createdAt": "2026-03-27T10:00:00.000Z",
  "members": [
    {
      "id": "user-id",
      "username": "alice",
      "email": "alice@example.com",
      "displayName": "Alice",
      "role": "owner"
    }
  ]
}
```

### Invite Member

```
POST /organizations/:id/members
```

**Request:**
```json
{
  "email": "bob@example.com",
  "role": "member"
}
```

- The invited user must already have an account (have logged in at least once)
- The user must not belong to another organization
- The user must not have an active paid subscription
- Default role is `member` if not specified
- Available roles for invitation: `admin`, `member`, `viewer`

### Remove Member

```
DELETE /organizations/:id/members/:userId
```

- Owners and admins can remove any non-owner member
- Members can remove themselves (leave the organization)
- The owner cannot be removed — use ownership transfer instead

### Update Organization

```
PATCH /organizations/:id
```

**Request:**
```json
{
  "name": "New Team Name"
}
```

Requires owner or admin role.

### Delete Organization

```
DELETE /organizations/:id
```

Owner only. Queues an asynchronous dissolution process:
1. Non-owner member resources (domains, certificates) are transferred to the owner
2. Member associations are cleared
3. The organization subscription reverts to a personal subscription
4. The organization record is deleted

### Transfer Ownership

```
POST /organizations/:id/transfer-ownership
```

**Request:**
```json
{
  "email": "bob@example.com"
}
```

Owner only. The specified user must be a current member. The current owner becomes an admin after transfer.

### Update Member Role

```
PATCH /organizations/:id/members/:userId
```

**Request:**
```json
{
  "role": "admin"
}
```

Requires owner or admin role. Available roles: `admin`, `member`, `viewer`. The `owner` role can only be assigned via the transfer ownership endpoint.

## Organization Entity Schema

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `name` | varchar | Organization name (2–80 chars) |
| `ownerId` | varchar | Owner user ID (indexed) |
| `status` | enum | `active` or `dissolving` |
| `createdAt` | timestamp | Creation time |

## Resource Sharing

When a user belongs to an organization, all organization members can access each other's resources:
- **Domains**: Shared across the team — any member's verified domain can authorize certificates for other members
- **Certificates**: Visible to all members; write access depends on role
- **Endpoints**: Shared monitoring across the team
- **API Keys**: Individual per user (not shared)
