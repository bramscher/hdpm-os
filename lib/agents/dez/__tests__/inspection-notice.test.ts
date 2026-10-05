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
    route_plan_id: 'plan-1',
    route_assigned_to: 'brody@highdesertpm.com',
    route_window: 'between 8:30 AM and 1:00 PM',
    arrival: '9:15 AM',
    previous_target_date: null,
    financially_responsible: null,
    appfolio_unit_id: 'u1',
    synced_at: null,
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
    expect(json).toContain('Review & Send');
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
    expect(json).not.toContain('Review & Send');
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

describe('route card with Realm-X request', () => {
  it('shows the window, the paste-ready request, and a date-changed title', () => {
    const card = buildInspectionNoticeCard({
      proposalId: 'p1',
      routeDate: '2026-09-15',
      items: toNoticeCardItems([notice({ financially_responsible: ['Jane Doe', 'John Doe'] })]),
      windowLabel: 'between 8:30 AM and 1:00 PM',
      realmxRequest: 'Draft a bulk email (do not send yet) to the current tenants of these units:',
      dateChanged: true,
    });
    const text = JSON.stringify(card.blocks);
    expect(text).toContain('Date changed');
    expect(text).toContain('between 8:30 AM and 1:00 PM');
    expect(text).toContain('Jane Doe, John Doe');
    expect(text).toContain('Draft a bulk email');
  });
  it('drops the request once resolved', () => {
    const card = buildInspectionNoticeCard({ proposalId: 'p1', routeDate: '2026-09-15', items: [], realmxRequest: 'REQ', resolution: 'done' });
    expect(JSON.stringify(card.blocks)).not.toContain('REQ');
  });
});

describe('without Realm-X', () => {
  it('points to the AppFolio letter with the date and window', () => {
    const card = buildInspectionNoticeCard({ proposalId: 'p1', routeDate: '2026-10-14', items: [], windowLabel: 'between 8:30 AM and 1:00 PM' });
    const text = JSON.stringify(card.blocks);
    expect(text).toContain('Inspection Letter');
    expect(text).toContain('Wednesday, October 14, 2026, between 8:30 AM and 1:00 PM');
    expect(text).not.toContain('Paste this into AppFolio');
  });
});

