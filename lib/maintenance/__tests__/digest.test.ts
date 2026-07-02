import { describe, it, expect } from 'vitest';
import { buildDigest, groupByOwner } from '../digest';
import type { TripwireException } from '../types';

function ex(overrides: Partial<TripwireException> = {}): TripwireException {
  return {
    tripwire: 3,
    label: '#3 Past-due next action',
    item: '[WAIT-OWNER] Window replacement — due 6/26',
    fixRequired: 'Jen calls owner; new date logged',
    owner: 'Jen',
    workOrderId: 'wo-1',
    ...overrides,
  };
}

describe('groupByOwner', () => {
  it('splits exceptions per owner', () => {
    const grouped = groupByOwner([
      ex(),
      ex({ owner: 'Cheryl', tripwire: 4, label: '#4 Vendor unaccepted > 24h' }),
      ex({ owner: 'Cheryl', tripwire: 8, label: '#8 Verified > 5 days, unbilled' }),
    ]);
    expect(grouped.get('Jen')).toHaveLength(1);
    expect(grouped.get('Cheryl')).toHaveLength(2);
  });
});

describe('buildDigest', () => {
  it('returns null on a clean day — no email at zero', () => {
    expect(buildDigest('Cheryl', [], '2026-07-02', 'https://app.example.com')).toBeNull();
  });

  it('builds subject with count and date', () => {
    const digest = buildDigest('Jen', [ex()], '2026-07-02', 'https://app.example.com')!;
    expect(digest.subject).toContain('(1)');
    expect(digest.subject).toContain('2026-07-02');
  });

  it('groups by tripwire order and includes deep link', () => {
    const digest = buildDigest(
      'Cheryl',
      [ex({ tripwire: 8, label: '#8 Unbilled' }), ex({ tripwire: 2, label: '#2 Unassigned' })],
      '2026-07-02',
      'https://app.example.com'
    )!;
    expect(digest.html.indexOf('#2 Unassigned')).toBeLessThan(digest.html.indexOf('#8 Unbilled'));
    expect(digest.html).toContain('https://app.example.com/maintenance/board?view=exceptions');
    expect(digest.text).toContain('https://app.example.com/maintenance/board?view=exceptions');
  });

  it('escapes HTML in item text', () => {
    const digest = buildDigest(
      'Cheryl',
      [ex({ item: 'Fix <script>alert(1)</script> & more' })],
      '2026-07-02',
      'https://app.example.com'
    )!;
    expect(digest.html).not.toContain('<script>');
    expect(digest.html).toContain('&lt;script&gt;');
    expect(digest.html).toContain('&amp; more');
  });
});
