import { describe, it, expect } from 'vitest';
import {
  buildNoticeActionId,
  parseNoticeActionId,
  toNoticeCardItems,
  buildInspectionNoticeCard,
  getNoticeOwner,
} from '@/lib/agents/dez/inspection-notice';
import type { DueNotice } from '@/lib/inspection-notify';

function notice(over: Partial<DueNotice> = {}): DueNotice {
  return {
    id: 'i1',
    target_date: '2026-09-15',
    resident_name: 'Jane Doe',
    email: 'jane@example.com',
    address: '1420 NW Elm, Bend, OR',
    subject: 's',
    body: 'b',
    status: 'pending',
    attempts: 0,
    channel: null,
    error: null,
    ...over,
  };
}

describe('action id round-trip', () => {
  it('builds and parses sent/dismiss ids (uuid-safe)', () => {
    const id = 'a1b2-c3d4:with:colons';
    expect(parseNoticeActionId(buildNoticeActionId('sent', id))).toEqual({ kind: 'sent', proposalId: id });
    expect(parseNoticeActionId(buildNoticeActionId('dismiss', id))).toEqual({
      kind: 'dismiss',
      proposalId: id,
    });
  });

  it('returns null for foreign action ids', () => {
    expect(parseNoticeActionId('op:approve:x')).toBeNull();
    expect(parseNoticeActionId('dznotice:bogus:x')).toBeNull();
    expect(parseNoticeActionId('')).toBeNull();
  });
});

describe('toNoticeCardItems', () => {
  it('maps rows and flags missing email', () => {
    const items = toNoticeCardItems([notice(), notice({ id: 'i2', email: null, resident_name: '' })]);
    expect(items[0]).toEqual({ who: 'Jane Doe', address: '1420 NW Elm, Bend, OR', date: '2026-09-15', hasEmail: true });
    expect(items[1]).toEqual({ who: 'Resident', address: '1420 NW Elm, Bend, OR', date: '2026-09-15', hasEmail: false });
  });
});

describe('buildInspectionNoticeCard', () => {
  const items = toNoticeCardItems([notice(), notice({ id: 'i2', email: null })]);

  it('shows action buttons when unresolved, with the sendable count on Mark all sent', () => {
    const card = buildInspectionNoticeCard({ proposalId: 'p1', routeDate: '2026-09-15', items });
    const json = JSON.stringify(card.blocks);
    expect(json).toContain('Review & Send in Realm-X');
    expect(json).toContain('Mark all sent (1)'); // only 1 of 2 has an email
    expect(json).toContain(buildNoticeActionId('sent', 'p1'));
    expect(json).toContain('no tenant email'); // missing-email warning present
    expect(card.text).toContain('2 inspection notices');
  });

  it('replaces buttons with the resolution line once resolved', () => {
    const card = buildInspectionNoticeCard({
      proposalId: 'p1',
      routeDate: '2026-09-15',
      items,
      resolution: '✅ 1 notice marked sent by Brody 9:00 AM.',
    });
    const json = JSON.stringify(card.blocks);
    expect(json).not.toContain('Review & Send in Realm-X');
    expect(json).not.toContain(buildNoticeActionId('sent', 'p1'));
    expect(json).toContain('marked sent by Brody');
  });
});

describe('getNoticeOwner', () => {
  it('defaults to Brody', () => {
    const prev = process.env.DEZ_INSPECTION_NOTICE_OWNER;
    delete process.env.DEZ_INSPECTION_NOTICE_OWNER;
    expect(getNoticeOwner()).toBe('Brody');
    if (prev !== undefined) process.env.DEZ_INSPECTION_NOTICE_OWNER = prev;
  });
});
