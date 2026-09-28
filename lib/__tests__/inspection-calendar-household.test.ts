import { afterEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from '@/app/api/inspections/routes/[id]/calendar/route';

vi.mock('@/lib/auth', () => ({ auth: vi.fn(async () => ({ user: { email: 'inspector@highdesertpm.com' }, accessToken: 'test' })) }));
const { from } = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ getSupabaseAdmin: () => ({ from }) }));
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

it('includes the full household in the calendar body without adding resident attendees or sending invitations', async () => {
  vi.stubEnv('INSPECTION_CALENDAR_DRYRUN', '1');
  const fetchSpy = vi.fn();
  vi.stubGlobal('fetch', fetchSpy);
  from.mockImplementation((table: string) => {
    const query = {
      select: () => query, eq: () => query,
      single: async () => ({ data: { route_date: '2026-10-10', assigned_to: 'inspector@highdesertpm.com', total_service_minutes: 30 } }),
      order: async () => ({ data: [{ inspections: { inspection_type: 'routine', resident_name: 'Alex', inspection_properties: {
        address_1: '1 Test St', city: 'Bend', state: 'OR', zip: '97701',
        financially_responsible_occupants: ['Alex Example', 'Sam <Example>'],
        pets: [{ name: 'Rex & Milo', type: 'Dog', age: 3, weight: 40 }],
      } } }] }),
    };
    expect(['route_plans', 'route_stops']).toContain(table);
    return query;
  });
  const response = await POST(new NextRequest('https://example.test/calendar', { method: 'POST' }), { params: Promise.resolve({ id: 'route1' }) });
  expect(response.status).toBe(200);
  const { event } = await response.json();
  expect(event.body.content).toContain('Alex Example, Sam &lt;Example&gt;');
  expect(event.body.content).toContain('Rex &amp; Milo — Dog — Age: 3 — Weight: 40');
  expect(event.attendees).toHaveLength(2);
  expect(fetchSpy).not.toHaveBeenCalled();
});
