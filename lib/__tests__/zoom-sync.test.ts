import { describe, it, expect } from 'vitest';
import {
  resolvePhonePrimaries,
  orderByLastSyncedAscending,
  isSyncablePhone,
  EXCLUDED_PHONES,
  type ContactMapRow,
  type DesiredContact,
} from '../zoom-sync';
import type { AppFolioContact, ZoomContactType } from '../appfolio';

function contact(
  type: ZoomContactType,
  appfolioId: string,
  name: string,
  phone: string
): DesiredContact {
  const c: AppFolioContact = {
    appfolioId,
    type,
    name,
    phoneRaw: phone,
    email: null,
    propertyAddress: null,
  };
  return { contact: c, phone };
}

function mapRow(
  type: ZoomContactType,
  appfolioId: string,
  overrides: Partial<ContactMapRow> = {}
): ContactMapRow {
  return {
    id: `${type}:${appfolioId}`,
    contact_type: type,
    appfolio_id: appfolioId,
    zoom_external_contact_id: null,
    name: '',
    phone: null,
    email: null,
    description: null,
    active: true,
    last_synced_at: null,
    last_error: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('resolvePhonePrimaries', () => {
  it('keeps every contact as its own primary when no phone collides', () => {
    const desired = [
      contact('vendor', 'v-1', 'V - Acme', '+15415550001'),
      contact('owner', 'o-1', 'O - Smith', '+15415550002'),
    ];
    const { primaries, skipped } = resolvePhonePrimaries(desired, new Map(), new Map());
    expect(primaries).toHaveLength(2);
    expect(skipped).toHaveLength(0);
  });

  it('picks exactly one primary per colliding phone', () => {
    const desired = [
      contact('tenant', 't-1', 'T - Jones', '+15415550099'),
      contact('tenant', 't-2', 'T - Doe', '+15415550099'),
      contact('tenant', 't-3', 'T - Lee', '+15415550099'),
    ];
    const { primaries, skipped } = resolvePhonePrimaries(desired, new Map(), new Map());
    expect(primaries).toHaveLength(1);
    expect(skipped).toHaveLength(2);
  });

  it('prefers the incumbent already mapped to that phone\'s Zoom contact', () => {
    const desired = [
      contact('vendor', 'v-1', 'V - Acme', '+15415550099'),
      contact('tenant', 't-1', 'T - Jones', '+15415550099'),
    ];
    const phoneIndex = new Map([['+15415550099', 'zoom-abc']]);
    // Incumbent is the tenant map row, even though vendor would normally win
    // on type priority — the incumbent always wins.
    const mapByKey = new Map([
      ['tenant:t-1', mapRow('tenant', 't-1', { zoom_external_contact_id: 'zoom-abc' })],
    ]);
    const { primaries, skipped } = resolvePhonePrimaries(desired, phoneIndex, mapByKey);
    expect(primaries).toEqual([desired[1]]);
    expect(skipped).toHaveLength(1);
    expect(skipped[0].contact.appfolioId).toBe('v-1');
    expect(skipped[0].reason).toContain('T - Jones');
  });

  it('falls back to type priority (vendor > owner > tenant) when there is no incumbent', () => {
    const desired = [
      contact('tenant', 't-1', 'T - Jones', '+15415550099'),
      contact('owner', 'o-1', 'O - Smith', '+15415550099'),
      contact('vendor', 'v-1', 'V - Acme', '+15415550099'),
    ];
    const { primaries, skipped } = resolvePhonePrimaries(desired, new Map(), new Map());
    expect(primaries).toHaveLength(1);
    expect(primaries[0].contact.type).toBe('vendor');
    expect(primaries[0].contact.appfolioId).toBe('v-1');
    expect(skipped).toHaveLength(2);
    expect(skipped.every((s) => s.reason.includes('V - Acme'))).toBe(true);
  });

  it('falls back to lowest appfolioId (numeric AppFolio record id) when type priority ties and there is no incumbent', () => {
    const desired = [
      contact('vendor', '42', 'V - Zeta', '+15415550099'),
      contact('vendor', '7', 'V - Alpha', '+15415550099'),
      contact('vendor', '100', 'V - Omega', '+15415550099'),
    ];
    const { primaries, skipped } = resolvePhonePrimaries(desired, new Map(), new Map());
    expect(primaries).toHaveLength(1);
    expect(primaries[0].contact.appfolioId).toBe('7');
    expect(skipped).toHaveLength(2);
  });

  it('handles multiple independent collision groups', () => {
    const desired = [
      contact('vendor', 'v-1', 'V - Acme', '+15415550001'),
      contact('vendor', 'v-2', 'V - Acme South', '+15415550001'),
      contact('owner', 'o-1', 'O - Smith', '+15415550002'),
      contact('owner', 'o-2', 'O - Smith Jr', '+15415550002'),
      contact('tenant', 't-1', 'T - Lone', '+15415550003'),
    ];
    const { primaries, skipped } = resolvePhonePrimaries(desired, new Map(), new Map());
    expect(primaries).toHaveLength(3); // one per phone group
    expect(skipped).toHaveLength(2);
    const primaryIds = primaries.map((p) => p.contact.appfolioId).sort();
    expect(primaryIds).toEqual(['o-1', 't-1', 'v-1']);
  });
});

describe('orderByLastSyncedAscending', () => {
  it('sorts never-synced contacts (no map row, or null last_synced_at) first', () => {
    const desired = [
      contact('vendor', 'v-recent', 'V - Recent', '+15415550001'),
      contact('vendor', 'v-never-mapped', 'V - NoRow', '+15415550002'),
      contact('vendor', 'v-never-synced', 'V - NullSync', '+15415550003'),
    ];
    const mapByKey = new Map([
      ['vendor:v-recent', mapRow('vendor', 'v-recent', { last_synced_at: '2026-08-01T00:00:00Z' })],
      ['vendor:v-never-synced', mapRow('vendor', 'v-never-synced', { last_synced_at: null })],
      // v-never-mapped intentionally has no map row at all.
    ]);
    const ordered = orderByLastSyncedAscending(desired, mapByKey);
    const ids = ordered.map((d) => d.contact.appfolioId);
    expect(ids[2]).toBe('v-recent');
    expect(ids.slice(0, 2).sort()).toEqual(['v-never-mapped', 'v-never-synced']);
  });

  it('orders synced contacts oldest-first', () => {
    const desired = [
      contact('vendor', 'v-newest', 'V - Newest', '+15415550001'),
      contact('vendor', 'v-oldest', 'V - Oldest', '+15415550002'),
      contact('vendor', 'v-middle', 'V - Middle', '+15415550003'),
    ];
    const mapByKey = new Map([
      ['vendor:v-newest', mapRow('vendor', 'v-newest', { last_synced_at: '2026-08-10T00:00:00Z' })],
      ['vendor:v-oldest', mapRow('vendor', 'v-oldest', { last_synced_at: '2026-01-01T00:00:00Z' })],
      ['vendor:v-middle', mapRow('vendor', 'v-middle', { last_synced_at: '2026-05-01T00:00:00Z' })],
    ]);
    const ordered = orderByLastSyncedAscending(desired, mapByKey);
    expect(ordered.map((d) => d.contact.appfolioId)).toEqual(['v-oldest', 'v-middle', 'v-newest']);
  });

  it('does not mutate the input array', () => {
    const desired = [
      contact('vendor', 'v-b', 'V - B', '+15415550001'),
      contact('vendor', 'v-a', 'V - A', '+15415550002'),
    ];
    const original = [...desired];
    orderByLastSyncedAscending(desired, new Map());
    expect(desired).toEqual(original);
  });
});

describe('isSyncablePhone', () => {
  it('rejects null', () => {
    expect(isSyncablePhone(null)).toBe(false);
  });

  it('rejects excluded shared/office lines', () => {
    for (const p of EXCLUDED_PHONES) {
      expect(isSyncablePhone(p)).toBe(false);
    }
    // The known HDPM office line specifically.
    expect(isSyncablePhone('+15415480383')).toBe(false);
  });

  it('accepts an ordinary normalized number', () => {
    expect(isSyncablePhone('+15415550123')).toBe(true);
  });
});
