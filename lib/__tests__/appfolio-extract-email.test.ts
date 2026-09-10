import { describe, it, expect } from 'vitest';
import { extractEmail } from '../appfolio';

/**
 * Loop 1 (estimate chaser) hard blocker: ~99% of vendors have an email in
 * AppFolio, yet the old extractEmail() — which only read a fixed list of field
 * names — found few. These cover the shapes the field-name-agnostic fallback
 * must catch so the chaser has a To: address. See the vendor-contact audit.
 */
describe('extractEmail', () => {
  it('reads the documented scalar fields', () => {
    expect(extractEmail({ Email: 'a@vendor.com' })).toBe('a@vendor.com');
    expect(extractEmail({ EmailAddress: 'b@vendor.com' })).toBe('b@vendor.com');
    expect(extractEmail({ PrimaryEmail: 'c@vendor.com' })).toBe('c@vendor.com');
  });

  it('reads the documented array forms', () => {
    expect(extractEmail({ Emails: ['d@vendor.com'] })).toBe('d@vendor.com');
    expect(extractEmail({ EmailAddresses: [{ EmailAddress: 'e@vendor.com' }] })).toBe(
      'e@vendor.com'
    );
    expect(extractEmail({ Emails: [{ Email: 'f@vendor.com' }] })).toBe('f@vendor.com');
  });

  it('finds an email nested under an unexpected key name (fallback)', () => {
    // The whole point: AppFolio hides it somewhere the explicit list misses.
    expect(extractEmail({ ContactEmail: 'g@vendor.com' })).toBe('g@vendor.com');
    expect(extractEmail({ Contact: { EmailAddr: 'h@vendor.com' } })).toBe('h@vendor.com');
    expect(
      extractEmail({ Contacts: [{ FirstName: 'Pat', WorkEmail: 'i@vendor.com' }] })
    ).toBe('i@vendor.com');
  });

  it('prefers a value under an *email* key over another email-shaped value', () => {
    // ReferredBy holds a clean email too, but PrimaryEmailAddress is the vendor's.
    const raw = {
      ReferredBy: 'old@stale.com',
      PrimaryEmailAddress: 'current@vendor.com',
    };
    expect(extractEmail(raw)).toBe('current@vendor.com');
  });

  it('falls back to any clean email value when no email-named key exists', () => {
    expect(extractEmail({ Correspondence: 'jobs@vendor.com' })).toBe('jobs@vendor.com');
  });

  it('does NOT pull an email embedded in free text (avoids grabbing the wrong party)', () => {
    // A notes field mentioning a tenant's email must not become the chase To:.
    expect(extractEmail({ Notes: 'tenant reached at renter@gmail.com re access' })).toBeNull();
  });

  it('returns null when there is no email anywhere', () => {
    expect(extractEmail({ CompanyName: 'Acme', Phone: '541-555-0100' })).toBeNull();
    expect(extractEmail({})).toBeNull();
  });

  it('ignores non-email @ noise and whitespace-laden values', () => {
    expect(extractEmail({ Handle: '@acme', Twitter: 'see @acme on x' })).toBeNull();
    expect(extractEmail({ Email: 'not an email @ all' })).toBeNull();
  });

  it('respects the depth cap (does not dig past 3 levels)', () => {
    const deep = { a: { b: { c: { d: { Email: 'toodeep@vendor.com' } } } } };
    expect(extractEmail(deep)).toBeNull();
  });
});
