"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Clock,
  Flame,
  CalendarCheck,
  PhoneCall,
  MessageCircleWarning,
  Home,
} from "lucide-react";

// ────────────────────────────────────────────────
// Types (mirror /api/haven/overview response)
// ────────────────────────────────────────────────

interface Flag {
  conversation_id: string;
  name: string;
  email: string | null;
  phone: string | null;
  property: string | null;
  phase: string | null;
  flag_type: string | null;
  flag_date: string | null;
  last_activity_at: string | null;
  appfolio_link: string | null;
}

interface HotLead extends Flag {
  classification: string | null;
  lead_source: string | null;
}

interface Tour {
  conversation_id: string;
  name: string;
  property: string | null;
  start: string | null;
  status: string | null;
  agent: string | null;
}

interface Overview {
  totals: { conversations: number; activeProspects: number; inactive: number; newLast30Days: number };
  funnel: Array<{ phase: string; count: number }>;
  escalations: Flag[];
  followUps: Flag[];
  hotLeads: HotLead[];
  tours: Tour[];
  responseTime: {
    avgHoursToFirstContact: number | null;
    pctContactedUnder1Hour: number | null;
    pctContactedUnder24Hours: number | null;
    pctNeverContacted: number | null;
    sampleSize: number;
  } | null;
  reception: {
    totalCalls: number;
    callsHandledByAi: number;
    callsTransferred: number;
    callsAbandoned: number | null;
    aiResolutionRate: number | null;
    knowledgeGapCount: number;
  } | null;
  conversions?: {
    converted90d: number;
    matched90d: number;
    convertedAllTime: number;
    bySource: Array<{ source: string; count: number }>;
  };
  synced: boolean;
}

// ────────────────────────────────────────────────
// Display config
// ────────────────────────────────────────────────

// Sequential emerald ramp, light→dark along the journey (identity is carried
// by position + direct labels, color encodes stage depth only).
const PHASE_META: Record<string, { label: string; color: string }> = {
  AwaitingEngagement: { label: "Awaiting Engagement", color: "#a7f3d0" },
  PreTour: { label: "Pre-Tour", color: "#34d399" },
  PreTourScheduled: { label: "Tour Scheduled", color: "#10b981" },
  PreTourConfirmed: { label: "Tour Confirmed", color: "#059669" },
  PostTour: { label: "Post-Tour", color: "#065f46" },
};

// Status colors (icon + label always accompany — never color alone)
const STATUS = {
  critical: "#d03b3b",
  serious: "#ec835a",
  warning: "#b45309",
  good: "#0ca30c",
};

function timeAgo(iso: string | null): string {
  if (!iso) return "";
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (days === 0) return "today";
  if (days === 1) return "1 day ago";
  if (days < 30) return `${days} days ago`;
  return `${Math.floor(days / 30)} mo ago`;
}

function fmtTourTime(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/Los_Angeles",
  });
}

// ────────────────────────────────────────────────
// Pieces
// ────────────────────────────────────────────────

function StatTile({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string | number;
  sub?: string;
  accent?: string;
}) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4">
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className="text-2xl font-semibold mt-1" style={{ color: accent || "#1e293b" }}>
        {value}
      </p>
      {sub && <p className="text-xs text-slate-400 mt-0.5">{sub}</p>}
    </div>
  );
}

function ContactLinks({ flag }: { flag: Flag }) {
  return (
    <span className="flex gap-2 text-xs whitespace-nowrap">
      {flag.phone && (
        <a href={`tel:${flag.phone}`} className="text-emerald-700 hover:underline">
          call
        </a>
      )}
      {flag.email && (
        <a href={`mailto:${flag.email}`} className="text-emerald-700 hover:underline">
          email
        </a>
      )}
      {flag.appfolio_link && (
        <a
          href={flag.appfolio_link}
          target="_blank"
          rel="noopener noreferrer"
          className="text-emerald-700 hover:underline"
        >
          AppFolio ↗
        </a>
      )}
    </span>
  );
}

// ────────────────────────────────────────────────
// Component
// ────────────────────────────────────────────────

