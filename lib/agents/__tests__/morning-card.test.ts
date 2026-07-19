import { describe, it, expect } from 'vitest';
import type { TripwireException } from '@/lib/maintenance/types';
import {
  SEVERITY_TIERS,
  severityRank,
  rankExceptions,
  pickDailySeven,
  todayPacific,
  snoozeDate,
  isValidYmd,
  encodeActionId,
  parseActionId,
  parseBlockAction,
  buildCardBlocks,
  buildNudge,
  buildCardEmailHtml,
  type CardItem,
  type CardHeader,
} from '../morning-card';
import { splitSlackMessageId } from '../channels/slack';

function ex(overrides: Partial<TripwireException> = {}): TripwireException {
  return {
    tripwire: 3,
    label: '#3 Past-due next action',
    item: 'Fridge not cooling — Brosterhous #4',
    fixRequired: 'Act or log a new next-action date today',
    owner: 'Cheryl',
    workOrderId: `wo-${Math.abs(overrides.tripwire ?? 3)}-${overrides.ageDays ?? 0}`,
    ageDays: 5,
    ...overrides,
  };
}

function cardItem(overrides: Partial<CardItem> = {}): CardItem {
  return {
    proposalId: 'p-1',
    workOrderId: 'wo-1',
    rank: 1,
    tripwire: 3,
    label: '#3 Past-due next action',
    item: 'Fridge not cooling',
    fixRequired: 'Act today',
    ageDays: 5,
    status: 'proposed',
    nextActionDate: '2026-07-21',
    ...overrides,
  };
}

const header: CardHeader = {
  dateStr: '2026-07-20',
  totalExceptions: 23,
  needsDateCount: 5,
  pendingTriage: 4,
  routeSummary: '2 routes · 9 stops (Alberto)',
};

// ── ranking ──

describe('severityRank / rankExceptions', () => {
  it('orders by the tier list, not tripwire number', () => {
    const ranked = rankExceptions([
      ex({ tripwire: 3, workOrderId: 'a' }),
      ex({ tripwire: 5, workOrderId: 'b' }),
      ex({ tripwire: 11, workOrderId: 'c' }),
    ]);
    expect(ranked.map((e) => e.tripwire)).toEqual([5, 3, 11]);
  });

  it('breaks ties by ageDays desc; missing ageDays sorts last within tier', () => {
    const ranked = rankExceptions([
      ex({ workOrderId: 'young', ageDays: 2 }),
      ex({ workOrderId: 'old', ageDays: 40 }),
      ex({ workOrderId: 'unknown', ageDays: undefined }),
    ]);
    expect(ranked.map((e) => e.workOrderId)).toEqual(['old', 'young', 'unknown']);
  });

  it('filters out non-Cheryl owners and items without a workOrderId', () => {
    const ranked = rankExceptions([
      ex({ owner: 'Alberto', workOrderId: 'x' }),
      ex({ workOrderId: undefined }),
      ex({ workOrderId: 'keep' }),
    ]);
    expect(ranked.map((e) => e.workOrderId)).toEqual(['keep']);
  });

  it('dedupes per work order, keeping the more severe exception', () => {
    const ranked = rankExceptions([
      ex({ tripwire: 11, workOrderId: 'same' }),
      ex({ tripwire: 5, workOrderId: 'same' }),
    ]);
    expect(ranked).toHaveLength(1);
    expect(ranked[0].tripwire).toBe(5);
  });

  it('unknown tripwire numbers sort last', () => {
    expect(severityRank(ex({ tripwire: 99 as never }))).toBe(SEVERITY_TIERS.length);
  });
});

describe('pickDailySeven', () => {
  it('caps at 7', () => {
    const many = Array.from({ length: 12 }, (_, i) => ex({ workOrderId: `wo-${i}`, ageDays: i }));
    expect(pickDailySeven(many)).toHaveLength(7);
  });

  it('returns fewer when fewer exist, empty for empty', () => {
    expect(pickDailySeven([ex()])).toHaveLength(1);
    expect(pickDailySeven([])).toHaveLength(0);
  });
});

// ── dates ──

describe('todayPacific', () => {
  it('handles the Pacific midnight boundary', () => {
    // 06:00 UTC on Jul 20 is 23:00 PDT on Jul 19.
    expect(todayPacific(new Date('2026-07-20T06:00:00Z'))).toBe('2026-07-19');
    expect(todayPacific(new Date('2026-07-20T18:00:00Z'))).toBe('2026-07-20');
  });
});

describe('snoozeDate', () => {
  it('Thu → Mon, Fri → Tue (2 business days, strict-after)', () => {
    expect(snoozeDate(new Date('2026-07-16T15:00:00Z'))).toBe('2026-07-20'); // Thu → Mon
    expect(snoozeDate(new Date('2026-07-17T15:00:00Z'))).toBe('2026-07-21'); // Fri → Tue
  });

  it('weekend now lands on Tue/Wed', () => {
    expect(snoozeDate(new Date('2026-07-18T15:00:00Z'))).toBe('2026-07-21'); // Sat → Tue
  });
});

describe('isValidYmd', () => {
  it('accepts YYYY-MM-DD only', () => {
    expect(isValidYmd('2026-07-21')).toBe(true);
    expect(isValidYmd('')).toBe(false);
    expect(isValidYmd('7/21/2026')).toBe(false);
    expect(isValidYmd(null)).toBe(false);
  });
});

