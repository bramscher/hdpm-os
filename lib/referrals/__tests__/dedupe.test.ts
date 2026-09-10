import { describe, it, expect } from 'vitest';
import { findDuplicate, normName, normPhone, type DedupeCandidate } from '../dedupe';

const lead = (o: Partial<DedupeCandidate>): DedupeCandidate => ({
  kind: 'lead',
  id: o.id ?? 'L1',
  name: o.name ?? null,
  email: o.email ?? null,
  phone: o.phone ?? null,
  firstTouchAt: o.firstTouchAt ?? '2026-08-01T00:00:00Z',
});

describe('dedupe normalizers', () => {
  it('normalizes phone to last 10 digits', () => {
    expect(normPhone('+1 (541) 555-1234')).toBe('5415551234');
    expect(normPhone('555-1234')).toBeNull(); // too short
  });
  it('strips the AppFolio "O - " prefix and punctuation from names', () => {
    expect(normName('O - Jane Q. Smith')).toBe('jane q smith');
    expect(normName('Jane   SMITH')).toBe('jane smith');
  });
});

describe('findDuplicate — first-touch wins', () => {
  it('matches on email over everything', () => {
    const hit = findDuplicate(
      { name: 'Different Name', email: 'JANE@x.com', phone: null },
      [lead({ id: 'A', email: 'jane@x.com' })]
    );
    expect(hit).toEqual({ candidate: expect.objectContaining({ id: 'A' }), reason: 'email' });
  });

  it('falls back to phone when email does not match', () => {
    const hit = findDuplicate(
      { name: null, email: 'new@x.com', phone: '(541) 555-0000' },
      [lead({ id: 'B', email: 'old@x.com', phone: '541-555-0000' })]
    );
    expect(hit?.reason).toBe('phone');
    expect(hit?.candidate.id).toBe('B');
  });

  it('falls back to exact normalized name', () => {
    const hit = findDuplicate({ name: 'jane smith', email: null, phone: null }, [
      lead({ id: 'C', name: 'Jane Smith' }),
    ]);
    expect(hit?.reason).toBe('name');
  });

  it('returns null when nothing matches', () => {
    expect(findDuplicate({ name: 'Nobody', email: 'no@x.com', phone: '5410000000' }, [
      lead({ id: 'D', name: 'Someone Else', email: 'other@x.com', phone: '5419999999' }),
    ])).toBeNull();
  });

  it('picks the earliest first-touch lead among email matches', () => {
    const hit = findDuplicate({ email: 'dupe@x.com' }, [
      lead({ id: 'late', email: 'dupe@x.com', firstTouchAt: '2026-08-10T00:00:00Z' }),
      lead({ id: 'early', email: 'dupe@x.com', firstTouchAt: '2026-08-02T00:00:00Z' }),
    ]);
    expect(hit?.candidate.id).toBe('early');
  });

  it('flags a prospect that is already an AppFolio owner', () => {
    const hit = findDuplicate({ name: 'Acme Holdings LLC' }, [
      { kind: 'owner', id: 'O-9', name: 'O - Acme Holdings LLC', email: null, phone: null },
    ]);
    expect(hit?.reason).toBe('name');
    expect(hit?.candidate.kind).toBe('owner');
  });

  it('does not match on too-short/empty names (avoids false positives)', () => {
    expect(findDuplicate({ name: 'Jo' }, [lead({ id: 'E', name: 'Jo' })])).toBeNull();
  });
});
