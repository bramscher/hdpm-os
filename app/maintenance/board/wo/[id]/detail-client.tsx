'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import type {
  ClosureGateResult,
  MaintWorkOrder,
  WaitingReason,
  WoEvent,
} from '@/lib/maintenance/types';
import { PEOPLE, PRIORITY_CLASSES, WAITING_REASONS } from '@/lib/maintenance/types';
import { ALLOWED_TRANSITIONS, CLOSURE_CONDITION_LABELS } from '@/lib/maintenance/workflow';
import type { Stage } from '@/lib/maintenance/types';
import { fmtDate, woWhere } from '../../board-types';
import { WaitBadge } from '../../components/shared';

interface DetailPayload {
  workOrder: MaintWorkOrder;
  events: WoEvent[];
  assignments: { id: string; vendor: { name: string } | null; sent_at: string; accepted_at: string | null; declined_at: string | null; completed_at: string | null; callback: boolean }[];
  approvals: { id: string; kind: string; requested_of: string; requested_at: string; decided_at: string | null; decision: string | null }[];
  recommendations: { id: string; tech: string; body: string; created_at: string; resolved_wo_id: string | null; dismissed_reason: string | null }[];
  turn: { vacated_at: string; target_ready: string | null; current_blocker: string | null; budget: number | null; actual: number | null } | null;
  closureGate: ClosureGateResult;
  docs: { photoCount: number; hasTime: boolean; hasMaterials: boolean };
}