// ── action ids ──

describe('encodeActionId / parseActionId / parseBlockAction', () => {
  it('round-trips all kinds', () => {
    for (const kind of ['done', 'snooze', 'date', 'reassign'] as const) {
      expect(parseActionId(encodeActionId(kind, 'pid-1'))).toEqual({ kind, proposalId: 'pid-1' });
    }
  });

  it('rejects garbage', () => {
    expect(parseActionId('mc:explode:x')).toBeNull();
    expect(parseActionId('other:done:x')).toBeNull();
    expect(parseActionId('mc:done:')).toBeNull();
  });

  it('parses button value, select option, and datepicker date', () => {
    expect(parseBlockAction({ action_id: 'mc:done:p1', value: 'wo-1' })).toEqual({
      kind: 'done',
      proposalId: 'p1',
      selectedValue: undefined,
      selectedDate: undefined,
    });
    expect(
      parseBlockAction({ action_id: 'mc:snooze:p1', selected_option: { value: 'vendor' } })
    ).toMatchObject({ kind: 'snooze', selectedValue: 'vendor' });
    expect(
      parseBlockAction({ action_id: 'mc:date:p1', selected_date: '2026-07-22' })
    ).toMatchObject({ kind: 'date', selectedDate: '2026-07-22' });
    expect(parseBlockAction({ nonsense: true })).toBeNull();
    expect(parseBlockAction(null)).toBeNull();
  });
});

// ── card blocks ──

type Block = { type: string; elements?: { action_id?: string }[]; text?: { text?: string } };

describe('buildCardBlocks', () => {
  const seven = Array.from({ length: 7 }, (_, i) =>
    cardItem({ proposalId: `p-${i}`, workOrderId: `wo-${i}`, rank: i + 1 })
  );

  it('interactive card: 7 section+actions pairs with 4 correctly-wired elements each', () => {
    const blocks = buildCardBlocks({ header, items: seven, readOnly: false }) as Block[];
    const actions = blocks.filter((b) => b.type === 'actions');
    expect(actions).toHaveLength(7);
    for (const [i, a] of actions.entries()) {
      expect(a.elements).toHaveLength(4);
      const ids = a.elements!.map((e) => e.action_id);
      expect(ids).toEqual([
        `mc:done:p-${i}`,
        `mc:snooze:p-${i}`,
        `mc:date:p-${i}`,
        `mc:reassign:p-${i}`,
      ]);
    }
    expect(blocks.length).toBeLessThan(50);
  });

  it('readOnly card has zero actions blocks', () => {
    const blocks = buildCardBlocks({ header, items: seven, readOnly: true }) as Block[];
    expect(blocks.filter((b) => b.type === 'actions')).toHaveLength(0);
    expect(JSON.stringify(blocks)).toContain('Read-only copy');
  });

  it('approved item renders struck through with resolution and no actions block', () => {
    const items = [cardItem({ status: 'approved', resolution: 'Done by Cheryl 9:14 AM' })];
    const blocks = buildCardBlocks({ header, items, readOnly: false }) as Block[];
    expect(blocks.filter((b) => b.type === 'actions')).toHaveLength(0);
    const section = blocks.find((b) => b.type === 'section')!;
    expect(section.text!.text).toContain('~');
    expect(section.text!.text).toContain('Done by Cheryl');
  });

  it('errored item keeps its actions and shows the warning', () => {
    const items = [cardItem({ error: 'Set an owner first' })];
    const blocks = buildCardBlocks({ header, items, readOnly: false }) as Block[];
    expect(blocks.filter((b) => b.type === 'actions')).toHaveLength(1);
    expect(JSON.stringify(blocks)).toContain(':warning:');
  });

  it('invalid nextActionDate omits initial_date', () => {
    const items = [cardItem({ nextActionDate: 'not-a-date' })];
    const blocks = buildCardBlocks({ header, items, readOnly: false });
    expect(JSON.stringify(blocks)).not.toContain('initial_date');
  });

  it('zero-items renders the clean-board card', () => {
    const blocks = buildCardBlocks({ header, items: [], readOnly: false });
    expect(JSON.stringify(blocks)).toContain('Zero exceptions');
  });
});

describe('buildNudge', () => {
  it('mentions the count and has no actions', () => {
    const { text, blocks } = buildNudge([cardItem(), cardItem()], header);
    expect(text).toContain('2');
    expect(JSON.stringify(blocks)).not.toContain('"actions"');
  });
});

describe('buildCardEmailHtml', () => {
  it('escapes HTML, includes the Slack banner and date', () => {
    const { subject, html, text } = buildCardEmailHtml(
      header,
      [cardItem({ item: 'Broken <window> & frame' })],
      'https://app.example.com'
    );
    expect(subject).toContain('2026-07-20');
    expect(html).toContain('Broken &lt;window&gt; &amp; frame');
    expect(html).toContain('Act from your Slack DM');
    expect(text).toContain('Slack DM');
  });
});

describe('splitSlackMessageId', () => {
  it('splits channel and ts on the first colon', () => {
    expect(splitSlackMessageId('D01ABC:1721400000.123456')).toEqual({
      channel: 'D01ABC',
      ts: '1721400000.123456',
    });
    expect(splitSlackMessageId('nocolon')).toBeNull();
    expect(splitSlackMessageId(':leading')).toBeNull();
    expect(splitSlackMessageId('trailing:')).toBeNull();
  });
});
