import { describe, it, expect } from 'vitest';
import {
  matchOpenEstimatesRequest,
  buildOpenEstimatesCard,
} from '@/lib/agents/dez/open-estimates';
import type { OpenEstimateItem, OpenEstimateState } from '@/lib/agents/estimate-chaser-run';

function item(over: Partial<OpenEstimateItem> = {}): OpenEstimateItem {
  return {
    workOrderId: 'wo1',
    woNumber: '1234',
    propertyName: 'Maple House',
    propertyAddress: '1 Maple St',
    unitName: 'B',
    vendorName: 'Acme Plumbing',
    ageBusinessDays: 10,
    ageCalendarDays: 14,
    appfolioLink: 'https://af.example/wo/1',
    state: 'waiting',
    ...over,
  };
}

describe('matchOpenEstimatesRequest', () => {
  it('matches list-style asks and defaults target to the asker', () => {
    expect(matchOpenEstimatesRequest('show me the open estimates')).toEqual({ targetName: null });
    expect(matchOpenEstimatesRequest('what are the open estimates')).toEqual({ targetName: null });
    expect(matchOpenEstimatesRequest('list outstanding estimates')).toEqual({ targetName: null });
  });

  it('extracts an explicit target person', () => {
    expect(matchOpenEstimatesRequest('send Craig the open estimates')).toEqual({ targetName: 'Craig' });
    expect(matchOpenEstimatesRequest('dm Brody the open estimates')).toEqual({ targetName: 'Brody' });
    expect(matchOpenEstimatesRequest('pull up the open estimates for Matt')).toEqual({ targetName: 'Matt' });
  });

  it('treats "me/us" as the asker, not a name', () => {
    expect(matchOpenEstimatesRequest('send me the open estimates')).toEqual({ targetName: null });
    expect(matchOpenEstimatesRequest('get us the outstanding estimates')).toEqual({ targetName: null });
  });

  it('ignores count/metric questions (KPI lane owns those)', () => {
    expect(matchOpenEstimatesRequest('how many open estimates do we have')).toBeNull();
    expect(matchOpenEstimatesRequest('number of open estimates')).toBeNull();
  });

  it('ignores unrelated questions', () => {
    expect(matchOpenEstimatesRequest('what is our occupancy')).toBeNull();
    expect(matchOpenEstimatesRequest('estimate the cost of a new roof')).toBeNull(); // no "open"
  });
});

describe('buildOpenEstimatesCard', () => {
  it('shows an empty-state card when there are none', () => {
    const card = buildOpenEstimatesCard({ items: [], forName: 'Craig' });
    expect(card.text).toContain('No open estimates');
    expect(JSON.stringify(card.blocks)).toContain('No open estimates');
  });

  it('groups by state in priority order with counts and AppFolio links', () => {
    const items = [
      item({ workOrderId: 'a', state: 'waiting', ageCalendarDays: 5 }),
      item({ workOrderId: 'b', state: 'escalated', ageCalendarDays: 60, woNumber: '9999' }),
      item({ workOrderId: 'c', state: 'approval', ageCalendarDays: 20 }),
      item({ workOrderId: 'd', state: 'waiting', ageCalendarDays: 30 }),
    ];
    const card = buildOpenEstimatesCard({ items, forName: 'Craig' });
    const json = JSON.stringify(card.blocks);
    expect(card.text).toContain('4 total');
    expect(json).toContain('Escalated');
    expect(json).toContain('Bid in hand');
    expect(json).toContain('Waiting on vendor bid');
    expect(json).toContain('af.example'); // deep link present
    // Escalated section appears before the waiting section.
    expect(json.indexOf('Escalated')).toBeLessThan(json.indexOf('Waiting on vendor bid'));
    // Within waiting, the older (30d) sorts above the newer (5d).
    const waitingBlock = json.slice(json.indexOf('Waiting on vendor bid'));
    expect(waitingBlock.indexOf('30d')).toBeLessThan(waitingBlock.indexOf('5d'));
  });

  it('stays within Slack’s 50-block cap for a large pool', () => {
    const many: OpenEstimateItem[] = Array.from({ length: 300 }, (_, i) =>
      item({ workOrderId: `w${i}`, woNumber: String(i), state: (['escalated', 'approval', 'waiting', 'cooldown'] as OpenEstimateState[])[i % 4] })
    );
    const card = buildOpenEstimatesCard({ items: many, forName: 'Craig' });
    expect(card.blocks.length).toBeLessThanOrEqual(50);
  });
});