export default function DetailClient({ workOrderId }: { workOrderId: string }) {
  const [data, setData] = useState<DetailPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [blockErrors, setBlockErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState('');
  const [noteType, setNoteType] = useState<'note' | 'photo' | 'scope_change'>('note');
  const [failedAccessNote, setFailedAccessNote] = useState('');
  const [failedAccessDate, setFailedAccessDate] = useState('');

  const load = useCallback(async () => {
    setError(null);
    const res = await fetch(`/api/maintenance/work-orders/${workOrderId}`);
    if (!res.ok) {
      setError(`Failed to load work order (${res.status})`);
      return;
    }
    setData(await res.json());
  }, [workOrderId]);

  useEffect(() => {
    load();
  }, [load]);

  async function patch(fields: Record<string, unknown>) {
    setSaving(true);
    setBlockErrors([]);
    try {
      const res = await fetch(`/api/maintenance/work-orders/${workOrderId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(fields),
      });
      if (res.status === 422) {
        const body = await res.json();
        setBlockErrors(body.errors ?? [body.error]);
        return;
      }
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setBlockErrors([body.error || `Update failed (${res.status})`]);
        return;
      }
      await load();
    } finally {
      setSaving(false);
    }
  }

  async function postEvent(eventType: string, payload: Record<string, unknown>) {
    setSaving(true);
    setBlockErrors([]);
    try {
      const res = await fetch(`/api/maintenance/work-orders/${workOrderId}/events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event_type: eventType, payload }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setBlockErrors(body.errors ?? [body.error || `Event failed (${res.status})`]);
        return;
      }
      await load();
    } finally {
      setSaving(false);
    }
  }

  if (error) {
    return (
      <div className="maint-os p-6">
        <p className="note flag">{error}</p>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="maint-os p-6">
        <p className="note">Loading…</p>
      </div>
    );
  }

  const { workOrder: wo, closureGate, docs } = data;
  const stageOptions: Stage[] = [wo.stage, ...(ALLOWED_TRANSITIONS[wo.stage] ?? [])];

  return (
    <div className="maint-os p-6 max-w-[1100px]">
      <header className="mo-header">
        <h1>
          {wo.wo_number ? `${wo.wo_number} — ` : ''}
          {woWhere(wo)}
        </h1>
        <span className="sub">
          AppFolio: {wo.appfolio_status || wo.status} · synced {new Date(wo.synced_at).toLocaleString()}
        </span>
        {wo.appfolio_link && (
          <a
            href={wo.appfolio_link}
            target="_blank"
            rel="noopener noreferrer"
            className="mo-btn"
            style={{ textDecoration: 'none' }}
          >
            Open in AppFolio ↗
          </a>
        )}
        <Link href="/maintenance/board" className="badge">
          ← Back to board
        </Link>
      </header>

      <p className="note" style={{ marginTop: 0 }}>
        AppFolio is the system of record: status, scheduling, and vendor assignment are edited{' '}
        <b>there</b> — this board follows within 15 minutes. This page owns what AppFolio
        can&apos;t track: the accountable owner, next-action date, priority class, and the
        closure gate.
      </p>

      <p style={{ fontSize: 14, marginBottom: 14 }}>{wo.description}</p>

      {blockErrors.length > 0 && (
        <div className="mo-panel" style={{ borderColor: 'var(--red)', marginBottom: 14 }}>
          <h2 className="flag">Blocked</h2>
          <ul style={{ fontSize: 13, listStyle: 'disc', paddingLeft: 18 }}>
            {blockErrors.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        {/* ── Workflow controls ── */}
        <div className="mo-panel">
          <h2>Workflow</h2>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <label>
              <span className="mo-field-label">Stage</span>
              <select
                className="mo-input"
                value={wo.stage}
                disabled={saving}
                onChange={(e) => {
                  const stage = e.target.value as Stage;
                  if (stage === 'WAITING_ON') {
                    const reason = window.prompt(
                      `Waiting on what? (${WAITING_REASONS.join(', ')})`
                    );
                    if (!reason) return;
                    patch({ stage, waiting_reason: reason.toUpperCase() });
                  } else {
                    patch({ stage });
                  }
                }}
              >
                {stageOptions.map((s) => (
                  <option key={s} value={s}>
                    {s.replace('_', ' ')}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className="mo-field-label">Owner (ONE person)</span>
              <select
                className="mo-input"
                value={wo.owner_name || ''}
                disabled={saving}
                onChange={(e) => patch({ owner_name: e.target.value })}
              >
                {PEOPLE.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className="mo-field-label">Next action date</span>
              <input
                type="date"
                className="mo-input"
                value={wo.next_action_date ?? ''}
                disabled={saving}
                onChange={(e) => e.target.value && patch({ next_action_date: e.target.value })}
              />
            </label>
            <label>
              <span className="mo-field-label">Priority</span>
              <select
                className="mo-input"
                value={wo.priority_class ?? ''}
                disabled={saving}
                onChange={(e) => e.target.value && patch({ priority_class: e.target.value })}
              >
                <option value="">— set P1–P4 —</option>
                {PRIORITY_CLASSES.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className="mo-field-label">Assigned tech</span>
              <select
                className="mo-input"
                value={wo.assigned_tech ?? ''}
                disabled={saving}
                onChange={(e) => patch({ assigned_tech: e.target.value || null })}
              >
                <option value="">— none (vendor job) —</option>
                <option value="Alberto">Alberto</option>
                <option value="Brody">Brody</option>
              </select>
            </label>
            {wo.stage === 'WAITING_ON' && (
              <label>
                <span className="mo-field-label">Waiting on</span>
                <select
                  className="mo-input"
                  value={wo.waiting_reason ?? ''}
                  disabled={saving}
                  onChange={(e) =>
                    e.target.value && patch({ waiting_reason: e.target.value as WaitingReason })
                  }
                >
                  {WAITING_REASONS.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>

          <label style={{ display: 'block', marginTop: 10 }}>
            <span className="mo-field-label">Why it&apos;s old / written plan (Aging + Waiting-On views)</span>
            <textarea
              className="mo-input"
              rows={2}
              defaultValue={wo.aging_reason ?? ''}
              disabled={saving}
              onBlur={(e) => {
                if (e.target.value !== (wo.aging_reason ?? '')) {
                  patch({ aging_reason: e.target.value || null });
                }
              }}
            />
          </label>

          <div style={{ display: 'flex', gap: 12, marginTop: 10, flexWrap: 'wrap', fontSize: 13 }}>
            <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input
                type="checkbox"
                checked={wo.tenant_ping_sent}
                disabled={saving || wo.tenant_ping_sent}
                onChange={() => postEvent('tenant_ping', {})}
              />
              Tenant confirmation ping sent
            </label>
            <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input
                type="checkbox"
                checked={wo.is_turn}
                disabled={saving}
                onChange={(e) => patch({ is_turn: e.target.checked })}
              />
              This is a turn
            </label>
            <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              Preventive follow-up:
              <select
                className="mo-input"
                style={{ width: 'auto' }}
                value={wo.preventive_scheduled === null ? 'na' : wo.preventive_scheduled ? 'yes' : 'no'}
                disabled={saving}
                onChange={(e) =>
                  patch({
                    preventive_scheduled: e.target.value === 'na' ? null : e.target.value === 'yes',
                  })
                }
              >
                <option value="na">N/A</option>
                <option value="no">Needed — not scheduled</option>
                <option value="yes">Scheduled</option>
              </select>
            </label>
          </div>
        </div>

        {/* ── Closure gate ── */}
        <div className="mo-panel">
          <h2>
            Closure gate{' '}
            {closureGate.passed ? (
              <span className="ok">all six conditions met</span>
            ) : (
              <span className="flag">{closureGate.failures.length} condition(s) open</span>
            )}
          </h2>
          {([1, 2, 3, 4, 5, 6] as const).map((n) => {
            const failed = closureGate.failures.some((f) => f.condition === n);
            return (
              <div key={n} className={`gate-item ${failed ? 'fail' : 'pass'}`}>
                <span className="mark">{failed ? '✗' : '✓'}</span>
                <span>{CLOSURE_CONDITION_LABELS[n]}</span>
              </div>
            );
          })}
          <p className="note">
            Docs: {docs.photoCount} photo(s) · time {docs.hasTime ? '✓' : '✗'} · materials{' '}
            {docs.hasMaterials ? '✓' : '✗'} (photos = timeline photo events; time/materials = linked
            invoice line items)
          </p>
          {wo.stage === 'BILL' && (
            <button
              className="mo-btn"
              disabled={saving || !closureGate.passed}
              onClick={() => patch({ stage: 'CLOSED' })}
            >
              Close work order
            </button>
          )}
        </div>
      </div>

      {/* ── Incident + note forms ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginTop: 14 }}>
        <div className="mo-panel">
          <h2>Add to timeline</h2>
          <div style={{ display: 'flex', gap: 8 }}>
            <select
              className="mo-input"
              style={{ width: 140 }}
              value={noteType}
              onChange={(e) => setNoteType(e.target.value as typeof noteType)}
            >
              <option value="note">Note</option>
              <option value="photo">Photo link</option>
              <option value="scope_change">Scope change</option>
            </select>
            <input
              className="mo-input"
              placeholder={noteType === 'photo' ? 'Photo URL or reference' : 'What happened?'}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
            <button
              className="mo-btn"
              disabled={saving || !note.trim()}
              onClick={async () => {
                await postEvent(noteType, noteType === 'photo' ? { url: note, note } : { note });
                setNote('');
              }}
            >
              Add
            </button>
          </div>

          <h2 style={{ marginTop: 14 }}>Failed access</h2>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              className="mo-input"
              placeholder="What happened at the door?"
              value={failedAccessNote}
              onChange={(e) => setFailedAccessNote(e.target.value)}
            />
            <input
              type="date"
              className="mo-input"
              style={{ width: 160 }}
              value={failedAccessDate}
              onChange={(e) => setFailedAccessDate(e.target.value)}
            />
            <button
              className="mo-btn danger"
              disabled={saving || !failedAccessNote.trim() || !failedAccessDate}
              onClick={async () => {
                await postEvent('failed_access', {
                  note: failedAccessNote,
                  new_next_action_date: failedAccessDate,
                });
                setFailedAccessNote('');
                setFailedAccessDate('');
              }}
            >
              Log (→ SCHEDULED)
            </button>
          </div>
          <p className="note">
            Failed access auto-returns the WO to SCHEDULED and requires the new date (tripwire #5).
          </p>
        </div>

        {/* ── Sub-entities ── */}
        <div className="mo-panel">
          <h2>Vendor / approvals / recommendations</h2>
          <div style={{ fontSize: 13 }}>
            {data.assignments.length > 0 && (
              <>
                <p className="mo-field-label">Assignments</p>
                {data.assignments.map((a) => (
                  <p key={a.id}>
                    {a.vendor?.name ?? 'Vendor'} — sent {fmtDate(a.sent_at)}
                    {a.accepted_at ? (
                      <span className="ok"> · accepted</span>
                    ) : a.declined_at ? (
                      <span className="flag"> · declined</span>
                    ) : (
                      <>
                        <span className="warn"> · unaccepted</span>{' '}
                        <button
                          className="mo-btn secondary"
                          disabled={saving}
                          onClick={async () => {
                            await fetch(`/api/maintenance/assignments/${a.id}`, {
                              method: 'PATCH',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ accepted_at: new Date().toISOString() }),
                            });
                            await load();
                          }}
                        >
                          Mark accepted
                        </button>
                      </>
                    )}
                  </p>
                ))}
              </>
            )}
            {data.approvals.length > 0 && (
              <>
                <p className="mo-field-label" style={{ marginTop: 8 }}>
                  Approvals
                </p>
                {data.approvals.map((a) => (
                  <p key={a.id}>
                    {a.kind} — {a.requested_of}, asked {fmtDate(a.requested_at)}:{' '}
                    {a.decision ? (
                      <span className={a.decision === 'APPROVED' ? 'ok' : 'flag'}>{a.decision}</span>
                    ) : (
                      <span className="warn">pending</span>
                    )}
                  </p>
                ))}
              </>
            )}
            {data.recommendations.length > 0 && (
              <>
                <p className="mo-field-label" style={{ marginTop: 8 }}>
                  Recommendations
                </p>
                {data.recommendations.map((r) => (
                  <p key={r.id}>
                    {r.tech}: {r.body.slice(0, 80)} —{' '}
                    {r.resolved_wo_id ? (
                      <span className="ok">became a WO</span>
                    ) : r.dismissed_reason ? (
                      <span className="ok">dismissed: {r.dismissed_reason}</span>
                    ) : (
                      <span className="warn">open (3-day clock, tripwire #10)</span>
                    )}
                  </p>
                ))}
              </>
            )}
            {data.assignments.length === 0 &&
              data.approvals.length === 0 &&
              data.recommendations.length === 0 && (
                <p style={{ color: 'var(--muted)' }}>
                  None yet. Create assignments/approvals/recommendations via the API or upcoming
                  dispatch UI (Wave 2).
                </p>
              )}
          </div>
        </div>
      </div>

      {/* ── Event timeline ── */}
      <div className="mo-panel" style={{ marginTop: 14 }}>
        <h2>Timeline (append-only)</h2>
        {data.events.length === 0 && <p className="note">No events yet.</p>}
        {[...data.events].reverse().map((e) => (
          <div className="evt" key={e.id}>
            <span className="t">{new Date(e.created_at).toLocaleString()}</span>
            <span className="type">
              {e.event_type}
              {e.event_type === 'stage_change' &&
                ` ${(e.payload as { from?: string }).from} → ${(e.payload as { to?: string }).to}`}
            </span>
            <span style={{ color: 'var(--muted)' }}>
              {typeof e.payload.note === 'string'
                ? e.payload.note
                : typeof e.payload.item === 'string'
                  ? e.payload.item
                  : ''}
            </span>
            <span style={{ marginLeft: 'auto', color: 'var(--muted)' }}>{e.actor}</span>
          </div>
        ))}
      </div>

      {wo.stage === 'WAITING_ON' && wo.waiting_reason && (
        <p className="note">
          <WaitBadge reason={wo.waiting_reason} /> Every WAIT has a reason, a next action date, and
          one owner — a WAIT tag without a date is a violation by definition.
        </p>
      )}
    </div>
  );
}
