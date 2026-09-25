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
  Percent,
  type LucideIcon,
} from "lucide-react";
import { canViewHabuDemo } from "@/lib/habu-demo-access";

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
// Compact rows (Notion-style, 2026-09-24): black icon + label, and the only
// color on the page is a red count for anything unread / needing attention.
// ────────────────────────────────────────────────

function Tile({
  href,
  icon: Icon,
  label,
  badge,
  title,
}: {
  href: string;
  icon: LucideIcon;
  label: string;
  badge?: number | null;
  title?: string;
}) {
  return (
    <Link
      href={href}
      title={title}
      className="group flex h-9 items-center gap-2.5 rounded-md px-2.5 text-[13px] text-charcoal-800 transition-colors hover:bg-sand-100"
    >
      <Icon className="h-4 w-4 flex-shrink-0 text-charcoal-500 group-hover:text-charcoal-950" />
      <span className="flex-1 truncate font-medium">{label}</span>
      {badge != null && badge > 0 && (
        <span className="flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-red-600 px-1.5 text-[10.5px] font-semibold tabular-nums text-white">
          {badge > 99 ? "99+" : badge}
        </span>
      )}
    </Link>
  );
}

function TileSection({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section className="mb-5">
      <p className="mb-1 border-b border-sand-200 px-2.5 pb-1.5 text-[11px] font-medium text-charcoal-400">
        {label}
      </p>
      <div className="grid grid-cols-1 gap-x-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">{children}</div>
    </section>
  );
}

/**
 * The tile dashboard — default content of the agent-interface canvas.
 * Moved verbatim from the old app/page.tsx home page.
 */
