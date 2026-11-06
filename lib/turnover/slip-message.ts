/** The 7 AM unit turn list as Slack blocks, one row per unit, and the Done / Snooze action ids. Pure. */
import type { Slip, SlipKind } from './slips';

/** Units shown, not steps. */
export const SLIP_LIST_CAP = 15;
export const SLIP_SNOOZE_DAYS = 3;
/** Snooze key meaning every late step on the unit. */
export const SLIP_SNOOZE_ALL = 'all';
const TRACKER_URL = 'https://os.highdesertpm.com/turnover-tracker';
const CHASE_URL = 'https://os.highdesertpm.com/maintenance/estimate-followups';

/** In the order they appear on a row. */
const KIND_LABELS: Array<[SlipKind, string]> = [
  ['no_work_orders', 'No work orders yet'],
  ['keys', 'Keys not marked received'],
  ['inspection', 'Move-out inspection not marked done'],
  ['wo_vendor_date', 'Date passed'],
  ['wo_owner', 'No owner'],
  ['wo_date', 'No date'],
  ['ready', 'Not marked ready for showing'],
];

/** Done button and note wording, by slip key. */
export const SLIP_DONE_LABELS: Record<string, string> = {
  keys: 'Keys received',
  inspection: 'Inspection done',
  ready: 'Ready for showing',
};

const safe = (s: string) => s.replace(/[<>|&]/g, ' ');
const rowId = (turnId: string) => `ts:${turnId}`;
const shortDate = (date: string) => new Date(`${date}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

export function encodeSlipAction(kind: 'done' | 'snooze', s: Pick<Slip, 'turnId' | 'key'>): string {
  return `ts:${kind}:${s.turnId}:${s.key}`;
}

export function parseSlipAction(actionId: string): { kind: 'done' | 'snooze'; turnId: string; key: string } | null {
  const m = actionId.match(/^ts:(done|snooze):([0-9a-f-]{36}):(.+)$/i);
  return m ? { kind: m[1] as 'done' | 'snooze', turnId: m[2], key: m[3] } : null;
}

/** "Date passed: WO 1-2 (Oct 13) · No date: WO 1-3, WO 1-4" */
function stepsLine(steps: Slip[]): string {
  return KIND_LABELS.flatMap(([kind, label]) => {
    const ofKind = steps.filter((s) => s.kind === kind);
    if (ofKind.length === 0) return [];
    const wos = ofKind.filter((s) => s.woLabel).map((s) => (s.scheduled ? `${s.woLabel} (${shortDate(s.scheduled)})` : s.woLabel));
    return [wos.length ? `${label}: ${wos.join(', ')}` : label];
  }).join(' · ');
}

/** Slips sorted longest late first; each unit takes the place of its oldest step. */
export function buildSlipBlocks(slips: Slip[], opts: { preview: boolean; onChaseBoard?: number }): { text: string; blocks: unknown[] } {
  const byUnit = new Map<string, Slip[]>();
  for (const s of slips) byUnit.set(s.turnId, [...(byUnit.get(s.turnId) ?? []), s]);

  const count = `${plural(slips.length, 'late step')} on ${plural(byUnit.size, 'unit')}`;
  const tally = KIND_LABELS.flatMap(([kind, label]) => {
    const n = slips.filter((s) => s.kind === kind).length;
    return n ? [`${n} ${label.toLowerCase()}`] : [];
  }).join(' · ');
  const blocks: unknown[] = [
    { type: 'section', text: { type: 'mrkdwn', text: `*🔑 Unit turns: ${count}*\n${tally}${opts.preview ? '\n_Preview: only Craig gets this until it is turned on._' : ''}` } },
    { type: 'divider' },
  ];

  for (const [turnId, steps] of [...byUnit].slice(0, SLIP_LIST_CAP)) {
    const oldest = Math.max(...steps.map((s) => s.daysLate));
    const snooze = { type: 'button', action_id: encodeSlipAction('snooze', { turnId, key: SLIP_SNOOZE_ALL }), text: { type: 'plain_text', text: 'Snooze' } };
    const dones = steps
      .filter((s) => s.doneKey)
      .map((s) => ({ type: 'button', action_id: encodeSlipAction('done', s), style: 'primary', text: { type: 'plain_text', text: `✓ ${SLIP_DONE_LABELS[s.key] ?? 'Done'}` } }));
    blocks.push({
      type: 'section',
      block_id: rowId(turnId),
      text: { type: 'mrkdwn', text: `*<${TRACKER_URL}/${turnId}|${safe(steps[0].unit)}>* · ${plural(oldest, 'day')} late\n${safe(stepsLine(steps))}` },
      ...(dones.length ? {} : { accessory: snooze }),
    });
    if (dones.length) blocks.push({ type: 'actions', block_id: `${rowId(turnId)}:a`, elements: [...dones, snooze] });
  }

  const notes = [`Business days · Snooze hides a unit's late steps for ${SLIP_SNOOZE_DAYS} days`];
  if (byUnit.size > SLIP_LIST_CAP) notes.unshift(`+${plural(byUnit.size - SLIP_LIST_CAP, 'more unit')} in the <${TRACKER_URL}|tracker>`);
  if (opts.onChaseBoard) notes.push(`${plural(opts.onChaseBoard, 'turn work order')} waiting on estimates on the <${CHASE_URL}|Chase board>`);
  blocks.push({ type: 'context', elements: [{ type: 'mrkdwn', text: notes.join(' · ') }] });
  return { text: `Unit turns: ${count}`, blocks };
}

/** Marks a tap on a posted message: adds who did what, and removes the button or buttons it used up. */
export function markSlipHandled(blocks: Array<Record<string, unknown>>, action: { kind: 'done' | 'snooze'; turnId: string; key: string }, note: string): Array<Record<string, unknown>> {
  const id = rowId(action.turnId);
  return blocks
    .filter((b) => !(action.kind === 'snooze' && b.block_id === `${id}:a`))
    .map((b) => {
      if (b.block_id === `${id}:a`) {
        return { ...b, elements: (b.elements as Array<{ action_id?: string }>).filter((e) => e.action_id !== encodeSlipAction('done', action)) };
      }
      if (b.block_id !== id) return b;
      const text = b.text as { type: string; text: string };
      const row: Record<string, unknown> = { ...b, text: { ...text, text: `${text.text}\n${safe(note)}` } };
      if (action.kind === 'snooze') delete row.accessory;
      return row;
    });
}
