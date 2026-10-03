import { ADMIN_GROUP, isAdmin } from './admin.guard';

describe('isAdmin', () => {
  it('is true for an admin session', () => {
    expect(isAdmin({ groups: [ADMIN_GROUP] })).toBe(true);
  });

  it('is false for an admin API key', () => {
    expect(isAdmin({ groups: [ADMIN_GROUP], apiKeyId: 'k1' })).toBe(false);
  });

  it('is false without the group', () => {
    expect(isAdmin({ groups: [] })).toBe(false);
  });
});
