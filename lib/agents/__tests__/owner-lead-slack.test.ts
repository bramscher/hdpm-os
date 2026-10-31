import { describe, it, expect } from 'vitest';
import {
  buildOwnerLeadCard,
  buildOwnerNudge,
  parseOlActionId,
  olActionId,
  redrawOwnerLeadCard,
} from '../owner-lead-slack';

const lead = {
  id: 42,
  name: 'Pat Owner',
  phone: '541-555-0100',
  email: 'pat@example.com',
  status: 'new',
  source: 'website',
  message: 'I have a duplex in Redmond',
  property: '123 Main St, Redmond',
  allowedStatuses: ['attempted_contact', 'engaged', 'consult_booked', 'lost', 'archived'],
};

describe('owner lead card', () => {
  it('round-trips action ids', () => {
    expect(parseOlActionId(olActionId(42, 'consult_booked'))).toEqual({ leadId: 42, status: 'consult_booked' });
    expect(parseOlActionId('ec:42:x')).toBeNull();
  });

  it('shows details, the message, and a button per allowed stage (never archived)', () => {
    const { blocks } = buildOwnerLeadCard(lead);
    const text = JSON.stringify(blocks);
    expect(text).toContain('Pat Owner');
    expect(text).toContain('123 Main St, Redmond');
    expect(text).toContain('I have a duplex in Redmond');
    const actions = blocks.find((b) => b.type === 'actions') as { elements: Array<{ action_id: string }> };
    expect(actions.elements.map((e) => e.action_id)).toEqual([
      'ol:42:attempted_contact',
      'ol:42:engaged',
      'ol:42:consult_booked',
      'ol:42:lost',
    ]);
  });

  it('redraw keeps the original details and swaps stage + buttons', () => {
    const original = buildOwnerLeadCard(lead).blocks;
    const moved = { id: 42, name: 'Pat Owner', status: 'consult_booked', allowedStatuses: ['proposal_sent', 'engaged', 'lost', 'archived'] };
    const blocks = redrawOwnerLeadCard(original, moved, 'Moved to Consult booked by Craig 9:05 AM');
    const text = JSON.stringify(blocks);
    expect(text).toContain('123 Main St, Redmond');
    expect(text).toContain('Stage: *Consult booked*');
    expect(text).toContain('ol:42:proposal_sent');
    expect(text).not.toContain('ol:42:consult_booked');
    expect(text).toContain('Moved to Consult booked by Craig');
  });
});

describe('owner nudge', () => {
  it('lists oldest first with age and counts the rest', () => {
    const now = new Date('2026-11-02T15:30:00Z');
    const n = buildOwnerNudge(
      [
        { name: 'Newer', createdAt: '2026-11-02T10:00:00Z', phone: '1' },
        { name: 'Older', createdAt: '2026-10-28T10:00:00Z', email: 'o@x.com' },
      ],
      67,
      now
    );
    const body = (n.blocks[0] as { text: { text: string } }).text.text;
    expect(n.text).toBe('67 owner leads still at New');
    expect(body.indexOf('Older')).toBeLessThan(body.indexOf('Newer'));
    expect(body).toContain('*Older* — 5d · o@x.com');
    expect(body).toContain('…and 65 more');
  });
});
