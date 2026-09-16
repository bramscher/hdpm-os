import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { isDepartedStaff } from '../staff-lifecycle';
import { getEstimateChaserOwner, getPilotConfig } from '../agents/pilot';

vi.mock('next-auth', () => ({ default: () => ({}) }));
vi.mock('@/lib/roles', () => ({ getRoleForEmail: vi.fn().mockResolvedValue('staff') }));
vi.mock('next-auth/jwt', () => ({ getToken: vi.fn() }));

import { authConfig } from '../auth';
import { getToken } from 'next-auth/jwt';
import proxy from '../../proxy';

afterEach(() => vi.unstubAllEnvs());

describe('staff departures', () => {
  it.each(['Jayme', 'Jen', 'Bianca'])('blocks %s sign-in and existing sessions', async (person) => {
    const email = `${person.toLowerCase()}@highdesertpm.com`;
    expect(await authConfig.callbacks.signIn({ user: { email } } as never)).toBe(false);
    expect(await authConfig.callbacks.jwt({ token: { email } } as never)).toBeNull();
    vi.mocked(getToken).mockResolvedValue({ email, role: 'admin', isAdmin: true });
    const response = await proxy(new NextRequest('https://hdpmchat.highdesertpm.com/api/staff'));
    expect(response.status).toBe(401);
  });

  it('keeps current staff access and unrelated similarly named contacts', async () => {
    expect(isDepartedStaff(' JEN@HIGHDESERTPM.COM ')).toBe(true);
    expect(isDepartedStaff('jennifer@oregoncascade.com')).toBe(false);
    expect(isDepartedStaff('Kennedy')).toBe(false);
    expect(await authConfig.callbacks.signIn({ user: { email: 'craig@highdesertpm.com' } } as never)).toBe(true);
    vi.mocked(getToken).mockResolvedValue({ email: 'craig@highdesertpm.com', role: 'admin' });
    expect((await proxy(new NextRequest('https://hdpmchat.highdesertpm.com/company/rocks'))).status).toBe(200);
  });

  it('routes departed automation owners and duplicate pilot recipients to Craig', () => {
    vi.stubEnv('ESTIMATE_CHASER_OWNER', 'Jayme');
    expect(getEstimateChaserOwner()).toBe('Craig');
    vi.stubEnv('ESTIMATE_CHASER_OWNER', '');
    expect(getEstimateChaserOwner()).toBe('Craig');
    vi.stubEnv('ESTIMATE_CHASER_OWNER', 'Brody');
    expect(getEstimateChaserOwner()).toBe('Brody');
    vi.stubEnv('AGENT_PILOT_RECIPIENTS', 'Jayme,Jen,Bianca,Craig,Brody');
    expect(getPilotConfig().recipients).toEqual(['Craig', 'Brody']);
  });
});
