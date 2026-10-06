import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ session: null as unknown, denied: [] as string[] }));
vi.mock('@/lib/auth', () => ({ auth: async () => mocks.session }));
vi.mock('@/lib/roles', () => ({ getRoleForEmail: async () => 'pm' }));
vi.mock('@/lib/access/section-access', () => ({ getDeniedSections: async () => mocks.denied }));

import { requireSection } from '@/lib/require-role';
import { isAdminPath, isDelegablePath } from '@/proxy';

const as = (role: string) => { mocks.session = { user: { email: 'lisa@highdesertpm.com', role } }; };

describe('requireSection', () => {
  beforeEach(() => { mocks.denied = []; });
  it('lets admins through', async () => {
    as('admin');
    mocks.denied = ['kpis'];
    expect((await requireSection('kpis')).ok).toBe(true);
  });
  it('lets a non-admin through only when the section is switched on for them', async () => {
    as('pm');
    expect((await requireSection('fee_management')).ok).toBe(true);
    mocks.denied = ['fee_management'];
    const denied = await requireSection('fee_management');
    expect(denied.ok).toBe(false);
    if (!denied.ok) expect(denied.response.status).toBe(403);
  });
  it('rejects people outside the company', async () => {
    mocks.session = { user: { email: 'x@gmail.com', role: 'pm' } };
    expect((await requireSection('kpis')).ok).toBe(false);
  });
});

describe('proxy admin gate', () => {
  it('passes delegable areas to the section check and keeps the rest admin-only', () => {
    for (const p of ['/dashboard', '/dashboard/trends', '/admin/fee-management', '/admin/hiring', '/partners/admin/leads', '/api/kpi/summary', '/api/config', '/api/financials', '/api/partners/admin/payouts']) {
      expect(isDelegablePath(p)).toBe(true);
    }
    for (const p of ['/admin', '/admin/user-settings', '/admin/staff-permissions', '/admin/leads', '/admin/website', '/admin/zoom-sync', '/api/zoom-sync', '/dashboardx']) {
      expect(isDelegablePath(p)).toBe(false);
    }
    expect(isAdminPath('/admin/user-settings')).toBe(true);
  });
});