export function HavenDashboard() {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hoverPhase, setHoverPhase] = useState<string | null>(null);
  const [showAllEscalations, setShowAllEscalations] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/haven/overview");
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || "Failed to load");
        if (!cancelled) setData(json);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const maxPhase = useMemo(
    () => Math.max(1, ...(data?.funnel.map((f) => f.count) || [1])),
    [data]
  );

  if (error) {
    return (
      <div className="rounded-xl bg-red-50 border border-red-200 p-4 text-sm text-red-700">
        {error}
      </div>
    );
  }
  if (!data) {
    return <div className="py-16 text-center text-sm text-slate-400">Loading Haven data…</div>;
  }
  if (!data.synced) {
    return (
      <div className="rounded-xl bg-amber-50 border border-amber-200 p-4 text-sm text-amber-800">
        No Haven data synced yet — run /api/haven/sync (requires HAVEN_API_KEY and the
        20260727 haven_conversation migration).
      </div>
    );
  }

  const rt = data.responseTime;
  const rc = data.reception;
  const escalationsShown = showAllEscalations ? data.escalations : data.escalations.slice(0, 8);

  return (
    <div className="space-y-6">
      {/* KPI row */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <StatTile
          label="Active prospects"
          value={data.totals.activeProspects}
          sub={`${data.totals.newLast30Days} new in 30d`}
        />
        <StatTile
          label="Upcoming tours"
          value={data.tours.length}
          sub={data.tours[0] ? `next: ${fmtTourTime(data.tours[0].start)}` : "none scheduled"}
        />
        <StatTile
          label="Replied <1 hour"
          value={rt?.pctContactedUnder1Hour != null ? `${rt.pctContactedUnder1Hour}%` : "—"}
          sub={rt ? `avg ${rt.avgHoursToFirstContact ?? "—"}h · ${rt.sampleSize} threads (90d)` : "no data yet"}
        />
        <StatTile
          label="Open escalations"
          value={data.escalations.length}
          accent={data.escalations.length > 0 ? STATUS.critical : STATUS.good}
          sub={data.followUps.length ? `+${data.followUps.length} pending follow-ups` : "no pending follow-ups"}
        />
        <StatTile
          label="AI call resolution"
          value={
            rc?.aiResolutionRate != null
              ? // API may report 0-1 or 0-100; normalize to a percentage
                `${Math.round(rc.aiResolutionRate > 1 ? rc.aiResolutionRate : rc.aiResolutionRate * 100)}%`
              : "—"
          }
          sub={rc ? `${rc.totalCalls} calls in 30d` : "reception metrics unavailable"}
        />
      </div>

      <div className="grid lg:grid-cols-5 gap-6">
        {/* Funnel */}
        <section className="lg:col-span-3 bg-white rounded-xl border border-slate-200 p-5">
          <h2 className="text-sm font-semibold text-slate-800">Leasing Pipeline</h2>
          <p className="text-xs text-slate-400 mt-0.5 mb-4">
            Where every active prospect stands right now · {data.totals.inactive} inactive not shown
          </p>
          <div className="space-y-2">
            {data.funnel.map((stage) => {
              const meta = PHASE_META[stage.phase] || { label: stage.phase, color: "#94a3b8" };
              const widthPct = Math.max(2, (stage.count / maxPhase) * 100);
              const pctOfActive =
                data.totals.activeProspects > 0
                  ? Math.round((stage.count / data.totals.activeProspects) * 100)
                  : 0;
              const hovered = hoverPhase === stage.phase;
              return (
                <div
                  key={stage.phase}
                  className="grid grid-cols-[9.5rem_1fr_4.5rem] items-center gap-3"
                  onMouseEnter={() => setHoverPhase(stage.phase)}
                  onMouseLeave={() => setHoverPhase(null)}
                >
                  <span className="text-xs text-slate-600 text-right">{meta.label}</span>
                  <div className="h-6 relative" title={`${meta.label}: ${stage.count} prospects (${pctOfActive}% of active)`}>
                    <div
                      className="h-6 rounded-r transition-all"
                      style={{
                        width: `${widthPct}%`,
                        background: meta.color,
                        outline: hovered ? "2px solid #1e293b22" : "none",
                      }}
                    />
                  </div>
                  <span className="text-xs text-slate-700 tabular-nums">
                    <span className="font-semibold">{stage.count}</span>
                    <span className="text-slate-400"> · {pctOfActive}%</span>
                  </span>
                </div>
              );
            })}
          </div>

          {/* Hot leads inside the pipeline card */}
          {data.hotLeads.length > 0 && (
            <div className="mt-5 pt-4 border-t border-slate-100">
              <h3 className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
                <Flame className="w-3.5 h-3.5" style={{ color: STATUS.serious }} />
                Hot leads — ready to move ({data.hotLeads.length})
              </h3>
              <ul className="mt-2 space-y-1.5">
                {data.hotLeads.slice(0, 6).map((l) => (
                  <li key={l.conversation_id} className="flex items-baseline justify-between gap-2 text-xs">
                    <span className="truncate">
                      <span className="font-medium text-slate-700">{l.name}</span>
                      <span className="text-slate-400"> · {l.classification}</span>
                      {l.property && <span className="text-slate-400"> · {l.property}</span>}
                    </span>
                    <ContactLinks flag={l} />
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>

        {/* Needs action */}
        <section className="lg:col-span-2 space-y-4">
          <div className="bg-white rounded-xl border border-slate-200 p-5">
            <h2 className="text-sm font-semibold text-slate-800 flex items-center gap-1.5">
              <AlertTriangle className="w-4 h-4" style={{ color: STATUS.critical }} />
              Escalations ({data.escalations.length})
            </h2>
            {data.escalations.length === 0 ? (
              <p className="text-xs text-slate-400 mt-2">Nothing flagged — all clear.</p>
            ) : (
              <>
                <ul className="mt-3 space-y-2.5">
                  {escalationsShown.map((f) => (
                    <li key={f.conversation_id} className="text-xs border-l-2 pl-2.5" style={{ borderColor: STATUS.critical }}>
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="font-medium text-slate-700 truncate">{f.name}</span>
                        <span className="text-slate-400 whitespace-nowrap">{timeAgo(f.flag_date)}</span>
                      </div>
                      <div className="text-slate-500">
                        {f.flag_type || "Escalated"}
                        {f.property ? ` · ${f.property}` : ""}
                      </div>
                      <ContactLinks flag={f} />
                    </li>
                  ))}
                </ul>
                {data.escalations.length > 8 && (
                  <button
                    onClick={() => setShowAllEscalations((v) => !v)}
                    className="mt-3 text-xs font-medium text-emerald-700 hover:underline"
                  >
                    {showAllEscalations ? "Show fewer" : `Show all ${data.escalations.length}`}
                  </button>
                )}
              </>
            )}
          </div>

          {data.followUps.length > 0 && (
            <div className="bg-white rounded-xl border border-slate-200 p-5">
              <h2 className="text-sm font-semibold text-slate-800 flex items-center gap-1.5">
                <MessageCircleWarning className="w-4 h-4" style={{ color: STATUS.warning }} />
                Pending follow-ups ({data.followUps.length})
              </h2>
              <ul className="mt-3 space-y-2">
                {data.followUps.slice(0, 6).map((f) => (
                  <li key={f.conversation_id} className="text-xs flex items-baseline justify-between gap-2">
                    <span className="truncate">
                      <span className="font-medium text-slate-700">{f.name}</span>
                      {f.property && <span className="text-slate-400"> · {f.property}</span>}
                    </span>
                    <span className="text-slate-400 whitespace-nowrap">{timeAgo(f.last_activity_at)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        {/* Upcoming tours */}
        <section className="bg-white rounded-xl border border-slate-200 p-5">
          <h2 className="text-sm font-semibold text-slate-800 flex items-center gap-1.5">
            <CalendarCheck className="w-4 h-4 text-emerald-600" />
            Upcoming tours ({data.tours.length})
          </h2>
          {data.tours.length === 0 ? (
            <p className="text-xs text-slate-400 mt-2">No tours scheduled.</p>
          ) : (
            <table className="w-full mt-3 text-xs">
              <thead>
                <tr className="text-slate-400 text-left">
                  <th className="font-medium pb-1.5">When</th>
                  <th className="font-medium pb-1.5">Prospect</th>
                  <th className="font-medium pb-1.5">Property</th>
                  <th className="font-medium pb-1.5">Status</th>
                </tr>
              </thead>
              <tbody>
                {data.tours.slice(0, 8).map((t) => (
                  <tr key={t.conversation_id} className="border-t border-slate-100">
                    <td className="py-1.5 whitespace-nowrap text-slate-700 tabular-nums">{fmtTourTime(t.start)}</td>
                    <td className="py-1.5 text-slate-700">{t.name}</td>
                    <td className="py-1.5 text-slate-500 truncate max-w-[12rem]">{t.property || "—"}</td>
                    <td className="py-1.5">
                      <span
                        className={
                          t.status === "confirmed"
                            ? "text-emerald-700 font-medium"
                            : "text-slate-500"
                        }
                      >
                        {t.status || "scheduled"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        {/* Conversions */}
        <section className="bg-white rounded-xl border border-slate-200 p-5">
          <h2 className="text-sm font-semibold text-slate-800 flex items-center gap-1.5">
            <Home className="w-4 h-4 text-emerald-600" />
            Became tenants
          </h2>
          {!data.conversions || data.conversions.convertedAllTime === 0 ? (
            <p className="text-xs text-slate-400 mt-2">
              No conversions attributed yet — populated by the AppFolio lead match
              (migration 20260727_haven_af_lead_link + next sync).
            </p>
          ) : (
            <>
              <p className="text-2xl font-semibold text-slate-800 mt-2">
                {data.conversions.converted90d}
                <span className="text-sm font-normal text-slate-400"> in 90 days</span>
              </p>
              <p className="text-xs text-slate-400 mt-0.5">
                {data.conversions.convertedAllTime} all-time from Haven conversations
              </p>
              {data.conversions.bySource.length > 0 && (
                <ul className="mt-3 space-y-1">
                  {data.conversions.bySource.map((s) => (
                    <li key={s.source} className="flex justify-between text-xs">
                      <span className="text-slate-600 truncate">{s.source}</span>
                      <span className="text-slate-700 tabular-nums font-medium">{s.count}</span>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </section>

        {/* Reception strip */}
        <section className="bg-white rounded-xl border border-slate-200 p-5">
          <h2 className="text-sm font-semibold text-slate-800 flex items-center gap-1.5">
            <PhoneCall className="w-4 h-4 text-emerald-600" />
            Reception — last 30 days
          </h2>
          {!rc ? (
            <p className="text-xs text-slate-400 mt-2">Reception metrics unavailable.</p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mt-3">
              <StatTile label="Total calls" value={rc.totalCalls} />
              <StatTile
                label="Handled by AI"
                value={rc.totalCalls > 0 ? `${Math.round((rc.callsHandledByAi / rc.totalCalls) * 100)}%` : "—"}
                sub={`${rc.callsHandledByAi} calls`}
              />
              <StatTile label="Transferred" value={rc.callsTransferred} />
              <StatTile label="Abandoned" value={rc.callsAbandoned ?? "—"} />
              <StatTile
                label="Knowledge gaps"
                value={rc.knowledgeGapCount}
                accent={rc.knowledgeGapCount > 0 ? STATUS.warning : undefined}
                sub="questions the AI couldn't answer"
              />
              <StatTile
                label="Never contacted"
                value={rt?.pctNeverContacted != null ? `${rt.pctNeverContacted}%` : "—"}
                accent={rt && (rt.pctNeverContacted ?? 0) > 5 ? STATUS.serious : undefined}
                sub="prospect messaged, no reply"
              />
            </div>
          )}
        </section>
      </div>

      <p className="text-xs text-slate-400 flex items-center gap-1">
        <Clock className="w-3 h-3" />
        Leasing data syncs daily at 6:45am PT from Haven; reception metrics are live.
      </p>
    </div>
  );
}
