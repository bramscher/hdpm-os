import { describe, it, expect } from 'vitest';
import { fromRoutineRun, fromProposal, fromOutbox, fromPartsEvent, fromBrainIngest, isHumanActor, mergeFeed, type FeedItem } from '../activity-feed';

describe('feed mappers', () => {
  it('names routine runs from the registry and colours by status', () => {
    expect(fromRoutineRun({ id: 1, routine_id: 'estimate_chaser', status: 'halted', halt_reason: 'kill switch', started_at: '2026-10-05T13:45:00Z', finished_at: '2026-10-05T13:45:03Z' })).toMatchObject({
      text: 'Stuck Estimate Chaser halted: kill switch', tone: 'warn', at: '2026-10-05T13:45:03Z',
    });
    expect(fromRoutineRun({ id: 2, routine_id: 'kpi_snapshot', status: 'error', error: 'timeout', started_at: 'x' }).tone).toBe('bad');
  });
  it('credits the human who decided a proposal', () => {
    const item = fromProposal({ id: 'p', agent: 'estimate_chaser', action_type: 'vendor_chase', status: 'approved', decided_by: 'Craig', decided_at: '2026-10-05T15:00:00Z', created_at: '2026-10-05T13:00:00Z', subject_type: 'work_order', subject_id: 'wo1' });
    expect(item).toMatchObject({ actor: 'Craig', tone: 'human', at: '2026-10-05T15:00:00Z', href: '/maintenance/board/wo/wo1' });
  });
  it('describes outbox sends and failures', () => {
    expect(fromOutbox({ id: 'o', channel: 'slack', recipient_person: 'Brody', status: 'sent', sent_at: 't' }).text).toBe('Slack to Brody sent');
    expect(fromOutbox({ id: 'o', channel: 'email', recipient_address: 'v@x.com', status: 'failed', error: '550', created_at: 't' })).toMatchObject({ text: 'email to v@x.com failed: 550', tone: 'bad' });
  });
  it('links parts events to the work order through the joined order', () => {
    expect(fromPartsEvent({ id: 9, kind: 'call', minutes_spent: 20, actor: 'Cheryl', note: 'Lowe’s says Friday', at: 't', parts_order: { item: 'Dishwasher', work_order_id: 'wo9' } })).toMatchObject({
      text: 'Parts order “Dishwasher” call (20 min): Lowe’s says Friday', href: '/maintenance/board/wo/wo9',
    });
  });
  it('labels brain ingests', () => {
    expect(fromBrainIngest({ id: 1, action: 'add', ref: 'SOP: Move-out', source: 'notion', at: 't' }).text).toBe('Learned SOP: Move-out');
  });
});

describe('isHumanActor', () => {
  it('rejects system and agent actors', () => {
    expect(['Craig', 'penny@highdesertpm.com'].every(isHumanActor)).toBe(true);
    expect(['system:sync', 'agent:estimate_chaser', '', null].some(isHumanActor)).toBe(false);
  });
});

describe('mergeFeed', () => {
  const item = (id: string, at: string): FeedItem => ({ id, at, source: 'dez', actor: 'x', text: 'x', tone: 'neutral' });
  it('sorts newest first, dedupes, drops undated and caps', () => {
    const out = mergeFeed([[item('a', '2026-10-01'), item('b', '2026-10-03')], [item('a', '2026-10-01'), item('c', '2026-10-02'), item('d', '')]], 2);
    expect(out.map((i) => i.id)).toEqual(['b', 'c']);
  });
});
