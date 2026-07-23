'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import type { MaintWorkOrder, UnitTurn } from '@/lib/maintenance/types';
import type { BoardData } from '../board-types';
import { daysSince, fmtDate, todayStr } from '../board-types';
import { KpiTile } from '../components/shared';

function readiness(turn: UnitTurn): { text: string; cls: string } {
  if (!turn.target_ready) return { text: 'no target set ⚠', cls: 'flag' };
  const today = todayStr();
  if (turn.target_ready < today) return { text: 'slipping', cls: 'flag' };
  const daysOut = daysSince(today, new Date(turn.target_ready)) ?? 0;
  if (daysOut <= 3) return { text: 'at risk', cls: 'warn' };
  return { text: 'on track', cls: 'ok' };
}

function turnWhere(turn: UnitTurn): string {
  return turn.unit_name ? `${turn.property_name} · ${turn.unit_name}` : turn.property_name;
}

const STAGE_LABEL: Record<string, string> = {
  NEW: 'new',
  TRIAGED: 'triaged',
  SCHEDULED: 'sched',
  IN_PROGRESS: 'in prog',
  WAITING_ON: 'waiting',
  VERIFY: 'verify',
  BILL: 'bill',
  CLOSED: '✓ done',
};

function woLabel(wo: MaintWorkOrder): string {
  return wo.wo_number ? `#${wo.wo_number}` : wo.description.slice(0, 28);
}

/** AppFolio Turn Board phases, in make-ready order — one board column each. */
const PHASES: { key: string; label: string }[] = [
  { key: 'Keys / Locks', label: 'Keys' },
  { key: 'Remotes', label: 'Remotes' },
  { key: 'Maintenance / Repair', label: 'Repair' },
  { key: 'Floors / Carpets', label: 'Floors' },
  { key: 'Paint', label: 'Paint' },
  { key: 'Housekeeping', label: 'Clean' },
  { key: 'Appliances', label: 'Appliances' },
  { key: 'Landscape Maintenance', label: 'Landscape' },
  { key: 'Other', label: 'Other' },
];
const PHASE_KEYS = new Set(PHASES.map((p) => p.key));

/** Manually-linked WOs (no category) and unknown categories land in Other. */
function phaseKeyFor(wo: MaintWorkOrder): string {
  return wo.unit_turn_category && PHASE_KEYS.has(wo.unit_turn_category)
    ? wo.unit_turn_category
    : 'Other';
}

