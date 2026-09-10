'use client';

/**
 * Dashboard — "where are we on maintenance?" on one screen.
 *
 * Axis = AppFolio status. Each tile: how many are in the step now, how long
 * they've been there (median · p90), how long the step typically takes (last
 * 90 days), and a red "N over" pill for the ones past the shared threshold
 * (lib/maintenance/dashboard-thresholds.ts). Every number drills into the
 * existing list views, which link on to the WO / turn detail pages.
 */

import Link from 'next/link';
import type { DashboardData, Hist, StepStats } from '@/lib/maintenance/dashboard';
import type { Drill } from '@/lib/maintenance/dashboard-drill';
import {
  DASHBOARD_THRESHOLDS,
  describeThreshold,
  type ThresholdRule,
} from '@/lib/maintenance/dashboard-thresholds';
import { turnStatusLabel } from '@/lib/turn-estimator/turn-lifecycle';
import type { WaitingReason } from '@/lib/maintenance/types';
import { WAITING_REASONS } from '@/lib/maintenance/types';
import type { ScoreboardRow } from '../board-types';
import { WaitBadge } from '../components/shared';

// ── formatting ──

function days(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  if (n < 10) return `${Math.round(n * 10) / 10}d`;
  return `${Math.round(n)}d`;
}

function histText(h: Hist): string {
  if (h.n === 0) return 'typical: no completed history yet';
  return `typical ${days(h.medianDays)} · p90 ${days(h.p90Days)} (n=${h.n})`;
}

function ageText(s: StepStats): string {
  if (s.count === 0) return 'nothing here';
  return `here ${days(s.medianAgeDays)} · p90 ${days(s.p90AgeDays)}`;
}

function fmtWhen(iso: string | null): string {
  if (!iso) return 'never';
  const d = new Date(iso);
  return d.toLocaleDateString([], { month: 'numeric', day: 'numeric' });
}

// ── tiles ──

function StepTile({
  label,
  stats,
  historical,
  rule,
  tone,
  tip,
  onDrill,
  drillLabel,
}: {
  label: string;
  stats: StepStats;
  historical?: Hist;
  rule?: ThresholdRule;
  tone?: 'bad' | 'warn';
  tip: string;
  onDrill: (d: Omit<Drill, 'view'>) => void;
  drillLabel: string;
}) {
  const overTone = stats.overThresholdCount > 0 ? 'bad' : undefined;
  return (
    <div
      className={`kpi click ${tone ?? overTone ?? ''}`}
      data-tip={tip}
      role="button"
      tabIndex={0}
      onClick={() => onDrill({ ids: stats.ids, label: drillLabel })}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onDrill({ ids: stats.ids, label: drillLabel })}
    >
      <div className="v">{stats.count}</div>
      <div className="l">{label}</div>
      <div className="sub">{ageText(stats)}</div>
      {historical && <div className="sub">{histText(historical)}</div>}
      {rule && stats.overThresholdCount > 0 && (
        <button
          type="button"
          className="over"
          title={describeThreshold(rule)}
          onClick={(e) => {
            e.stopPropagation();
            onDrill({ ids: stats.overThresholdIds, label: `${drillLabel} · ${describeThreshold(rule)}` });
          }}
        >
          {stats.overThresholdCount} over
        </button>
      )}
    </div>
  );
}

function Arrow() {
  return (
    <span className="pipe-arrow" aria-hidden>
      →
    </span>
  );
}

// ── the view ──

