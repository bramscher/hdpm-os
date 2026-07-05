'use client';

/**
 * Triage Review — batch AI triage for the backlog (Session B).
 * Generate proposals → review ranked list (P1 first, then age) → Apply /
 * edit / Skip per row, or bulk-apply everything untouched. Nothing changes
 * a work order until Cheryl acts.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type { MaintWorkOrder, TriageProposal } from '@/lib/maintenance/types';
import { PEOPLE, PRIORITY_CLASSES } from '@/lib/maintenance/types';
import { daysSince, woCreatedAt, woWhere } from '../board-types';

interface Row {
  proposal: TriageProposal;
  workOrder: MaintWorkOrder;
}

interface Edits {
  priority_class?: string;
  next_action_date?: string;
  owner_name?: string;
}

const PRIORITY_RANK: Record<string, number> = { P1: 0, P2: 1, P3: 2, P4: 3 };

export default function TriageReview({ onChanged }: { onChanged?: () => void }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [counts, setCounts] = useState({ pending: 0, applied: 0, skipped: 0 });
  const [edits, setEdits] = useState<Record<string, Edits>>({});
  const [busy, setBusy] = useState<string | null>(null); // woId or 'batch'/'bulk'
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fullPool, setFullPool] = useState(false);
  const stopRef = useRef(false);

  const load = useCallback(async () => {
    const [listRes, countRes] = await Promise.all([
      fetch('/api/maintenance/triage-proposals'),
      fetch('/api/maintenance/triage-batch'),
    ]);
    if (listRes.ok) {
      const { rows } = await listRes.json();
      rows.sort((a: Row, b: Row) => {
        const pa = PRIORITY_RANK[a.proposal.proposed_priority_class ?? 'P4'];
        const pb = PRIORITY_RANK[b.proposal.proposed_priority_class ?? 'P4'];
        if (pa !== pb) return pa - pb;
        return woCreatedAt(a.workOrder).localeCompare(woCreatedAt(b.workOrder));
      });
      setRows(rows);
    }
    if (countRes.ok) setCounts(await countRes.json());
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // ── Generate: loop the resumable batch endpoint until done ──
  async function generate() {
    setBusy('batch');
    setError(null);
    stopRef.current = false;
    const stages = fullPool ? ['NEW', 'TRIAGED', 'SCHEDULED', 'WAITING_ON'] : ['NEW', 'TRIAGED'];
    try {
      let total = 0;
      for (let i = 0; i < 60 && !stopRef.current; i++) {
        const res = await fetch('/api/maintenance/triage-batch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ stages }),
        });
        const body = await res.json();
        if (!res.ok) {
          setError(body.error || `Batch failed (${res.status})`);
          break;
        }
        total += body.processed;
        setProgress(`${total} proposals generated · ${body.remaining} to go${body.errors.length ? ` · ${body.errors.length} errors` : ''}`);
        await load();
        if (body.remaining === 0 || body.processed === 0) break;
      }
      setProgress((p) => (p ? p + ' — done' : null));
    } finally {
      setBusy(null);
    }
  }

  async function act(workOrderId: string, action: 'apply' | 'skip') {
    setBusy(workOrderId);
    setError(null);
    try {
      const res = await fetch('/api/maintenance/triage-proposals/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workOrderId, action, overrides: edits[workOrderId] }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.errors?.join('; ') || body.error || `Failed (${res.status})`);
        return;
      }
      setRows((r) => r.filter((row) => row.workOrder.id !== workOrderId));
      setCounts((c) => ({
        ...c,
        pending: c.pending - 1,
        [action === 'apply' ? 'applied' : 'skipped']:
          c[action === 'apply' ? 'applied' : 'skipped'] + 1,
      }));
      onChanged?.();
    } finally {
      setBusy(null);
    }
  }

  async function bulkApply() {
    // Edited rows are excluded — apply those individually so edits stick.
    const editedIds = new Set(Object.keys(edits));
    const untouched = rows.filter((r) => !editedIds.has(r.workOrder.id));
    if (untouched.length === 0) return;
    if (!window.confirm(`Apply ${untouched.length} untouched proposals? (${editedIds.size} edited rows stay for individual review)`)) return;

    setBusy('bulk');
    setError(null);
    try {
      // Bulk endpoint applies all pending; first pull edited rows out of 'pending' scope
      // by applying them... no — simplest correct path: apply untouched ones one-by-one
      // server-side via bulk=true only when nothing is edited, else loop client-side.
      if (editedIds.size === 0) {
        const res = await fetch('/api/maintenance/triage-proposals/apply', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ bulk: true }),
        });
        const body = await res.json();
        if (!res.ok) {
          setError(body.error || `Bulk failed (${res.status})`);
          return;
        }
        if (body.failures?.length) {
          setError(`${body.failures.length} rows failed validation — they remain pending`);
        }
      } else {
        for (const row of untouched) {
          await fetch('/api/maintenance/triage-proposals/apply', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ workOrderId: row.workOrder.id, action: 'apply' }),
          });
        }
      }
      await load();
      onChanged?.();
    } finally {
      setBusy(null);
    }
  }

  const edit = (woId: string, field: keyof Edits, value: string) =>
    setEdits((e) => ({ ...e, [woId]: { ...e[woId], [field]: value } }));

  return (
    <section>
      <div className="mo-panel" style={{ marginBottom: 14 }}>
        <h2>✦ Batch AI triage</h2>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', fontSize: 13 }}>
          <button className="mo-btn" disabled={busy === 'batch'} onClick={generate}>
            {busy === 'batch' ? 'Generating…' : 'Generate proposals'}
          </button>
          {busy === 'batch' && (
            <button className="mo-btn secondary" onClick={() => (stopRef.current = true)}>
              Pause
            </button>
          )}
          <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input type="checkbox" checked={fullPool} onChange={(e) => setFullPool(e.target.checked)} />
            Include SCHEDULED + WAITING ON (full re-date sweep)
          </label>
          <span style={{ color: 'var(--muted)' }}>
            {counts.pending} pending · {counts.applied} applied · {counts.skipped} skipped
          </span>
          {rows.length > 0 && (
            <button className="mo-btn" disabled={busy !== null} onClick={bulkApply}>
              Apply all untouched ({rows.length - Object.keys(edits).length})
            </button>
          )}
        </div>
        {progress && <p className="note" style={{ marginTop: 8 }}>{progress}</p>}
        {error && <p className="note flag">{error}</p>}
        <p className="note">
          Proposals only — nothing changes until you Apply. Applies are logged to each work
          order&apos;s timeline under your name, exactly like manual triage. Rows you edit are
          excluded from bulk-apply.
        </p>
      </div>

      {rows.map(({ proposal, workOrder: wo }) => {
        const triage = proposal.triage as { summary?: string; next_action?: string; risk_flags?: string[] };
        const e = edits[wo.id] ?? {};
        const age = daysSince(woCreatedAt(wo)) ?? 0;
        return (
          <div key={wo.id} className="mo-panel" style={{ marginBottom: 10 }}>
            <div style={{ display: 'flex', gap: 10, alignItems: 'baseline', flexWrap: 'wrap' }}>
              <b className={proposal.proposed_priority_class === 'P1' ? 'flag' : ''}>
                {e.priority_class ?? proposal.proposed_priority_class}
              </b>
              <Link href={`/maintenance/board/wo/${wo.id}`} style={{ fontWeight: 700 }}>
                {wo.description.slice(0, 80)} — {woWhere(wo)}
              </Link>
              <span style={{ color: 'var(--muted)', fontSize: 12 }}>
                {wo.appfolio_status} · {age}d old · stage {wo.stage}
              </span>
            </div>
            <p style={{ fontSize: 13, margin: '6px 0' }}>{triage.summary}</p>
            {triage.risk_flags && triage.risk_flags.length > 0 && (
              <p className="flag" style={{ fontSize: 12, fontWeight: 400 }}>⚠ {triage.risk_flags.join(' · ')}</p>
            )}
            <p style={{ fontSize: 13, margin: '4px 0' }}>
              <b>Next:</b> {triage.next_action}
            </p>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 6 }}>
              <select
                className="mo-input" style={{ width: 70 }}
                value={e.priority_class ?? proposal.proposed_priority_class ?? 'P3'}
                onChange={(ev) => edit(wo.id, 'priority_class', ev.target.value)}
              >
                {PRIORITY_CLASSES.map((p) => <option key={p}>{p}</option>)}
              </select>
              <input
                type="date" className="mo-input" style={{ width: 150 }}
                value={e.next_action_date ?? proposal.proposed_next_action_date ?? ''}
                onChange={(ev) => edit(wo.id, 'next_action_date', ev.target.value)}
              />
              <select
                className="mo-input" style={{ width: 110 }}
                value={e.owner_name ?? proposal.proposed_owner_name ?? 'Cheryl'}
                onChange={(ev) => edit(wo.id, 'owner_name', ev.target.value)}
              >
                {PEOPLE.map((p) => <option key={p}>{p}</option>)}
              </select>
              {proposal.proposed_stage && (
                <span style={{ fontSize: 12, color: 'var(--muted)' }}>→ {proposal.proposed_stage}</span>
              )}
              <button className="mo-btn" disabled={busy !== null} onClick={() => act(wo.id, 'apply')}>
                {busy === wo.id ? '…' : edits[wo.id] ? 'Apply (edited)' : 'Apply'}
              </button>
              <button className="mo-btn secondary" disabled={busy !== null} onClick={() => act(wo.id, 'skip')}>
                Skip
              </button>
            </div>
          </div>
        );
      })}

      {rows.length === 0 && (
        <p className="note">
          No pending proposals. Hit &quot;Generate proposals&quot; to run the AI across the
          backlog (≈4–6s and ~4¢ per work order).
        </p>
      )}
    </section>
  );
}
