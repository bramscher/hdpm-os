import { describe, it, expect, afterEach } from 'vitest';
import { isPartnersHost, partnerHostRoute, partnersBaseUrl } from '../partner-host';

describe('partners host', () => {
  it('recognises the partners hostname, with or without a port', () => {
    expect(isPartnersHost('partners.highdesertpm.com')).toBe(true);
    expect(isPartnersHost('PARTNERS.highdesertpm.com:443')).toBe(true);
    expect(isPartnersHost('os.highdesertpm.com')).toBe(false);
    expect(isPartnersHost(null)).toBe(false);
  });

  it('serves the portal at the root and bare referrer paths', () => {
    expect(partnerHostRoute('/')).toEqual({ kind: 'rewrite', path: '/partners' });
    expect(partnerHostRoute('/login')).toEqual({ kind: 'rewrite', path: '/partners/login' });
    expect(partnerHostRoute('/leads/new')).toEqual({ kind: 'rewrite', path: '/partners/leads/new' });
    expect(partnerHostRoute('/invite/abc123')).toEqual({ kind: 'rewrite', path: '/partners/invite/abc123' });
    expect(partnerHostRoute('/auth/callback', '?code=x&next=/partners')).toEqual({ kind: 'rewrite', path: '/partners/auth/callback?code=x&next=/partners' });
  });

  it('lets existing /partners links and the referrer APIs through', () => {
    expect(partnerHostRoute('/partners/leads')).toEqual({ kind: 'pass' });
    expect(partnerHostRoute('/api/partners/leads')).toEqual({ kind: 'pass' });
    expect(partnerHostRoute('/api/partners/invite/accept')).toEqual({ kind: 'pass' });
    expect(partnerHostRoute('/_next/static/chunks/x.js')).toEqual({ kind: 'pass' });
  });

  it('keeps every staff surface off the partners host', () => {
    expect(partnerHostRoute('/partners/admin')).toEqual({ kind: 'redirect', url: 'https://os.highdesertpm.com/partners/admin' });
    expect(partnerHostRoute('/partners/admin/payouts')).toMatchObject({ kind: 'redirect' });
    expect(partnerHostRoute('/agents')).toEqual({ kind: 'redirect', url: 'https://os.highdesertpm.com/agents' });
    expect(partnerHostRoute('/dashboard', '?x=1')).toEqual({ kind: 'redirect', url: 'https://os.highdesertpm.com/dashboard?x=1' });
    expect(partnerHostRoute('/api/partners/admin/payouts')).toEqual({ kind: 'not_found' });
    expect(partnerHostRoute('/api/agents/activity')).toEqual({ kind: 'not_found' });
    expect(partnerHostRoute('/api/sync/keys')).toEqual({ kind: 'not_found' });
  });
});

describe('partnersBaseUrl', () => {
  afterEach(() => {
    delete process.env.PARTNERS_BASE_URL;
  });
  it('uses PARTNERS_BASE_URL when set, else the request origin', () => {
    expect(partnersBaseUrl('https://os.highdesertpm.com')).toBe('https://os.highdesertpm.com');
    process.env.PARTNERS_BASE_URL = 'https://partners.highdesertpm.com/';
    expect(partnersBaseUrl('https://os.highdesertpm.com')).toBe('https://partners.highdesertpm.com');
  });
});
