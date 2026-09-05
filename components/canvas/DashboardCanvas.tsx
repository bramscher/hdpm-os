"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import Link from "next/link";
import {
  FileText,
  BarChart3,
  TrendingUp,
  Clock,
  ClipboardCheck,
  Route,
  MapPin,
  AlertTriangle,
  CalendarDays,
  Car,
  Megaphone,
  Wrench,
  Activity,
  Phone,
  KeyRound,
  ListTodo,
  Hourglass,
  Users,
  DoorOpen,
  Upload,
  FileSpreadsheet,
  Bot,
  Home,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

function getGreeting() {
  // Force Pacific Time for Central Oregon
  const now = new Date();
  const pacificTime = new Date(
    now.toLocaleString("en-US", { timeZone: "America/Los_Angeles" })
  );
  const hour = pacificTime.getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

interface InspectionStats {
  total: number;
  overdue: number;
  this_week: number;
  upcoming: number;
  geocoded: number;
}

interface RouteStats {
  total_routes: number;
  dispatched: number;
}

interface BoardKpis {
  open: number;
  /** Today's tripwire hits — the one badge on the Maintenance tile. */
  attention: number;
}

interface CrackItem {
  kind: string;
  label: string;
  detail: string;
  action: string | null;
  owner: string | null;
  ageDays: number;
  href: string | null;
}

// The situation string is "<where> — <problem>"; split so the where reads as a
// bold lead and the problem as lighter follow-on. Falls back to the whole
// string as the lead when there's no separator (to-dos, nudges).
function splitCrackDetail(detail: string): { lead: string; rest: string } {
  const i = detail.indexOf(" — ");
  if (i === -1) return { lead: detail, rest: "" };
  return { lead: detail.slice(0, i), rest: detail.slice(i + 3) };
}

// Cracks bucket order (most severe first) + compact tab labels. Mirrors the
// CrackKind union in lib/cracks.ts; the API returns per-kind `counts`.
const CRACK_KINDS = [
  { kind: "exception", tab: "Exceptions", href: "/maintenance/board" },
  { kind: "needs_date", tab: "No next action", href: "/maintenance/board" },
  { kind: "stale_nudge", tab: "Nudges", href: "/agents" },
  { kind: "overdue_todo", tab: "Overdue", href: "/company/issues" },
  { kind: "missed_todo", tab: "Missed", href: "/company/issues" },
] as const;

type CrackCounts = Partial<Record<string, number>>;

interface TodayRouteStop {
  work_order_id: string;
  stop_order: number;
  address: string;
  lat: number | null;
  lng: number | null;
  work_orders: {
    wo_number: string | null;
    property_name: string;
    unit_name: string | null;
  } | null;
}

interface TodayRoute {
  id: string;
  route_date: string;
  assigned_tech: string | null;
  total_drive_minutes: number;
  total_service_minutes: number;
  stop_count: number;
  stops: TodayRouteStop[];
}

const HDPM_OFFICE = { lat: 44.256798, lng: -121.184346 };

function fmtMins(mins: number): string {
  const m = Math.round(mins);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

// ────────────────────────────────────────────────
// Streamdeck tiles
// ────────────────────────────────────────────────

type Tone = "terra" | "amber" | "green" | "blue" | "purple" | "red" | "charcoal";

const ICON_TONES: Record<Tone, string> = {
  terra: "bg-terra-100 text-terra-600",
  amber: "bg-amber-100 text-amber-600",
  green: "bg-green-100 text-green-600",
  blue: "bg-blue-100 text-blue-600",
  purple: "bg-purple-100 text-purple-600",
  red: "bg-red-100 text-red-600",
  charcoal: "bg-charcoal-100 text-charcoal-600",
};

const BADGE_TONES: Record<Tone, string> = {
  terra: "bg-terra-500 text-white",
  amber: "bg-amber-500 text-white",
  green: "bg-green-500 text-white",
  blue: "bg-blue-500 text-white",
  purple: "bg-purple-500 text-white",
  red: "bg-red-500 text-white",
  charcoal: "bg-charcoal-700 text-white",
};

function Tile({
  href,
  icon: Icon,
  label,
  tone,
  badge,
  badgeTone,
  title,
}: {
  href: string;
  icon: LucideIcon;
  label: string;
  tone: Tone;
  badge?: number | null;
  badgeTone?: Tone;
  title?: string;
}) {
  return (
    <Link
      href={href}
      title={title}
      className="group relative flex aspect-square flex-col items-center justify-center gap-2 rounded-xl border border-sand-200 bg-sand-50/60 p-2 transition-all duration-200 hover:-translate-y-0.5 hover:bg-white hover:shadow-card"
    >
      {badge != null && badge > 0 && (
        <span
          className={cn(
            "absolute right-1.5 top-1.5 flex h-5 min-w-[20px] items-center justify-center rounded-full px-1.5 text-[10px] font-bold",
            BADGE_TONES[badgeTone ?? "charcoal"]
          )}
        >
          {badge > 99 ? "99+" : badge}
        </span>
      )}
      <span
        className={cn(
          "flex h-10 w-10 items-center justify-center rounded-xl transition-transform duration-200 group-hover:scale-110",
          ICON_TONES[tone]
        )}
      >
        <Icon className="h-5 w-5" />
      </span>
      <span className="text-center text-[11px] font-medium leading-tight text-charcoal-700">
        {label}
      </span>
    </Link>
  );
}

function TileSection({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section className="mb-5 rounded-xl border border-sand-200 bg-white p-4 shadow-card">
      <p className="mb-3 text-[11px] font-semibold uppercase tracking-widest text-charcoal-400">
        {label}
      </p>
      <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-6 xl:grid-cols-8">
        {children}
      </div>
    </section>
  );
}

/**
 * The tile dashboard — default content of the agent-interface canvas.
 * Moved verbatim from the old app/page.tsx home page.
 */
export function DashboardCanvas() {
  const { data: session } = useSession();
  // Admin tile section is Craig-only by request (the admin pages themselves
  // stay isAdmin-gated in middleware).
  const showAdminSection =
    session?.user?.email?.toLowerCase() === "craig@highdesertpm.com";
  const [inspectionStats, setInspectionStats] = useState<InspectionStats | null>(null);
  const [routeStats, setRouteStats] = useState<RouteStats | null>(null);
  const [vacancyCount, setVacancyCount] = useState<number | null>(null);
  const [boardKpis, setBoardKpis] = useState<BoardKpis | null>(null);
  const [todayRoutes, setTodayRoutes] = useState<TodayRoute[]>([]);
  const [cracks, setCracks] = useState<CrackItem[]>([]);
  const [crackCounts, setCrackCounts] = useState<CrackCounts>({});
  const [activeCrackKind, setActiveCrackKind] = useState<string | null>(null);

  const firstName = (() => {
    const n = session?.user?.name;
    if (n) return n.trim().split(/\s+/)[0];
    const e = session?.user?.email;
    if (e) {
      const local = e.split("@")[0];
      return local.charAt(0).toUpperCase() + local.slice(1);
    }
    return null;
  })();

  useEffect(() => {
    // Fetch maintenance dashboard headline numbers (open + today's attention)
    fetch("/api/maintenance/dashboard")
      .then((r) => r.json())
      .then((data) =>
        setBoardKpis(
          data && typeof data.openTotal === "number"
            ? { open: data.openTotal, attention: data.attention?.total ?? 0 }
            : null
        )
      )
      .catch(() => {});

    // Fetch inspection stats
    fetch("/api/inspections/stats")
      .then((r) => r.json())
      .then((data) => setInspectionStats(data))
      .catch(() => {});

    // Fetch route stats
    fetch("/api/inspections/routes")
      .then((r) => r.json())
      .then((data) => {
        const routes = data.routes || [];
        setRouteStats({
          total_routes: routes.length,
          dispatched: routes.filter((r: { status: string }) => r.status === "dispatched").length,
        });
      })
      .catch(() => {});

    // Fetch today's published maintenance day route(s)
    fetch("/api/maintenance/routes")
      .then((r) => r.json())
      .then((data) => setTodayRoutes(data.routes ?? []))
      .catch(() => {});

    // Fetch the Cracks Radar (work nobody is touching)
    fetch("/api/maintenance/cracks")
      .then((r) => r.json())
      .then((data) => {
        const list = Array.isArray(data.cracks) ? (data.cracks as CrackItem[]) : [];
        const counts = (data.counts ?? {}) as CrackCounts;
        setCracks(list);
        setCrackCounts(counts);
        // Default to the most severe bucket that actually has items.
        const first = CRACK_KINDS.find((k) => (counts[k.kind] ?? 0) > 0);
        setActiveCrackKind(first?.kind ?? null);
      })
      .catch(() => {});

    // Fetch cached vacancy count
    fetch("/api/cached-vacancies")
      .then((r) => r.json())
      .then((data) => setVacancyCount(data.units?.length ?? 0))
      .catch(() => {});
  }, []);

  return (
    <div className="px-6 py-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="mb-6 animate-slide-up">
        <p className="text-xs font-semibold text-terra-500 uppercase tracking-widest mb-1">
          Dashboard
        </p>
        <h1 className="text-2xl font-bold text-charcoal-900 tracking-tight">
          {getGreeting()}
          {firstName ? `, ${firstName}` : ""}
        </h1>
        <p className="text-sm text-charcoal-400 mt-1">
          Your automation tools are ready.
        </p>
      </div>

      {/* Cracks Radar — work nobody is touching, split into buckets by kind */}
      {cracks.length > 0 && (() => {
        const total = CRACK_KINDS.reduce((s, k) => s + (crackCounts[k.kind] ?? 0), 0);
        const activeMeta = CRACK_KINDS.find((k) => k.kind === activeCrackKind);
        const activeItems = cracks.filter((c) => c.kind === activeCrackKind);
        const activeCount = crackCounts[activeCrackKind ?? ""] ?? activeItems.length;
        const shown = activeItems.slice(0, 8);
        return (
        <div className="mb-6 bg-white rounded-xl border border-sand-200 shadow-card animate-slide-up">
          <div className="flex items-center gap-2 px-5 pt-4 pb-3">
            <AlertTriangle className="w-4 h-4 text-amber-600" />
            <h2 className="text-heading text-charcoal-900 flex-1">Falling through the cracks</h2>
            <span className="rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-semibold text-amber-800">
              {total}
            </span>
          </div>

          {/* Bucket tabs — all five kinds; empty ones are dimmed and disabled */}
          <div className="flex flex-wrap gap-1.5 px-5 pb-3">
            {CRACK_KINDS.map((k) => {
              const count = crackCounts[k.kind] ?? 0;
              const active = k.kind === activeCrackKind;
              const empty = count === 0;
              return (
                <button
                  key={k.kind}
                  type="button"
                  disabled={empty}
                  onClick={() => setActiveCrackKind(k.kind)}
                  className={cn(
                    "flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium transition-colors",
                    active
                      ? "bg-charcoal-900 text-white"
                      : empty
                        ? "bg-transparent text-charcoal-300 cursor-default"
                        : "bg-sand-50 text-charcoal-600 hover:bg-sand-100"
                  )}
                >
                  <span>{k.tab}</span>
                  <span
                    className={cn(
                      "rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums",
                      active
                        ? "bg-white/20 text-white"
                        : empty
                          ? "bg-transparent text-charcoal-300"
                          : "bg-white text-charcoal-500"
                    )}
                  >
                    {count}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Items for the selected bucket — subject/problem on top, fix beneath */}
          <ul className="px-2 pb-2">
            {shown.map((c, i) => {
              const { lead, rest } = splitCrackDetail(c.detail);
              return (
                <li key={i}>
                  <Link
                    href={c.href ?? "/maintenance/board"}
                    className="block rounded-lg px-3 py-2 hover:bg-sand-50 transition-colors"
                  >
                    <div className="flex items-baseline gap-2">
                      <p className="min-w-0 flex-1 truncate text-sm">
                        <span className="font-semibold text-charcoal-900">{lead}</span>
                        {rest && <span className="text-charcoal-500"> · {rest}</span>}
                      </p>
                      {c.owner && (
                        <span className="shrink-0 text-xs font-medium text-charcoal-500">
                          {c.owner}
                        </span>
                      )}
                      <span className="shrink-0 text-xs tabular-nums text-charcoal-400">
                        {c.ageDays}d
                      </span>
                    </div>
                    {c.action && (
                      <p className="mt-0.5 truncate text-xs text-charcoal-400">→ {c.action}</p>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
          {activeCount > shown.length && activeMeta && (
            <p className="px-5 pb-3 text-xs text-charcoal-400">
              <Link href={activeMeta.href} className="hover:text-charcoal-600 hover:underline">
                +{activeCount - shown.length} more {activeMeta.tab.toLowerCase()} →
              </Link>
            </p>
          )}
        </div>
        );
      })()}

      {/* Today's field route (published from the maintenance board) */}
      {todayRoutes.map((route) => {
        const coords = route.stops
          .filter((s) => s.lat != null && s.lng != null)
          .map((s) => `${s.lat},${s.lng}`);
        const mapsUrl =
          coords.length > 0
            ? `https://www.google.com/maps/dir/${HDPM_OFFICE.lat},${HDPM_OFFICE.lng}/${coords.join("/")}`
            : null;
        return (
          <div
            key={route.id}
            className="mb-6 bg-white rounded-xl border border-terra-200 p-5 shadow-card relative overflow-hidden"
          >
            <div className="absolute top-0 right-0 w-32 h-32 bg-terra-50 rounded-bl-[80px] -mr-4 -mt-4 opacity-60" />
            <div className="relative">
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-terra-100 rounded-xl flex items-center justify-center">
                    <Route className="w-5 h-5 text-terra-600" />
                  </div>
                  <div>
                    <p className="text-[11px] font-semibold text-terra-500 uppercase tracking-widest">
                      Today&apos;s field route
                    </p>
                    <h3 className="text-base font-semibold text-charcoal-900">
                      {route.assigned_tech ?? "HDMS crew"} · {route.stop_count} stops
                    </h3>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  {mapsUrl && (
                    <a
                      href={mapsUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs font-medium text-terra-600 hover:text-terra-700"
                    >
                      Open in Google Maps ↗
                    </a>
                  )}
                  <Link
                    href="/maintenance/board"
                    className="text-xs font-medium text-charcoal-400 hover:text-charcoal-600"
                  >
                    Board →
                  </Link>
                </div>
              </div>
              <ol className="list-decimal pl-5 text-sm text-charcoal-600 space-y-0.5">
                {route.stops.map((s) => (
                  <li key={s.work_order_id}>
                    <span className="font-medium text-charcoal-900">
                      {s.work_orders?.property_name ?? s.address}
                    </span>
                    {s.work_orders?.unit_name ? ` · ${s.work_orders.unit_name}` : ""}
                    <span className="text-charcoal-400">
                      {" "}
                      — {s.address}
                      {s.work_orders?.wo_number ? ` · #${s.work_orders.wo_number}` : ""}
                    </span>
                  </li>
                ))}
              </ol>
              <div className="mt-3 flex items-center gap-4 text-xs text-charcoal-400">
                <span className="flex items-center gap-1.5">
                  <Car className="w-3 h-3" />
                  drive {fmtMins(route.total_drive_minutes)}
                </span>
                <span className="flex items-center gap-1.5">
                  <Clock className="w-3 h-3" />
                  on-site {fmtMins(route.total_service_minutes)}
                </span>
                <span className="flex items-center gap-1.5">
                  <CalendarDays className="w-3 h-3" />
                  starts 8:00 AM at the office
                </span>
              </div>
            </div>
          </div>
        );
      })}

      {/* Streamdeck grid — every feature, one small tile each */}
      <div className="stagger-children">
        <TileSection label="Maintenance OS">
          {/* One door in. The Dashboard tab is the default and drills into every
              other board view, so the per-tab tiles were retired (2026-09-04). */}
          <Tile
            href="/maintenance/board"
            icon={Wrench}
            label="Maintenance"
            tone="terra"
            badge={boardKpis?.attention}
            badgeTone="red"
            title={
              boardKpis
                ? `${boardKpis.open} open work orders · ${boardKpis.attention} need attention today`
                : "Maintenance dashboard — open work by step, estimates, turns, attention"
            }
          />
          <Tile
            href="/maintenance/board?view=turnover"
            icon={DoorOpen}
            label="Turnovers"
            tone="purple"
            title="Unit turnover board"
          />
          <Tile
            href="/maintenance/board?view=vendor"
            icon={Users}
            label="Vendors"
            tone="charcoal"
            title="Vendor scoreboard"
          />
        </TileSection>

        <TileSection label="Inspections">
          <Tile
            href="/maintenance/inspections"
            icon={ClipboardCheck}
            label="Inspections"
            tone="amber"
            badge={inspectionStats?.overdue}
            badgeTone="red"
            title="Biannual inspection queue — badge is overdue count"
          />
          <Tile
            href="/maintenance/inspections/candidates"
            icon={MapPin}
            label="Candidates"
            tone="blue"
            title="Units due for inspection from the AppFolio sync"
          />
          <Tile
            href="/maintenance/inspections/routes"
            icon={Route}
            label="Route Builder"
            tone="green"
            badge={routeStats?.total_routes}
            badgeTone="green"
            title="Inspection day routes — build, optimize, dispatch"
          />
          <Tile
            href="/maintenance/inspections/import"
            icon={Upload}
            label="Import"
            tone="charcoal"
            title="CSV/XLSX inspection import"
          />
        </TileSection>

        <TileSection label="Tools">
          <Tile
            href="/maintenance/invoices"
            icon={FileText}
            label="Invoices"
            tone="terra"
            title="Generate invoices from work orders, CSVs, or scanned PDFs"
          />
          <Tile
            href="/comps"
            icon={BarChart3}
            label="Rent Comps"
            tone="blue"
            title="Central Oregon rent comparisons — AppFolio, Rentometer, HUD"
          />
          <Tile
            href="/keys"
            icon={KeyRound}
            label="Key Manager"
            tone="terra"
            title="Physical key registry and history"
          />
          <Tile
            href="/craigslist"
            icon={Megaphone}
            label="Craigslist Ads"
            tone="purple"
            badge={vacancyCount}
            badgeTone="purple"
            title="Vacant units → AI listing copy — badge is vacancy count"
          />
          <Tile
            href="/haven"
            icon={Sparkles}
            label="Haven"
            tone="blue"
            title="AI leasing pipeline, escalations, tours, and reception metrics"
          />
          <Tile
            href="/properties/map"
            icon={Home}
            label="Property Map"
            tone="green"
            title="All managed properties on a map — green active, yellow leaving management"
          />
          <Tile
            href="/reports/owner"
            icon={FileSpreadsheet}
            label="Owner Reports"
            tone="green"
            title="Owner-facing reports"
          />
          <Tile
            href="/agents"
            icon={Bot}
            label="Agents"
            tone="charcoal"
            title="Agent-OS briefs and automations"
          />
        </TileSection>

        {showAdminSection && (
          <TileSection label="Admin">
            <Tile
              href="/dashboard"
              icon={Activity}
              label="KPI Dashboard"
              tone="terra"
              title="Owner goals, delinquency, vacancy, cycle time"
            />
            <Tile
              href="/dashboard/trends"
              icon={TrendingUp}
              label="Trends"
              tone="blue"
              title="KPI trends over time"
            />
            <Tile
              href="/admin/zoom-sync"
              icon={Phone}
              label="Zoom Sync"
              tone="blue"
              title="AppFolio contacts → Zoom Phone"
            />
          </TileSection>
        )}
      </div>

      {/* Quick Stats / Status */}
      <div className="mt-8 animate-slide-up" style={{ animationDelay: "200ms" }}>
        <div className="bg-white rounded-xl border border-sand-200 p-5 shadow-card">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-2 h-2 rounded-full bg-green-400" />
              <span className="text-sm font-medium text-charcoal-900">All systems operational</span>
            </div>
            <div className="flex items-center gap-6 text-xs text-charcoal-400">
              <span>AppFolio API: <span className="text-green-600 font-medium">Connected</span></span>
              <span>Rentometer: <span className="text-green-600 font-medium">Active</span></span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
