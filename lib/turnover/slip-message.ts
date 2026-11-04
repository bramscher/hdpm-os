/** The 7 AM unit turn list as Slack blocks, and the Done / Snooze action ids. Pure. */
import type { Slip } from './slips';

export const SLIP_LIST_CAP = 15;
export const SLIP_SNOOZE_DAYS = 3;
const TRACKER_URL = 'https://os.highdesertpm.com/turnover-tracker';
const CHASE_URL = 'https://os.highdesertpm.com/maintenance/estimate-followups';

const safe = (s: string) => s.replace(/[<>|&]/g, ' ');
const blockId = (s: Pick<Slip, 'turnId' | 'key'>) => `ts:${s.turnId}:${s.key}`;

export function encodeSlipAction(kind: 'done' | 'snooze', s: Pick<Slip, 'turnId' | 'key'>): string {
  return `ts:${kind}:${s.turnId}:${s.key}`;
}

export function parseSlipAction(actionId: string): { kind: 'done' | 'snooze'; turnId: string; key: string } | null {
  const m = actionId.match(/^ts:(done|snooze):([0-9a-f-]{36}):(.+)$/i);
  return m ? { kind: m[1] as 'done' | 'snooze', turnId: m[2], key: m[3] } : null;
}

export function buildSlipBlocks(slips: Slip[], opts: { preview: boolean; onChaseBoard?: number }): { text: string; blocks: unknown[] } {
  const count = `${slips.length} late turn step${slips.length === 1 ? '' : 's'}`;
  const blocks: unknown[] = [
    { type: 'section', text: { type: 'mrkdwn', text: `*🔑 Unit turns: ${count}*${opts.preview ? '\n_Preview: only Craig gets this until it is turned on._' : ''}` } },
  ];
  for (const s of slips.slice(0, SLIP_LIST_CAP)) {
    blocks.push({
      type: 'section',
      block_id: blockId(s),
      text: { type: 'mrkdwn', text: `*<${TRACKER_URL}/${s.turnId}|${safe(s.unit)}>*\n${safe(s.text)} · ${s.daysLate} business day${s.daysLate === 1 ? '' : 's'} late` },
    });
    const elements: unknown[] = [];
    if (s.doneKey) elements.push({ type: 'button', action_id: encodeSlipAction('done', s), text: { type: 'plain_text', text: '✓ Done' }, style: 'primary' });
    elements.push({ type: 'button', action_id: encodeSlipAction('snooze', s), text: { type: 'plain_text', text: `Snooze ${SLIP_SNOOZE_DAYS} days` } });
    blocks.push({ type: 'actions', block_id: `${blockId(s)}:a`, elements });
  }
  const links: string[] = [];
  if (slips.length > SLIP_LIST_CAP) links.push(`+${slips.length - SLIP_LIST_CAP} more in the <${TRACKER_URL}|tracker>`);
  if (opts.onChaseBoard) links.push(`${opts.onChaseBoard} turn work order${opts.onChaseBoard === 1 ? '' : 's'} waiting on estimates on the <${CHASE_URL}|Chase board>`);
  if (links.length) blocks.push({ type: 'context', elements: [{ type: 'mrkdwn', text: links.join(' · ') }] });
  return { text: `Unit turns: ${count}`, blocks };
}

/** Marks one slip handled in a posted message: drops its buttons and adds who did what. */
export function markSlipHandled(blocks: Array<Record<string, unknown>>, s: { turnId: string; key: string }, note: string): Array<Record<string, unknown>> {
  const id = blockId(s);
  return blocks
    .filter((b) => b.block_id !== `${id}:a`)
    .map((b) => {
      if (b.block_id !== id) return b;
      const text = b.text as { type: string; text: string };
      return { ...b, text: { ...text, text: `${text.text}\n${safe(note)}` } };
    });
}
