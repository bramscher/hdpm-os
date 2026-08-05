/**
 * Rocks — pure logic (Phase 2, Brief 2E — doc 06 §6). Quarter math, the
 * rock:* Slack action namespace, and the Friday self-report card blocks.
 * DB-free; orchestration lives in rock-run.ts and the interact route.
 */

import type { Rock } from './types';

export const ROCK_STATUSES = ['on', 'off', 'done', 'dropped'] as const;

/** '2026-Q3' for the quarter containing `d`, in Pacific time. */
export function currentQuarter(d: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const q = Math.floor((Number(get('month')) - 1) / 3) + 1;
  return `${get('year')}-Q${q}`;
}

// ── rock:* Slack action namespace (one-tap Friday self-report) ──────────
// Value carries the rock id directly — no proposal row involved.

export type RockActionKind = 'on' | 'off';

export interface RockAction {
  kind: RockActionKind;
  rockId: string;
}

export function encodeRockActionId(kind: RockActionKind, rockId: string): string {
  return `rock:${kind}:${rockId}`;
}

export function parseRockActionId(actionId: string): RockAction | null {
  const m = actionId.match(/^rock:(on|off):(.+)$/);
  if (!m) return null;
  return { kind: m[1] as RockActionKind, rockId: m[2] };
}

// ── Friday card blocks ──────────────────────────────────────────────────

const STATUS_LABEL: Record<Rock['status'], string> = {
  on: '🟢 on track',
  off: '🔴 off track',
  done: '✅ done',
  dropped: '⚪ dropped',
};

export function rockStatusLabel(status: Rock['status']): string {
  return STATUS_LABEL[status];
}

/**
 * One consolidated card per owner: a section per rock with its current
 * status, then an actions row with the two one-tap buttons. Rebuilt from
 * fresh rows after every tap (morning-card strategy).
 */
export function buildRockCardBlocks(
  rocks: Pick<Rock, 'id' | 'title' | 'status' | 'due_on'>[],
  quarter: string
): { text: string; blocks: unknown[] } {
  const blocks: unknown[] = [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `🪨 *Friday Rock check — ${quarter}*\nOne tap each: are your Rocks on track?`,
      },
    },
  ];
  for (const r of rocks) {
    blocks.push({
      type: 'section',
      block_id: `rock-item:${r.id}`,
      text: {
        type: 'mrkdwn',
        text: `*${r.title}*${r.due_on ? ` · due ${r.due_on}` : ''} — ${STATUS_LABEL[r.status]}`,
      },
    });
    blocks.push({
      type: 'actions',
      block_id: `rock-actions:${r.id}`,
      elements: [
        {
          type: 'button',
          action_id: encodeRockActionId('on', r.id),
          text: { type: 'plain_text', text: 'On track' },
          style: 'primary',
          value: r.id,
        },
        {
          type: 'button',
          action_id: encodeRockActionId('off', r.id),
          text: { type: 'plain_text', text: 'Off track' },
          style: 'danger',
          value: r.id,
        },
      ],
    });
  }
  blocks.push({
    type: 'context',
    elements: [
      {
        type: 'mrkdwn',
        text: 'Off-track Rocks get discussed in the weekly meeting — no bot follow-up.',
      },
    ],
  });
  return { text: `Friday Rock check — ${quarter} (${rocks.length} rocks)`, blocks };
}
