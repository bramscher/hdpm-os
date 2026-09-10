import { describe, expect, it, vi, beforeEach } from 'vitest';
import { canViewHabuDemo } from '@/lib/habu-demo-access';

vi.mock('@/lib/auth', () => ({ auth: vi.fn() }));
vi.mock('next/navigation', () => ({ notFound: () => { throw new Error('NOT_FOUND'); } }));
vi.mock('@/app/admin/habu-demo/habu-demo', () => ({ default: () => null }));
import { auth } from '@/lib/auth';
import { GET } from '@/app/admin/habu-demo/forms/[form]/route';
import HabuDemoPage from '@/app/admin/habu-demo/page';

describe('HABU demo owner restriction', () => {
  it('allows only Craig with an admin session', () => {
    expect(canViewHabuDemo({ email: 'craig@highdesertpm.com', role: 'admin' })).toBe(true);
    expect(canViewHabuDemo({ email: 'CRAIG@highdesertpm.com', isAdmin: true })).toBe(true);
    expect(canViewHabuDemo({ email: 'craig@highdesertpm.com', role: 'staff' })).toBe(false);
    expect(canViewHabuDemo({ email: 'someone@highdesertpm.com', role: 'admin' })).toBe(false);
    expect(canViewHabuDemo({ email: 'craigbramscher@gmail.com', role: 'admin' })).toBe(false);
    expect(canViewHabuDemo(null)).toBe(false);
    expect(canViewHabuDemo(undefined)).toBe(false);
  });
});

describe('HABU demo page', () => {
  it.each([null, { user: { email: 'someone@highdesertpm.com', role: 'admin' } }])(
    'denies direct page access for an unauthorized session', async session => {
      vi.mocked(auth).mockResolvedValue(session as never);
      await expect(HabuDemoPage()).rejects.toThrow('NOT_FOUND');
    },
  );
  it('renders the demo for Craig', async () => {
    vi.mocked(auth).mockResolvedValue({ user: { email: 'craig@highdesertpm.com', role: 'admin' } } as never);
    expect(await HabuDemoPage()).toBeTruthy();
  });
});

describe('HABU reference forms', () => {
  const request = new Request('https://example.test/admin/habu-demo/forms/tenant-setup');
  beforeEach(() => vi.resetAllMocks());
  it.each([null, { user: { email: 'someone@highdesertpm.com', role: 'admin' } }])(
    'denies direct document access for an unauthorized session', async session => {
      vi.mocked(auth).mockResolvedValue(session as never);
      const response = await GET(request, { params: Promise.resolve({ form: 'tenant-setup' }) });
      expect(response.status).toBe(404);
      expect(response.headers.get('cache-control')).toBe('private, no-store');
    },
  );
  it.each(['tenant-setup', 'vacancy-tracking'])('serves %s privately to Craig', async form => {
    vi.mocked(auth).mockResolvedValue({ user: { email: 'craig@highdesertpm.com', role: 'admin' } } as never);
    const response = await GET(request, { params: Promise.resolve({ form }) });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/pdf');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect((await response.text()).startsWith('%PDF')).toBe(true);
  });
  it.each(['../page.tsx', '__proto__', 'missing'])('rejects unlisted form %s', async form => {
    vi.mocked(auth).mockResolvedValue({ user: { email: 'craig@highdesertpm.com', role: 'admin' } } as never);
    expect((await GET(request, { params: Promise.resolve({ form }) })).status).toBe(404);
  });
});