export function DashboardCanvas() {
  const { data: session } = useSession();
  // Admin tile section shows for every admin (staff.access_role = 'admin');
  // the admin pages stay role-gated in the proxy. HABU demo tiles inside it
  // remain Craig-only via canViewHabuDemo.
  const showAdminSection = session?.user?.isAdmin === true;
  const [inspectionStats, setInspectionStats] = useState<InspectionStats | null>(null);
  const [routeStats, setRouteStats] = useState<RouteStats | null>(null);
  const [vacancyCount, setVacancyCount] = useState<number | null>(null);
  const [boardKpis, setBoardKpis] = useState<BoardKpis | null>(null);
  const [todayRoutes, setTodayRoutes] = useState<TodayRoute[]>([]);

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

    // Fetch cached vacancy count
    fetch("/api/cached-vacancies")
      .then((r) => r.json())
      .then((data) => setVacancyCount(data.units?.length ?? 0))
      .catch(() => {});
  }, []);

  return (
    <div className="px-6 py-8 max-w-4xl mx-auto">
      {/* Header */}
      <div className="mb-7 animate-slide-up">
        <p className="text-[11px] font-medium text-charcoal-400 mb-1">HDPM OS</p>
        <h1 className="text-xl font-semibold text-charcoal-950 tracking-tight">
          {getGreeting()}
          {firstName ? `, ${firstName}` : ""}
        </h1>
      </div>

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
            className="mb-6 rounded-lg border border-sand-200 p-4"
          >
            <div>
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-3">
                  <Route className="w-4 h-4 text-charcoal-950" />
                  <div>
                    <p className="text-[11px] font-medium text-charcoal-400">
                      Today&apos;s field route
                    </p>
                    <h3 className="text-sm font-semibold text-charcoal-950">
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
                      className="text-xs font-medium text-charcoal-950 underline-offset-2 hover:underline"
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

      {/* Every feature, one compact row each */}
      <div className="stagger-children">
        <TileSection label="Maintenance OS">
          {/* One door in. The Dashboard tab is the default and drills into every
              other board view, so the per-tab tiles were retired (2026-09-04). */}
          <Tile
            href="/maintenance/board"
            icon={Wrench}
            label="Maintenance"
            badge={boardKpis?.attention}
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
            title="Unit turnover board"
          />
          <Tile
            href="/maintenance/board?view=vendor"
            icon={Users}
            label="Vendors"
            title="Vendor scoreboard"
          />
        </TileSection>

        <TileSection label="Inspections">
          <Tile
            href="/maintenance/inspections"
            icon={ClipboardCheck}
            label="Inspections"
            badge={inspectionStats?.overdue}
            title="Biannual inspection queue — badge is overdue count"
          />
          <Tile
            href="/maintenance/inspections/candidates"
            icon={MapPin}
            label="Candidates"
            title="Units due for inspection from the AppFolio sync"
          />
          <Tile
            href="/maintenance/inspections/routes"
            icon={Route}
            label="Route Builder"
            badge={routeStats?.total_routes}
            title="Inspection day routes — build, optimize, dispatch"
          />
          <Tile
            href="/maintenance/inspections/import"
            icon={Upload}
            label="Import"
            title="CSV/XLSX inspection import"
          />
        </TileSection>

        <TileSection label="Tools">
          <Tile
            href="/maintenance/invoices"
            icon={FileText}
            label="Work & Billing"
            title="Manage work orders, estimates, approvals, invoices, and reconciliation"
          />
          <Tile
            href="/comps"
            icon={BarChart3}
            label="Rent Comps"
            title="Central Oregon rent comparisons — AppFolio, Rentometer, HUD"
          />
          <Tile
            href="/keys"
            icon={KeyRound}
            label="Key Manager"
            title="Physical key registry and history"
          />
          <Tile
            href="/craigslist"
            icon={Megaphone}
            label="Craigslist Ads"
            badge={vacancyCount}
            title="Vacant units → AI listing copy — badge is vacancy count"
          />
          <Tile
            href="/haven"
            icon={Sparkles}
            label="Haven"
            title="AI leasing pipeline, escalations, tours, and reception metrics"
          />
          <Tile
            href="/properties/map"
            icon={Home}
            label="Property Map"
            title="All managed properties on a map — green active, yellow leaving management"
          />
          <Tile
            href="/reports/owner"
            icon={FileSpreadsheet}
            label="Owner Reports"
            title="Owner-facing reports"
          />
          <Tile
            href="/agents"
            icon={Bot}
            label="Agents"
            title="Agent-OS briefs and automations"
          />
        </TileSection>

        {showAdminSection && (
          <TileSection label="Admin">
            {canViewHabuDemo(session?.user) && (
              <>
                <Tile href="/admin/habu-paper" icon={FileText} label="Paper Workflows" title="Full workflow forms and personal process inbox" />
                <Tile href="/admin/habu-demo" icon={Route} label="HABU Demo" title="Office jackets and subway routing map" />
              </>
            )}
            <Tile
              href="/dashboard"
              icon={Activity}
              label="KPI Dashboard"
              title="Owner goals, delinquency, vacancy, cycle time"
            />
            <Tile
              href="/admin/fee-management"
              icon={Percent}
              label="Fee Management"
              title="Fee Index and the owner fee increase campaign"
            />
            <Tile
              href="/dashboard/trends"
              icon={TrendingUp}
              label="Trends"
              title="KPI trends over time"
            />
            <Tile
              href="/admin/zoom-sync"
              icon={Phone}
              label="Zoom Sync"
              title="AppFolio contacts → Zoom Phone"
            />
          </TileSection>
        )}
      </div>

      {/* Status */}
      <div className="mt-8 flex items-center gap-2 border-t border-sand-200 pt-3 text-[11.5px] text-charcoal-400 animate-slide-up">
        <span className="h-1.5 w-1.5 rounded-full bg-charcoal-950" />
        <span>All systems operational</span>
        <span className="text-charcoal-300">·</span>
        <span>AppFolio connected</span>
        <span className="text-charcoal-300">·</span>
        <span>Rentometer active</span>
      </div>
    </div>
  );
}