export default function Turnover({
  board,
  onChanged,
}: {
  board: BoardData;
  onChanged?: () => void;
}) {
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [draft, setDraft] = useState({
    property_name: '',
    unit_name: '',
    vacated_at: todayStr(),
    target_ready: '',
  });

  const turnWos = board.turnWos ?? [];
  const byTurn = new Map<string, MaintWorkOrder[]>();
  for (const wo of turnWos) {
    if (!wo.unit_turn_id) continue;
    const list = byTurn.get(wo.unit_turn_id);
    if (list) list.push(wo);
    else byTurn.set(wo.unit_turn_id, [wo]);
  }

  const rows = (board.unitTurns ?? [])
    .slice()
    .sort((a, b) => a.vacated_at.localeCompare(b.vacated_at));

  // Phase columns: only render phases that have at least one WO on the board.
  const allTurnWos = rows.flatMap((t) => byTurn.get(t.id) ?? []);
  const visiblePhases = PHASES.filter((p) => allTurnWos.some((wo) => phaseKeyFor(wo) === p.key));

  const today = todayStr();
  const weekOut = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);
  const behind = rows.filter(
    (t) => t.status === 'active' && (!t.target_ready || t.target_ready < today)
  ).length;
  const moveinsSoon = rows.filter(
    (t) => t.movein_date && t.movein_date >= today && t.movein_date <= weekOut
  ).length;
  const avgVacant =
    rows.length > 0
      ? Math.round(rows.reduce((sum, t) => sum + (daysSince(t.vacated_at) ?? 0), 0) / rows.length)
      : 0;

  const propertyNames = useMemo(
    () => Array.from(new Set(board.open.map((wo) => wo.property_name))).sort(),
    [board.open]
  );

  async function call(url: string, method: string, body: Record<string, unknown>, key: string) {
    setSaving(key);
    setError(null);
    try {
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        setError(payload.error || `Save failed (${res.status})`);
        return false;
      }
      onChanged?.();
      return true;
    } finally {
      setSaving(null);
    }
  }

  const save = (turnId: string, body: Record<string, unknown>) =>
    call(`/api/maintenance/unit-turns/${turnId}`, 'PUT', body, turnId);

  async function createTurn() {
    if (!draft.property_name.trim() || !draft.vacated_at) {
      setError('Property and vacated date are required');
      return;
    }
    const ok = await call(
      '/api/maintenance/unit-turns',
      'POST',
      {
        property_name: draft.property_name.trim(),
        unit_name: draft.unit_name.trim() || null,
        vacated_at: draft.vacated_at,
        target_ready: draft.target_ready || null,
      },
      'new'
    );
    if (ok) {
      setShowNew(false);
      setDraft({ property_name: '', unit_name: '', vacated_at: todayStr(), target_ready: '' });
    }
  }

  return (
    <section>
      <div className="kpis">
        <KpiTile
          value={rows.length}
          label="Units in turnover"
          title="Unit turns not yet closed (active + ready). One row per vacancy below."
        />
        <KpiTile
          value={behind}
          label="Behind schedule"
          tone={behind > 0 ? 'bad' : undefined}
          title="Active turns whose target-ready date is missing or already past."
        />
        <KpiTile
          value={moveinsSoon}
          label="Move-ins next 7 days"
          tone={moveinsSoon > 0 ? 'warn' : undefined}
          title="Turns with a move-in date inside the next 7 days — these must be rent-ready first."
        />
        <KpiTile
          value={rows.length > 0 ? `${avgVacant}d` : '—'}
          label="Avg days vacant"
          title="Average days since vacate across every open turn. Vacancy is rent lost daily."
        />
      </div>

      <div style={{ margin: '10px 0' }}>
        {!showNew ? (
          <button className="mo-btn" onClick={() => setShowNew(true)}>
            + Start turn
          </button>
        ) : (
          <div className="mo-toolbar" style={{ flexWrap: 'wrap', gap: 8 }}>
            <input
              className="mo-input"
              list="turn-properties"
              placeholder="Property *"
              value={draft.property_name}
              onChange={(e) => setDraft((d) => ({ ...d, property_name: e.target.value }))}
              style={{ minWidth: 220 }}
            />
            <datalist id="turn-properties">
              {propertyNames.map((p) => (
                <option key={p} value={p} />
              ))}
            </datalist>
            <input
              className="mo-input"
              placeholder="Unit"
              value={draft.unit_name}
              onChange={(e) => setDraft((d) => ({ ...d, unit_name: e.target.value }))}
              style={{ width: 100 }}
            />
            <label style={{ fontSize: 12, color: 'var(--muted)' }}>
              vacated{' '}
              <input
                type="date"
                className="mo-input"
                value={draft.vacated_at}
                onChange={(e) => setDraft((d) => ({ ...d, vacated_at: e.target.value }))}
              />
            </label>
            <label style={{ fontSize: 12, color: 'var(--muted)' }}>
              target ready{' '}
              <input
                type="date"
                className="mo-input"
                value={draft.target_ready}
                onChange={(e) => setDraft((d) => ({ ...d, target_ready: e.target.value }))}
              />
            </label>
            <button className="mo-btn" disabled={saving === 'new'} onClick={createTurn}>
              Create
            </button>
            <button className="mo-btn secondary" onClick={() => setShowNew(false)}>
              Cancel
            </button>
          </div>
        )}
      </div>

      {error && <p className="note flag">{error}</p>}

      <div style={{ overflowX: 'auto' }}>
      <table className="mo-table">
        <thead>
          <tr>
            <th>Unit</th>
            <th>Vacant</th>
            <th>Target ready</th>
            <th>Move-in</th>
            {visiblePhases.map((p) => (
              <th key={p.key} title={p.key}>
                {p.label}
              </th>
            ))}
            <th style={{ minWidth: 180 }}>Current blocker</th>
            <th>Budget / actual</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((turn) => {
            const wos = (byTurn.get(turn.id) ?? []).sort(
              (a, b) => (a.stage === 'CLOSED' ? 1 : 0) - (b.stage === 'CLOSED' ? 1 : 0)
            );
            const closed = wos.filter((wo) => wo.stage === 'CLOSED').length;
            const linkedIds = new Set(wos.map((wo) => wo.id));
            const candidates = board.open.filter(
              (wo) =>
                !wo.unit_turn_id && !linkedIds.has(wo.id) && wo.property_name === turn.property_name
            );
            const vacant = daysSince(turn.vacated_at) ?? 0;
            const ready = readiness(turn);
            const busy = saving === turn.id;
            const progressCls = wos.length === 0 ? 'flag' : closed === wos.length ? 'ok' : '';
            return (
              <tr key={turn.id}>
                <td>
                  <div>{turnWhere(turn)}</div>
                  <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                    vacated {fmtDate(turn.vacated_at)}
                    {turn.af_service_request_id && wos[0]?.wo_number && (
                      <> · #{wos[0].wo_number.split('-')[0]} AppFolio</>
                    )}
                    {turn.status !== 'active' && <> · {turn.status}</>}
                  </div>
                  <div className={progressCls} style={{ fontWeight: 700, fontSize: 11 }}>
                    {wos.length === 0 ? '⚠ no WOs linked' : `${closed}/${wos.length} closed`}
                  </div>
                </td>
                <td className={vacant > 21 ? 'flag' : vacant > 14 ? 'warn' : ''}>{vacant}</td>
                <td>
                  <input
                    type="date"
                    className="mo-input"
                    style={{ width: 140 }}
                    defaultValue={turn.target_ready ?? ''}
                    disabled={busy}
                    onChange={(e) => {
                      if (e.target.value && e.target.value !== turn.target_ready) {
                        save(turn.id, { target_ready: e.target.value });
                      }
                    }}
                  />
                  <div className={ready.cls} style={{ fontSize: 11 }}>
                    {ready.text}
                  </div>
                </td>
                <td>
                  <input
                    type="date"
                    className="mo-input"
                    style={{ width: 140 }}
                    defaultValue={turn.movein_date ?? ''}
                    disabled={busy}
                    onChange={(e) => {
                      if (e.target.value && e.target.value !== turn.movein_date) {
                        save(turn.id, { movein_date: e.target.value });
                      }
                    }}
                  />
                </td>
                {visiblePhases.map((p) => {
                  const cellWos = wos.filter((wo) => phaseKeyFor(wo) === p.key);
                  const allDone =
                    cellWos.length > 0 && cellWos.every((wo) => wo.stage === 'CLOSED');
                  return (
                    <td
                      key={p.key}
                      style={allDone ? { background: 'var(--tint)' } : undefined}
                    >
                      {cellWos.length === 0 && (
                        <span style={{ color: 'var(--muted)' }}>—</span>
                      )}
                      {cellWos.map((wo) => (
                        <div
                          key={wo.id}
                          style={{ fontSize: 12, whiteSpace: 'nowrap' }}
                          title={wo.description}
                        >
                          <Link href={`/maintenance/board/wo/${wo.id}`}>
                            {wo.wo_number ? `#${wo.wo_number}` : wo.description.slice(0, 14)}
                          </Link>{' '}
                          <span
                            className={
                              wo.stage === 'CLOSED' ? 'ok' : wo.stage === 'WAITING_ON' ? 'warn' : ''
                            }
                            style={{ fontSize: 11 }}
                          >
                            {STAGE_LABEL[wo.stage] ?? wo.stage.toLowerCase()}
                          </span>{' '}
                          <button
                            title="Unlink this work order from the turn (audited)"
                            disabled={busy}
                            onClick={() => save(turn.id, { unlink_wo_ids: [wo.id] })}
                            style={{ background: 'none', border: 0, padding: 0, color: 'var(--muted)', cursor: 'pointer', fontSize: 10 }}
                          >
                            ✕
                          </button>
                          <div
                            style={{
                              fontSize: 10,
                              color: 'var(--muted)',
                              maxWidth: 140,
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                            }}
                          >
                            {wo.description.slice(0, 40)}
                          </div>
                          {wo.stage !== 'CLOSED' && (wo.vendor_name || wo.assigned_tech) && (
                            <div style={{ fontSize: 10, color: 'var(--muted)' }}>
                              {(wo.vendor_name || wo.assigned_tech || '').slice(0, 18)}
                            </div>
                          )}
                        </div>
                      ))}
                    </td>
                  );
                })}
                <td>
                  <input
                    className="mo-input"
                    placeholder="⚠ no blocker named"
                    defaultValue={turn.current_blocker ?? ''}
                    disabled={busy}
                    style={!turn.current_blocker ? { borderColor: 'var(--red)' } : undefined}
                    onBlur={(e) => {
                      const val = e.target.value.trim();
                      if (val !== (turn.current_blocker ?? '')) {
                        save(turn.id, { current_blocker: val || null });
                      }
                    }}
                  />
                </td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <input
                    type="number"
                    className="mo-input"
                    style={{ width: 80 }}
                    placeholder="budget"
                    defaultValue={turn.budget ?? ''}
                    disabled={busy}
                    onBlur={(e) => {
                      const val = e.target.value === '' ? null : Number(e.target.value);
                      if (val !== turn.budget) save(turn.id, { budget: val });
                    }}
                  />{' '}
                  /{' '}
                  <input
                    type="number"
                    className="mo-input"
                    style={{ width: 80 }}
                    placeholder="actual"
                    defaultValue={turn.actual ?? ''}
                    disabled={busy}
                    onBlur={(e) => {
                      const val = e.target.value === '' ? null : Number(e.target.value);
                      if (val !== turn.actual) save(turn.id, { actual: val });
                    }}
                  />
                </td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  {turn.status === 'active' ? (
                    <button
                      className="mo-btn secondary"
                      disabled={busy}
                      title="Unit is rent-ready — leasing takes over; close the turn at move-in"
                      onClick={() => save(turn.id, { status: 'ready' })}
                    >
                      Mark ready
                    </button>
                  ) : (
                    <>
                      <button
                        className="mo-btn secondary"
                        disabled={busy}
                        title="Reopen — more make-ready work surfaced"
                        onClick={() => save(turn.id, { status: 'active' })}
                      >
                        Reopen
                      </button>{' '}
                      <button
                        className="mo-btn"
                        disabled={busy}
                        title="Tenant moved in / turn finished — archives the row off this board"
                        onClick={() => save(turn.id, { status: 'closed' })}
                      >
                        Close
                      </button>
                    </>
                  )}
                  {candidates.length > 0 && (
                    <select
                      className="mo-input"
                      style={{ display: 'block', maxWidth: 130, fontSize: 12, marginTop: 4 }}
                      value=""
                      disabled={busy}
                      title="Open work orders on this property not yet linked to a turn"
                      onChange={(e) => {
                        if (e.target.value) save(turn.id, { link_wo_ids: [e.target.value] });
                      }}
                    >
                      <option value="">+ link WO…</option>
                      {candidates.map((wo) => (
                        <option key={wo.id} value={wo.id}>
                          {woLabel(wo)}
                          {wo.unit_name ? ` · ${wo.unit_name}` : ''} ·{' '}
                          {wo.description.slice(0, 40)}
                        </option>
                      ))}
                    </select>
                  )}
                </td>
              </tr>
            );
          })}
          {rows.length === 0 && (
            <tr>
              <td colSpan={7 + visiblePhases.length} style={{ color: 'var(--muted)' }}>
                No active unit turns. Turns started on AppFolio&apos;s Unit Turn Board appear
                here automatically (within the 15-min sync); or start one manually with the
                button above.
              </td>
            </tr>
          )}
        </tbody>
      </table>
      </div>
      <p className="note">
        Vacancy is rent lost daily — every turn shows ALL of its work orders (any stage),
        its single current blocker, and who owns each piece. Turns Brody starts on
        AppFolio&apos;s Unit Turn Board sync in automatically with their phase WOs
        (&quot;AppFolio&quot; tag); manual turns and links still work alongside. Edits save
        on change/click-away; links and unlinks are logged to each work order&apos;s
        timeline. <b>Mark ready</b> when the unit is rentable, <b>Close</b> at move-in.
        Leasing sees target-ready and move-in dates from this view.
      </p>
    </section>
  );
}