export default function Dashboard({
  dash,
  scoreboard,
  onDrill,
}: {
  dash: DashboardData | null;
  scoreboard: ScoreboardRow[];
  onDrill: (d: Drill) => void;
}) {
  if (!dash) {
    return (
      <section>
        <p className="note flag" style={{ borderTop: 0, paddingTop: 0 }}>
          The dashboard payload did not load. The other tabs still work — try ⟳.
        </p>
      </section>
    );
  }

  const wo = (d: Omit<Drill, 'view'>) => onDrill({ view: 'open', ...d });
  const turn = (ids: string[], label: string) => onDrill({ view: 'turnover', turnIds: ids, label });
  const { pipeline, estimates, waiting, turns, attention, closed } = dash;
  const vendorsOverdue = scoreboard.filter((r) => r.overdue > 0).length;
  const knownReasons = new Set<string>(WAITING_REASONS);

  return (
    <section className="dash">
      {/* 1 · Pipeline */}
      <div className="grp">
        Work orders by AppFolio step — {dash.openTotal} open
        <span className="mo-hint"> · click a number to see the list · &quot;N over&quot; = past the threshold</span>
      </div>
      <div className="pipe">
        <StepTile
          label="New"
          stats={pipeline.new}
          historical={pipeline.new.historical}
          rule={DASHBOARD_THRESHOLDS.new}
          tip="AppFolio status New — logged, nobody assigned yet. Threshold: more than 1 business day."
          onDrill={wo}
          drillLabel="New"
        />
        <Arrow />
        <StepTile
          label="Assigned"
          stats={pipeline.assigned}
          historical={pipeline.assigned.historical}
          rule={DASHBOARD_THRESHOLDS.assigned}
          tip="Assigned to a vendor or tech but no visit scheduled — the coordination pool. Threshold: more than 5 business days."
          onDrill={wo}
          drillLabel="Assigned"
        />
        <Arrow />
        <StepTile
          label="Scheduled"
          stats={pipeline.scheduled}
          historical={pipeline.scheduled.historical}
          rule={DASHBOARD_THRESHOLDS.scheduled}
          tip="A visit date is set. Over = the visit date has passed and the work order is still open."
          onDrill={wo}
          drillLabel="Scheduled"
        />
        <Arrow />
        <StepTile
          label="Work completed"
          stats={pipeline.work_completed}
          historical={pipeline.work_completed.historical}
          rule={DASHBOARD_THRESHOLDS.work_completed}
          tip="AppFolio says the work is done but the WO is not Completed/closed — bill it or close it. Threshold: more than 5 days."
          onDrill={wo}
          drillLabel="Work completed"
        />
        <Arrow />
        <div className="kpi" data-tip="Closed (not canceled) in the last 7 days. Typical = created → completed cycle time over the last 90 days.">
          <div className="v">{closed.last7}</div>
          <div className="l">Closed (7d)</div>
          <div className="sub">{histText(closed.historical)}</div>
          {closed.unbilledOver5 > 0 && (
            <button
              type="button"
              className="over"
              title="Tripwire #8: verified more than 5 days ago, no invoice"
              onClick={() => onDrill({ view: 'exceptions', label: 'Unbilled' })}
            >
              {closed.unbilledOver5} unbilled
            </button>
          )}
        </div>
        {pipeline.other.count > 0 && (
          <>
            <Arrow />
            <StepTile
              label="Other status"
              stats={pipeline.other}
              tip="Open work orders whose AppFolio status is blank or not one we recognise."
              onDrill={wo}
              drillLabel="Other status"
            />
          </>
        )}
      </div>

      {/* 2 · Estimates */}
      <div className="grp">
        Estimates &amp; approvals
        <span className="mo-hint"> · no dollar amounts exist in the API — these are ages and counts</span>
      </div>
      <div className="pipe">
        <StepTile
          label="Estimate requested"
          stats={estimates.estimate_requested}
          historical={estimates.estimate_requested.historical}
          rule={DASHBOARD_THRESHOLDS.estimate_requested}
          tip="Waiting on a vendor bid. Threshold: more than 3 business days (tripwire #11). The estimate chaser drafts the follow-up."
          onDrill={wo}
          drillLabel="Estimate requested"
        />
        <Arrow />
        <StepTile
          label="Estimated"
          stats={estimates.estimated}
          historical={estimates.estimated.historical}
          rule={DASHBOARD_THRESHOLDS.estimated}
          tip="Bid in hand, decision pending. Estimated ≠ waiting on the property owner — only a recorded owner approval proves that (next tile). Threshold: more than 3 business days."
          onDrill={wo}
          drillLabel="Estimated"
        />
        <Arrow />
        <StepTile
          label="Owner approval pending"
          stats={estimates.ownerGated}
          historical={estimates.ownerGated.historical}
          rule={DASHBOARD_THRESHOLDS.owner_approval}
          tip="Undecided owner-approval requests recorded in HDPM-OS. Typical = requested → decided over the last 90 days."
          onDrill={wo}
          drillLabel="Owner approval pending"
        />
        <div className="kpi" data-tip="Estimate chaser activity on the current estimate pool: work orders chased at least once, median chases per WO, escalations to the ops brief, last chase date.">
          <div className="v">{estimates.chase.chasedCount}</div>
          <div className="l">Chased by the agent</div>
          <div className="sub">
            median {estimates.chase.medianChases ?? '—'} chases · {estimates.chase.escalatedCount} escalated
          </div>
          <div className="sub">last chase {fmtWhen(estimates.chase.lastChaseAt)}</div>
        </div>
        <div className="kpi" data-tip="Time from entering either estimate status to leaving both, over the last 90 days.">
          <div className="v">{days(estimates.laneHistorical.medianDays)}</div>
          <div className="l">Typical estimate → decision</div>
          <div className="sub">{histText(estimates.laneHistorical)}</div>
        </div>
      </div>

      {/* 3 · Waiting */}
      <div className="grp">
        Waiting
        <span className="mo-hint">
          {' '}· AppFolio &quot;Waiting&quot; plus anything staff parked on a wait reason
          {waiting.parkedByStaff > 0 && ` (${waiting.parkedByStaff} parked by staff)`}
        </span>
      </div>
      <div className="pipe">
        <StepTile
          label="Waiting"
          stats={waiting}
          rule={DASHBOARD_THRESHOLDS.waiting}
          tip="Blocked work — tenant, vendor, parts, owner, weather, or internal. Threshold: more than 5 days (matches the red days-pill)."
          onDrill={(d) => onDrill({ view: 'wait', ...d })}
          drillLabel="Waiting"
        />
        <div className="chips" style={{ alignSelf: 'center', marginBottom: 0 }}>
          {Object.entries(waiting.byReason)
            .sort(([, a], [, b]) => b - a)
            .map(([reason, n]) => (
              <button
                key={reason}
                type="button"
                className="chip"
                onClick={() => onDrill({ view: 'wait', ids: waiting.ids, label: `Waiting · ${reason}` })}
                title={`${n} waiting on ${reason.toLowerCase()}`}
              >
                {knownReasons.has(reason) ? <WaitBadge reason={reason as WaitingReason} small /> : reason}{' '}
                {n}
              </button>
            ))}
          {waiting.count === 0 && <span className="mo-hint">nothing is parked</span>}
        </div>
      </div>

      {/* 4 · Turns */}
      <div className="grp">
        Unit turns
        <span className="mo-hint">
          {turns.legacyStates
            ? ' · lifecycle states unavailable (migration 20260905 not applied) — showing legacy status'
            : ' · by lifecycle state · days in state from turn_status_event'}
        </span>
      </div>
      <div className="pipe">
        <div
          className="kpi click"
          role="button"
          tabIndex={0}
          data-tip="Turns not yet closed or cancelled."
          onClick={() => turn(turns.byState.flatMap((s) => s.ids), 'All open turns')}
          onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && turn(turns.byState.flatMap((s) => s.ids), 'All open turns')}
        >
          <div className="v">{turns.open}</div>
          <div className="l">Open turns</div>
          <div className="sub">median {days(turns.medianDaysVacant)} vacant (not yet ready)</div>
        </div>
        <div
          className={`kpi click ${turns.behindTarget.count > 0 ? 'bad' : ''}`}
          role="button"
          tabIndex={0}
          data-tip="Target-ready date has passed and the turn is not yet ready."
          onClick={() => turn(turns.behindTarget.ids, 'Turns behind target')}
          onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && turn(turns.behindTarget.ids, 'Turns behind target')}
        >
          <div className="v">{turns.behindTarget.count}</div>
          <div className="l">Behind target</div>
          <div className="sub">{describeThreshold(DASHBOARD_THRESHOLDS.turn)}</div>
        </div>
        <div className="chips" style={{ alignSelf: 'center', marginBottom: 0 }}>
          {turns.byState.map((s) => (
            <button
              key={s.state}
              type="button"
              className="chip"
              onClick={() => turn(s.ids, `Turns · ${turnStatusLabel(s.state)}`)}
              title={`${s.count} in ${turnStatusLabel(s.state)} · median ${days(s.medianDaysInState)} in state · ${histText(s.historical)}`}
            >
              {turnStatusLabel(s.state)} {s.count}
              <span className="mo-hint"> · {days(s.medianDaysInState)}</span>
            </button>
          ))}
          {turns.open === 0 && <span className="mo-hint">no open turns</span>}
        </div>
      </div>

      {/* 5 · Attention */}
      <div className="grp">
        Needs attention today
        <span className="mo-hint"> · tripwire hits, oldest first</span>
      </div>
      <div className="pipe">
        <div
          className={`kpi click ${attention.total > 0 ? 'bad' : ''}`}
          role="button"
          tabIndex={0}
          data-tip="Every tripwire hit right now — each with one accountable owner. Click for the full grouped list."
          onClick={() => onDrill({ view: 'exceptions', label: 'Exceptions' })}
          onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onDrill({ view: 'exceptions', label: 'Exceptions' })}
        >
          <div className="v">{attention.total}</div>
          <div className="l">Exceptions</div>
          <div className="sub">
            {Object.entries(attention.byTripwire)
              .sort(([, a], [, b]) => b - a)
              .slice(0, 3)
              .map(([label, n]) => `${label.split(' ')[0]} ${n}`)
              .join(' · ') || 'zero — nothing is falling through'}
          </div>
        </div>
        <div
          className={`kpi click ${attention.needsDateCount > 0 ? 'warn' : ''}`}
          role="button"
          tabIndex={0}
          data-tip="Open work orders with no next-action date and no future scheduled visit — nobody is on the hook for a day yet."
          onClick={() => onDrill({ view: 'exceptions', label: 'Needs a date' })}
          onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onDrill({ view: 'exceptions', label: 'Needs a date' })}
        >
          <div className="v">{attention.needsDateCount}</div>
          <div className="l">Needs a date</div>
          <div className="sub">triage backlog</div>
        </div>
        <div
          className="kpi click"
          role="button"
          tabIndex={0}
          data-tip="Vendors with at least one overdue work order. Click for the scoreboard."
          onClick={() => onDrill({ view: 'vendor', label: 'Vendors' })}
          onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onDrill({ view: 'vendor', label: 'Vendors' })}
        >
          <div className="v">{vendorsOverdue}</div>
          <div className="l">Vendors with overdue work</div>
          <div className="sub">of {scoreboard.length} active</div>
        </div>
      </div>
      {attention.top.length > 0 && (
        <ul className="mo-items">
          {attention.top.map((ex, i) => (
            <li key={`${ex.tripwire}-${ex.workOrderId ?? i}`}>
              <div className="mi-row">
                {ex.workOrderId ? (
                  <Link className="mi-desc" href={`/maintenance/board/wo/${ex.workOrderId}`} title={ex.fixRequired}>
                    <span className="mi-wonum">{ex.label}</span> {ex.item}
                  </Link>
                ) : (
                  <span className="mi-desc" title={ex.fixRequired}>
                    <span className="mi-wonum">{ex.label}</span> {ex.item}
                  </span>
                )}
                <span className="mi-owner">{ex.owner}</span>
                {ex.ageDays != null && <span className="mi-meta">{ex.ageDays}d</span>}
              </div>
            </li>
          ))}
        </ul>
      )}

      <p className="note">
        Clocks: &quot;here&quot; = time since the work order entered its current AppFolio status (exact from the sync
        log since July 2026, else AppFolio&apos;s last-updated date). &quot;Typical&quot; = completed spells in the last{' '}
        {dash.windowDays} days, median and 90th percentile, with the sample size. Not measured because no timestamp
        exists: request → work order, reschedules, estimate dollar amounts, vendor bill timing.
      </p>
    </section>
  );
}
