import { describe, expect, it } from 'vitest';
import { computeSlips, looksFinished, sortSlips, workDone, type SlipTurn, type SlipWo } from '../slips';
import { buildSlipBlocks, markSlipHandled, parseSlipAction, encodeSlipAction, SLIP_LIST_CAP } from '../slip-message';

const wo = (o: Partial<SlipWo> = {}): SlipWo => ({
  id: 'wo-1', wo_number: '100-1', unit_turn_category: 'Paint', description: 'Paint', appfolio_status: 'Assigned', status: 'open', canceled_date: null,
  turn_status: null, turn_status_af_basis: null, scheduled_start: '2026-12-30', completed_date: null, assigned_to: 'Brody', vendor_name: null,
  created_at: '2026-11-09T12:00:00Z', turn_snoozed_until: null, ...o,
});
const turn = (o: Partial<SlipTurn> = {}): SlipTurn => ({ id: 't1', unit: 'Elm 1', vacated_at: '2026-11-09', coordinator: 'Brody', status: 'active', wos: [wo()], checks: {}, ...o });
const kinds = (t: SlipTurn, today: string, snooze = {}) => computeSlips(t, today, snooze).map((s) => s.kind);
const ticked = { checked: true, value: null, checked_at: null, checked_by: null };

// Nov 9 2026 is a Monday.
describe('checklist deadlines', () => {
  it('keys are late the business day after move-out, inspection the day after that', () => {
    expect(kinds(turn(), '2026-11-09')).toEqual([]);
    expect(kinds(turn(), '2026-11-10')).toEqual(['keys']);
    expect(kinds(turn(), '2026-11-11')).toEqual(['keys', 'inspection']);
    expect(kinds(turn({ checks: { keys_received: ticked, moveout_inspection: ticked } }), '2026-11-11')).toEqual([]);
  });
  it('a weekend move-out counts from Monday, and weekends do not add days', () => {
    expect(kinds(turn({ vacated_at: '2026-11-07' }), '2026-11-09')).toEqual([]);
    expect(kinds(turn({ vacated_at: '2026-11-07' }), '2026-11-10')).toEqual(['keys']);
    const fri = computeSlips(turn({ vacated_at: '2026-11-13' }), '2026-11-16');
    expect(fri[0].daysLate).toBe(1);
  });
  it('skips checklist steps on turns from before the trial', () => {
    expect(kinds(turn({ vacated_at: '2026-11-03' }), '2026-11-05')).toEqual([]);
  });
  it('ignores future move-outs and closed turns', () => {
    expect(kinds(turn({ vacated_at: '2026-12-01' }), '2026-11-20')).toEqual([]);
    expect(kinds(turn({ status: 'closed' }), '2026-11-20')).toEqual([]);
  });
});

describe('work order slips', () => {
  const old = { vacated_at: '2026-10-01', checks: {} };
  it('flags a turn with no work orders after 2 business days', () => {
    expect(kinds(turn({ ...old, vacated_at: '2026-10-26', wos: [] }), '2026-10-28')).toEqual([]);
    expect(kinds(turn({ ...old, vacated_at: '2026-10-26', wos: [] }), '2026-10-29')).toEqual(['no_work_orders']);
  });
  it('flags no owner or vendor, then no date, and gives a new work order its full time', () => {
    const made = '2026-10-19T12:00:00Z';
    expect(kinds(turn({ ...old, wos: [wo({ assigned_to: null, scheduled_start: null, created_at: made })] }), '2026-10-22')).toEqual([]);
    expect(kinds(turn({ ...old, wos: [wo({ assigned_to: null, scheduled_start: null, created_at: made })] }), '2026-10-23')).toEqual(['wo_owner']);
    expect(kinds(turn({ ...old, wos: [wo({ scheduled_start: null, created_at: made })] }), '2026-10-23')).toEqual(['wo_date']);
  });
  it('flags a passed vendor date only once it has passed', () => {
    const w = wo({ scheduled_start: '2026-10-20T00:00:00Z', vendor_name: 'Firkus', created_at: '2026-10-02T00:00:00Z' });
    expect(kinds(turn({ ...old, wos: [w] }), '2026-10-20')).toEqual([]);
    expect(kinds(turn({ ...old, wos: [w] }), '2026-10-21')).toEqual(['wo_vendor_date']);
  });
  it('leaves estimate work to the Chase board and honors a work order snooze', () => {
    const none = { scheduled_start: null, assigned_to: null, created_at: '2026-10-02T00:00:00Z' };
    expect(kinds(turn({ ...old, wos: [wo({ ...none, appfolio_status: 'Estimate Requested' })] }), '2026-10-23')).toEqual([]);
    expect(kinds(turn({ ...old, wos: [wo({ ...none, turn_snoozed_until: '2026-10-25' })] }), '2026-10-23')).toEqual([]);
    expect(kinds(turn({ ...old, wos: [wo({ ...none, turn_snoozed_until: '2026-10-22' })] }), '2026-10-23')).toEqual(['wo_owner']);
  });
});

