import { describe, it, expect } from 'vitest';
import { roleFromRows, ACCESS_ROLES } from '@/lib/roles';

const env = new Set(['craig@highdesertpm.com']);

describe('roleFromRows', () => {
  it('returns the DB role for a matching active email', () => {
    const rows = [
      { email: 'craig@highdesertpm.com', access_role: 'admin' },
      { email: 'penny@highdesertpm.com', access_role: 'finance' },
    ];
    expect(roleFromRows(rows, 'Penny@HighDesertPM.com', env)).toBe('finance');
    expect(roleFromRows(rows, 'craig@highdesertpm.com', env)).toBe('admin');
  });

  it('defaults unknown emails to staff', () => {
    const rows = [{ email: 'craig@highdesertpm.com', access_role: 'admin' }];
    expect(roleFromRows(rows, 'new-hire@highdesertpm.com', env)).toBe('staff');
  });

  it('DB is authoritative: env allowlist cannot elevate when an admin exists', () => {
    const rows = [
      { email: 'matt@highdesertpm.com', access_role: 'admin' },
      { email: 'craig@highdesertpm.com', access_role: 'staff' },
    ];
    expect(roleFromRows(rows, 'craig@highdesertpm.com', env)).toBe('staff');
  });

  it('bootstrap: env allowlist grants admin only when no active admin exists', () => {
    const rows = [{ email: 'penny@highdesertpm.com', access_role: 'finance' }];
    expect(roleFromRows(rows, 'craig@highdesertpm.com', env)).toBe('admin');
    expect(roleFromRows(rows, 'penny@highdesertpm.com', env)).toBe('finance');
  });

  it('lookup failure: env fallback grants admin, everyone else staff', () => {
    expect(roleFromRows(null, 'craig@highdesertpm.com', env)).toBe('admin');
    expect(roleFromRows(null, 'penny@highdesertpm.com', env)).toBe('staff');
  });

  it('unrecognized access_role values fall through to staff', () => {
    const rows = [
      { email: 'craig@highdesertpm.com', access_role: 'admin' },
      { email: 'x@highdesertpm.com', access_role: 'superuser' },
    ];
    expect(roleFromRows(rows, 'x@highdesertpm.com', env)).toBe('staff');
  });

  it('role list matches the migration check constraint', () => {
    expect(ACCESS_ROLES).toEqual([
      'admin', 'manager', 'pm', 'maintenance', 'finance',
      'front_desk', 'inspector', 'field', 'staff', 'read_only',
    ]);
  });
});
