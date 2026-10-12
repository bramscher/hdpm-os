import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('next-auth/jwt', () => ({ getToken: vi.fn() }));

import { getToken } from 'next-auth/jwt';
import proxy from '../../proxy';
import { safeCallbackPath } from '../safe-callback';

const PDF = 'https://os.highdesertpm.com/api/turn-estimator/estimates/abc/pdf';

describe('signed-out API requests', () => {
  beforeEach(() => vi.mocked(getToken).mockResolvedValue(null));

  it('sends a link opened in the browser to sign-in, then back to it', async () => {
    const response = await proxy(new NextRequest(PDF, { headers: { 'sec-fetch-mode': 'navigate' } }));
    expect(response.status).toBe(307);
    const location = new URL(response.headers.get('location')!);
    expect(location.pathname).toBe('/login');
    expect(location.searchParams.get('callbackUrl')).toBe('/api/turn-estimator/estimates/abc/pdf');
  });

  it('falls back to Accept: text/html when Sec-Fetch-Mode is absent', async () => {
    const response = await proxy(new NextRequest(PDF, { headers: { accept: 'text/html,*/*' } }));
    expect(response.status).toBe(307);
  });

  it('still answers fetch() calls with a JSON 401', async () => {
    const response = await proxy(new NextRequest(PDF, { headers: { 'sec-fetch-mode': 'cors' } }));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'Authentication required' });
  });

  it('never redirects a non-GET', async () => {
    const response = await proxy(
      new NextRequest(PDF, { method: 'POST', headers: { 'sec-fetch-mode': 'navigate' } }),
    );
    expect(response.status).toBe(401);
  });
});

describe('safeCallbackPath', () => {
  it.each([
    ['/api/turn-estimator/estimates/abc/pdf', '/api/turn-estimator/estimates/abc/pdf'],
    ['/maintenance/board?tab=turnover', '/maintenance/board?tab=turnover'],
    [null, '/'],
    ['', '/'],
    ['https://evil.com', '/'],
    ['//evil.com', '/'],
    ['/\\evil.com', '/'],
    ['/login?callbackUrl=/x', '/'],
  ])('%s → %s', (raw, expected) => {
    expect(safeCallbackPath(raw)).toBe(expected);
  });
});