describe('ready and deposit', () => {
  const done = wo({ appfolio_status: 'Completed', status: 'done', completed_date: '2026-11-16' });
  const base = { checks: { keys_received: ticked, moveout_inspection: ticked } };
  it('flags ready for showing a business day after the last work finished', () => {
    expect(kinds(turn({ ...base, wos: [done] }), '2026-11-17')).toEqual([]);
    expect(kinds(turn({ ...base, wos: [done] }), '2026-11-18')).toEqual(['ready']);
  });
  it('flags the deposit slip after 30 days, escalates at 5 business days, and stops after the window', () => {
    const t = turn({ vacated_at: '2026-10-01', wos: [wo({ scheduled_start: '2026-12-30', created_at: '2026-10-01T00:00:00Z' })] });
    expect(kinds(t, '2026-10-31')).toEqual([]);
    const due = computeSlips(t, '2026-11-02')[0];
    expect(due.kind).toBe('deposit');
    expect(due.escalate).toBe(false);
    expect(computeSlips(t, '2026-11-09')[0].escalate).toBe(true);
    expect(kinds(t, '2026-12-05')).toEqual([]);
  });
  it('a snooze holds through its date', () => {
    expect(kinds(turn(), '2026-11-10', { keys: '2026-11-10' })).toEqual([]);
    expect(kinds(turn(), '2026-11-11', { keys: '2026-11-10' })).toEqual(['keys', 'inspection']);
  });
  it('sorts deposit slips first, then longest late', () => {
    const base2 = { turnId: 't', unit: 'U', coordinator: null, text: '' };
    const out = sortSlips([{ ...base2, key: 'a', kind: 'keys', daysLate: 9 }, { ...base2, key: 'b', kind: 'deposit', daysLate: 1 }, { ...base2, key: 'c', kind: 'keys', daysLate: 12 }]);
    expect(out.map((s) => s.key)).toEqual(['b', 'c', 'a']);
  });
});

describe('looks finished', () => {
  const done = wo({ appfolio_status: 'Completed', status: 'done' });
  it('needs all work done and a passed move-in', () => {
    expect(looksFinished({ status: 'active', movein_date: '2026-11-01', wos: [done] }, '2026-11-02')).toBe(true);
    expect(looksFinished({ status: 'active', movein_date: '2026-11-02', wos: [done] }, '2026-11-02')).toBe(false);
    expect(looksFinished({ status: 'active', movein_date: null, wos: [done] }, '2026-11-02')).toBe(false);
    expect(looksFinished({ status: 'active', movein_date: '2026-11-01', wos: [done, wo()] }, '2026-11-02')).toBe(false);
    expect(looksFinished({ status: 'closed', movein_date: '2026-11-01', wos: [done] }, '2026-11-02')).toBe(false);
  });
  it('does not treat no work, or only cancelled work, as done', () => {
    expect(workDone([])).toBe(false);
    expect(workDone([wo({ appfolio_status: 'Canceled' })])).toBe(false);
  });
});

describe('the Slack list', () => {
  const slip = (key: string) => ({ key, kind: 'keys' as const, turnId: '11111111-1111-1111-1111-111111111111', unit: 'Elm <1>', coordinator: 'Brody', text: 'Keys', daysLate: 2, doneKey: 'keys_received' });
  it('round-trips action ids, including work order keys, and rejects others', () => {
    const s = { turnId: '11111111-1111-1111-1111-111111111111', key: 'wo_date:22222222-2222-2222-2222-222222222222' };
    expect(parseSlipAction(encodeSlipAction('snooze', s))).toEqual({ kind: 'snooze', ...s });
    expect(parseSlipAction('ob:ack:x')).toBeNull();
  });
  it('caps the list, offers Done only when it can tick something, and marks preview', () => {
    const many = Array.from({ length: SLIP_LIST_CAP + 2 }, (_, i) => slip(`k${i}`));
    const s = JSON.stringify(buildSlipBlocks(many, { preview: true, onChaseBoard: 4 }).blocks);
    expect((s.match(/ts:snooze:/g) ?? []).length).toBe(SLIP_LIST_CAP);
    expect(s).toContain('+2 more');
    expect(s).toContain('Preview');
    expect(s).toContain('4 turn work orders');
    expect(s).not.toContain('Elm <1>');
    const noDone = JSON.stringify(buildSlipBlocks([{ ...slip('wo_date:x'), doneKey: undefined }], { preview: false }).blocks);
    expect(noDone).not.toContain('ts:done:');
    expect(noDone).not.toContain('Preview');
  });
  it('marks one slip handled and removes only its buttons', () => {
    const { blocks } = buildSlipBlocks([slip('a'), slip('b')], { preview: false });
    const out = JSON.stringify(markSlipHandled(blocks as Array<Record<string, unknown>>, slip('a'), '✓ Done by Brody'));
    expect(out).toContain('✓ Done by Brody');
    expect(out).not.toContain('ts:snooze:11111111-1111-1111-1111-111111111111:a"');
    expect(out).toContain('ts:snooze:11111111-1111-1111-1111-111111111111:b"');
  });
});
