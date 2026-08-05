import { describe, it, expect } from 'vitest';
import {
  currentQuarter,
  encodeRockActionId,
  parseRockActionId,
  buildRockCardBlocks,
  rockStatusLabel,
} from '@/lib/eos/rock';
import { buildSeatTree, SEAT_AGENTS } from '@/lib/eos/org';
import type { Seat } from '@/lib/eos/types';

describe('currentQuarter', () => {
  it('maps months to quarters in Pacific time', () => {
    expect(currentQuarter(new Date('2026-08-04T18:00:00Z'))).toBe('2026-Q3');
    expect(currentQuarter(new Date('2026-01-15T18:00:00Z'))).toBe('2026-Q1');
    expect(currentQuarter(new Date('2026-12-31T20:00:00Z'))).toBe('2026-Q4');
    // Jan 1 03:00 UTC is still Dec 31 Pacific
    expect(currentQuarter(new Date('2027-01-01T03:00:00Z'))).toBe('2026-Q4');
  });
});

describe('rock action ids', () => {
  it('round-trips', () => {
    expect(parseRockActionId(encodeRockActionId('on', 'r-1'))).toEqual({ kind: 'on', rockId: 'r-1' });
    expect(parseRockActionId(encodeRockActionId('off', 'r-2'))).toEqual({ kind: 'off', rockId: 'r-2' });
  });
  it('rejects other namespaces and kinds', () => {
    expect(parseRockActionId('ob:ack:x')).toBeNull();
    expect(parseRockActionId('rock:done:x')).toBeNull();
    expect(parseRockActionId('rock:on')).toBeNull();
  });
});

describe('buildRockCardBlocks', () => {
  it('renders a section + actions pair per rock with encoded buttons', () => {
    const { text, blocks } = buildRockCardBlocks(
      [
        { id: 'r-1', title: 'Launch owner portal', status: 'on', due_on: '2026-09-15' },
        { id: 'r-2', title: 'Hire leasing agent', status: 'off', due_on: null },
      ],
      '2026-Q3'
    );
    expect(text).toContain('2026-Q3');
    // intro + 2×(section+actions) + context footer
    expect(blocks).toHaveLength(6);
    const item = blocks[1] as { block_id: string; text: { text: string } };
    expect(item.block_id).toBe('rock-item:r-1');
    expect(item.text.text).toContain('due 2026-09-15');
    expect(item.text.text).toContain(rockStatusLabel('on'));
    const actions = blocks[2] as { elements: { action_id: string; style: string }[] };
    expect(actions.elements.map((e) => e.action_id)).toEqual(['rock:on:r-1', 'rock:off:r-1']);
    expect(actions.elements[1].style).toBe('danger');
  });
});

function seat(overrides: Partial<Seat>): Seat {
  return {
    id: 's-x',
    org_id: 'hdpm',
    name: 'X',
    roles: [],
    reports_to_seat_id: null,
    person: null,
    gwc_notes: null,
    active: true,
    sort: 0,
    ...overrides,
  };
}

describe('buildSeatTree', () => {
  it('builds roots and nested children ordered by sort', () => {
    const seats = [
      seat({ id: 'v', name: 'Visionary', sort: 0 }),
      seat({ id: 'i', name: 'Integrator', reports_to_seat_id: 'v', sort: 1 }),
      seat({ id: 'm', name: 'Sr PM', reports_to_seat_id: 'i', sort: 3 }),
      seat({ id: 'f', name: 'Finance', reports_to_seat_id: 'i', sort: 2 }),
      seat({ id: 'orphan', name: 'Orphan', reports_to_seat_id: 'missing', sort: 9 }),
    ];
    const tree = buildSeatTree(seats);
    expect(tree.map((n) => n.seat.id)).toEqual(['v', 'orphan']);
    expect(tree[0].children[0].seat.id).toBe('i');
    expect(tree[0].children[0].children.map((n) => n.seat.id)).toEqual(['f', 'm']);
  });
});

describe('SEAT_AGENTS', () => {
  it('attaches agents to seats, never the other way around', () => {
    expect(SEAT_AGENTS['Maintenance Coordinator']).toContain('Morning Card');
    expect(SEAT_AGENTS['Integrator']).toContain('Meeting Prep');
  });
});
