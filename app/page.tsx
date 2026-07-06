"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import Link from "next/link";
import {
  FileText,
  BarChart3,
  ArrowUpRight,
  Zap,
  TrendingUp,
  Clock,
  ClipboardCheck,
  Route,
  MapPin,
  AlertTriangle,
  CalendarDays,
  Car,
  Megaphone,
  Home as HomeIcon,
  Wrench,
  Activity,
  Phone,
} from "lucide-react";

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
  draft: number;
  optimized: number;
  dispatched: number;
  total_stops: number;
}

interface BoardKpis {
  open: number;
  pastDue: number;
  aging30Plus: number;
  p1ThisWeek: number;
}

export default function Home() {
  const { data: session } = useSession();
  const isAdmin = session?.user?.isAdmin === true;
  const [inspectionStats, setInspectionStats] = useState<InspectionStats | null>(null);
  const [routeStats, setRouteStats] = useState<RouteStats | null>(null);
  const [vacancyCount, setVacancyCount] = useState<number | null>(null);
  const [boardKpis, setBoardKpis] = useState<BoardKpis | null>(null);

  useEffect(() => {
    // Fetch maintenance board KPIs
    fetch("/api/maintenance/board")
      .then((r) => r.json())
      .then((data) => setBoardKpis(data.kpis ?? null))
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
          draft: routes.filter((r: { status: string }) => r.status === "draft").length,
          optimized: routes.filter((r: { status: string }) => r.status === "optimized").length,
          dispatched: routes.filter((r: { status: string }) => r.status === "dispatched").length,
          total_stops: routes.reduce((sum: number, r: { total_stops?: number }) => sum + (r.total_stops || 0), 0),
        });
      })
      .catch(() => {});

    // Fetch cached vacancy count
    fetch("/api/cached-vacancies")
      .then((r) => r.json())
      .then((data) => setVacancyCount(data.units?.length ?? 0))
      .catch(() => {});
  }, []);

  return (
    <>
      <div className="px-8 py-8 max-w-5xl">
        {/* Header */}
        <div className="mb-8 animate-slide-up">
          <p className="text-xs font-semibold text-terra-500 uppercase tracking-widest mb-1">
            Dashboard
          </p>
          <h1 className="text-2xl font-bold text-charcoal-900 tracking-tight">
            {getGreeting()}
          </h1>
          <p className="text-sm text-charcoal-400 mt-1">
            Your automation tools are ready.
          </p>
        </div>

        {/* Maintenance OS — flagship */}
        <Link
          href="/maintenance/board"
          className="group mb-5 block relative overflow-hidden rounded-xl border border-terra-200 bg-gradient-to-br from-terra-500 to-terra-700 p-6 shadow-card hover:shadow-card-hover transition-all duration-200 hover:-translate-y-0.5"
        >
          <div className="absolute top-0 right-0 w-48 h-48 bg-white/10 rounded-bl-[120px] -mr-6 -mt-6" />
          <div className="relative">
            <div className="flex items-start justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 bg-white/20 rounded-xl flex items-center justify-center">
                  <Wrench className="w-5 h-5 text-white" />
                </div>
                <div>
                  <p className="text-[11px] font-semibold text-white/70 uppercase tracking-widest">
                    Maintenance OS
                  </p>
                  <h3 className="text-lg font-semibold text-white">Work Order Board</h3>
                </div>
              </div>
              <ArrowUpRight className="w-5 h-5 text-white/60 group-hover:text-white group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-all duration-200" />
            </div>
            <p className="text-sm text-white/80 leading-relaxed max-w-2xl">
              Triage, assign, and drive every AppFolio work order to completion — with tripwires,
              vendor scoreboards, and aging alerts.
            </p>
            {boardKpis && (
              <div className="mt-5 flex flex-wrap items-center gap-6">
                <div className="flex items-center gap-2 text-white">
                  <span className="text-xl font-bold">{boardKpis.open}</span>
                  <span className="text-xs text-white/70">open</span>
                </div>
                {boardKpis.pastDue > 0 && (
                  <div className="flex items-center gap-1.5 text-sm text-white font-medium">
                    <AlertTriangle className="w-3.5 h-3.5" />
                    <span>{boardKpis.pastDue} past due</span>
                  </div>
                )}
                {boardKpis.aging30Plus > 0 && (
                  <div className="flex items-center gap-1.5 text-sm text-white/80">
                    <Clock className="w-3.5 h-3.5" />
                    <span>{boardKpis.aging30Plus} aging 30+ days</span>
                  </div>
                )}
                {boardKpis.p1ThisWeek > 0 && (
                  <div className="flex items-center gap-1.5 text-sm text-white/80">
                    <Zap className="w-3.5 h-3.5" />
                    <span>{boardKpis.p1ThisWeek} P1 this week</span>
                  </div>
                )}
              </div>
            )}
          </div>
        </Link>

        {/* Tool Cards */}
        <div className="grid lg:grid-cols-2 gap-5 stagger-children">
          {/* Inspections */}
          <Link
            href="/maintenance/inspections"
            className="group bg-white rounded-xl border border-sand-200 p-6 shadow-card hover:shadow-card-hover transition-all duration-200 hover:-translate-y-0.5 block relative overflow-hidden"
          >
            <div className="absolute top-0 right-0 w-32 h-32 bg-amber-50 rounded-bl-[80px] -mr-4 -mt-4 opacity-60 group-hover:opacity-100 transition-opacity" />
            <div className="relative">
              <div className="flex items-start justify-between mb-5">
                <div className="w-11 h-11 bg-amber-100 rounded-xl flex items-center justify-center">
                  <ClipboardCheck className="w-5 h-5 text-amber-600" />
                </div>
                <ArrowUpRight className="w-4 h-4 text-charcoal-300 group-hover:text-amber-500 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-all duration-200" />
              </div>
              <h3 className="text-base font-semibold text-charcoal-900 mb-1.5">
                Inspections
              </h3>
              <p className="text-sm text-charcoal-400 leading-relaxed">
                Manage biannual property inspections, track due dates, and build optimized routes.
              </p>
              {inspectionStats && (
                <div className="mt-4 flex items-center gap-4">
                  <div className="flex items-center gap-1.5 text-xs text-charcoal-400">
                    <MapPin className="w-3 h-3" />
                    <span>{inspectionStats.total} total</span>
                  </div>
                  {inspectionStats.overdue > 0 && (
                    <div className="flex items-center gap-1.5 text-xs text-red-500 font-medium">
                      <AlertTriangle className="w-3 h-3" />
                      <span>{inspectionStats.overdue} overdue</span>
                    </div>
                  )}
                  {inspectionStats.this_week > 0 && (
                    <div className="flex items-center gap-1.5 text-xs text-amber-500">
                      <Clock className="w-3 h-3" />
                      <span>{inspectionStats.this_week} this week</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          </Link>

          {/* Route Builder */}
          <Link
            href="/maintenance/inspections/routes"
            className="group bg-white rounded-xl border border-sand-200 p-6 shadow-card hover:shadow-card-hover transition-all duration-200 hover:-translate-y-0.5 block relative overflow-hidden"
          >
            <div className="absolute top-0 right-0 w-32 h-32 bg-green-50 rounded-bl-[80px] -mr-4 -mt-4 opacity-60 group-hover:opacity-100 transition-opacity" />
            <div className="relative">
              <div className="flex items-start justify-between mb-5">
                <div className="w-11 h-11 bg-green-100 rounded-xl flex items-center justify-center">
                  <Route className="w-5 h-5 text-green-600" />
                </div>
                <ArrowUpRight className="w-4 h-4 text-charcoal-300 group-hover:text-green-500 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-all duration-200" />
              </div>
              <h3 className="text-base font-semibold text-charcoal-900 mb-1.5">
                Route Builder
              </h3>
              <p className="text-sm text-charcoal-400 leading-relaxed">
                Schedule inspection routes, optimize driving paths, and dispatch to inspectors.
              </p>
              {routeStats && (
                <div className="mt-4 flex items-center gap-4">
                  {routeStats.total_routes > 0 ? (
                    <>
                      <div className="flex items-center gap-1.5 text-xs text-charcoal-400">
                        <CalendarDays className="w-3 h-3" />
                        <span>{routeStats.total_routes} routes</span>
                      </div>
                      <div className="flex items-center gap-1.5 text-xs text-charcoal-400">
                        <Car className="w-3 h-3" />
                        <span>{routeStats.total_stops} stops</span>
                      </div>
                      {routeStats.dispatched > 0 && (
                        <div className="flex items-center gap-1.5 text-xs text-green-500 font-medium">
                          <Zap className="w-3 h-3" />
                          <span>{routeStats.dispatched} dispatched</span>
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="flex items-center gap-1.5 text-xs text-charcoal-300">
                      <CalendarDays className="w-3 h-3" />
                      <span>No routes scheduled</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          </Link>

          {/* Invoice Generator */}
          <Link
            href="/maintenance/invoices"
            className="group bg-white rounded-xl border border-sand-200 p-6 shadow-card hover:shadow-card-hover transition-all duration-200 hover:-translate-y-0.5 block relative overflow-hidden"
          >
            <div className="absolute top-0 right-0 w-32 h-32 bg-terra-50 rounded-bl-[80px] -mr-4 -mt-4 opacity-60 group-hover:opacity-100 transition-opacity" />
            <div className="relative">
              <div className="flex items-start justify-between mb-5">
                <div className="w-11 h-11 bg-terra-100 rounded-xl flex items-center justify-center">
                  <FileText className="w-5 h-5 text-terra-600" />
                </div>
                <ArrowUpRight className="w-4 h-4 text-charcoal-300 group-hover:text-terra-500 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-all duration-200" />
              </div>
              <h3 className="text-base font-semibold text-charcoal-900 mb-1.5">
                Invoice Generator
              </h3>
              <p className="text-sm text-charcoal-400 leading-relaxed">
                Generate invoices from AppFolio work orders, CSV uploads, or scanned PDFs.
              </p>
              <div className="mt-4 flex items-center gap-4">
                <div className="flex items-center gap-1.5 text-xs text-charcoal-300">
                  <Zap className="w-3 h-3" />
                  <span>Auto-extract</span>
                </div>
                <div className="flex items-center gap-1.5 text-xs text-charcoal-300">
                  <Clock className="w-3 h-3" />
                  <span>PDF export</span>
                </div>
              </div>
            </div>
          </Link>

          {/* Rent Comps */}
          <Link
            href="/comps"
            className="group bg-white rounded-xl border border-sand-200 p-6 shadow-card hover:shadow-card-hover transition-all duration-200 hover:-translate-y-0.5 block relative overflow-hidden"
          >
            <div className="absolute top-0 right-0 w-32 h-32 bg-blue-50 rounded-bl-[80px] -mr-4 -mt-4 opacity-60 group-hover:opacity-100 transition-opacity" />
            <div className="relative">
              <div className="flex items-start justify-between mb-5">
                <div className="w-11 h-11 bg-blue-100 rounded-xl flex items-center justify-center">
                  <BarChart3 className="w-5 h-5 text-blue-600" />
                </div>
                <ArrowUpRight className="w-4 h-4 text-charcoal-300 group-hover:text-blue-500 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-all duration-200" />
              </div>
              <h3 className="text-base font-semibold text-charcoal-900 mb-1.5">
                Rent Comps
              </h3>
              <p className="text-sm text-charcoal-400 leading-relaxed">
                Compare rental rates across Central Oregon with AppFolio, Rentometer, and HUD FMR data.
              </p>
              <div className="mt-4 flex items-center gap-4">
                <div className="flex items-center gap-1.5 text-xs text-charcoal-300">
                  <TrendingUp className="w-3 h-3" />
                  <span>Market analysis</span>
                </div>
                <div className="flex items-center gap-1.5 text-xs text-charcoal-300">
                  <BarChart3 className="w-3 h-3" />
                  <span>PDF reports</span>
                </div>
              </div>
            </div>
          </Link>

          {/* Craigslist Ad Creator */}
          <Link
            href="/craigslist"
            className="group bg-white rounded-xl border border-sand-200 p-6 shadow-card hover:shadow-card-hover transition-all duration-200 hover:-translate-y-0.5 block relative overflow-hidden"
          >
            <div className="absolute top-0 right-0 w-32 h-32 bg-purple-50 rounded-bl-[80px] -mr-4 -mt-4 opacity-60 group-hover:opacity-100 transition-opacity" />
            <div className="relative">
              <div className="flex items-start justify-between mb-5">
                <div className="w-11 h-11 bg-purple-100 rounded-xl flex items-center justify-center">
                  <Megaphone className="w-5 h-5 text-purple-600" />
                </div>
                <ArrowUpRight className="w-4 h-4 text-charcoal-300 group-hover:text-purple-500 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-all duration-200" />
              </div>
              <h3 className="text-base font-semibold text-charcoal-900 mb-1.5">
                Craigslist Ad Creator
              </h3>
              <p className="text-sm text-charcoal-400 leading-relaxed">
                Pull vacant units from AppFolio, generate HTML-formatted listing copy, and post to Craigslist.
              </p>
              <div className="mt-4 flex items-center gap-4">
                {vacancyCount !== null && vacancyCount > 0 ? (
                  <div className="flex items-center gap-1.5 text-xs text-purple-500 font-medium">
                    <HomeIcon className="w-3 h-3" />
                    <span>{vacancyCount} vacant units</span>
                  </div>
                ) : (
                  <div className="flex items-center gap-1.5 text-xs text-charcoal-300">
                    <HomeIcon className="w-3 h-3" />
                    <span>Sync to pull vacancies</span>
                  </div>
                )}
                <div className="flex items-center gap-1.5 text-xs text-charcoal-300">
                  <Zap className="w-3 h-3" />
                  <span>AI-generated copy</span>
                </div>
              </div>
            </div>
          </Link>

          {/* KPI Dashboard (admin) */}
          {isAdmin && (
            <Link
              href="/dashboard"
              className="group bg-white rounded-xl border border-sand-200 p-6 shadow-card hover:shadow-card-hover transition-all duration-200 hover:-translate-y-0.5 block relative overflow-hidden"
            >
              <div className="absolute top-0 right-0 w-32 h-32 bg-terra-50 rounded-bl-[80px] -mr-4 -mt-4 opacity-60 group-hover:opacity-100 transition-opacity" />
              <div className="relative">
                <div className="flex items-start justify-between mb-5">
                  <div className="w-11 h-11 bg-terra-100 rounded-xl flex items-center justify-center">
                    <Activity className="w-5 h-5 text-terra-600" />
                  </div>
                  <ArrowUpRight className="w-4 h-4 text-charcoal-300 group-hover:text-terra-500 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-all duration-200" />
                </div>
                <h3 className="text-base font-semibold text-charcoal-900 mb-1.5">
                  KPI Dashboard
                </h3>
                <p className="text-sm text-charcoal-400 leading-relaxed">
                  Track owner goals, delinquency, vacancy, work order cycle time, and maintenance economics.
                </p>
                <div className="mt-4 flex items-center gap-4">
                  <div className="flex items-center gap-1.5 text-xs text-charcoal-300">
                    <TrendingUp className="w-3 h-3" />
                    <span>Business metrics</span>
                  </div>
                  <div className="flex items-center gap-1.5 text-xs text-charcoal-300">
                    <BarChart3 className="w-3 h-3" />
                    <span>Trends</span>
                  </div>
                </div>
              </div>
            </Link>
          )}

          {/* Zoom Sync (admin) */}
          {isAdmin && (
            <Link
              href="/admin/zoom-sync"
              className="group bg-white rounded-xl border border-sand-200 p-6 shadow-card hover:shadow-card-hover transition-all duration-200 hover:-translate-y-0.5 block relative overflow-hidden"
            >
              <div className="absolute top-0 right-0 w-32 h-32 bg-blue-50 rounded-bl-[80px] -mr-4 -mt-4 opacity-60 group-hover:opacity-100 transition-opacity" />
              <div className="relative">
                <div className="flex items-start justify-between mb-5">
                  <div className="w-11 h-11 bg-blue-100 rounded-xl flex items-center justify-center">
                    <Phone className="w-5 h-5 text-blue-600" />
                  </div>
                  <ArrowUpRight className="w-4 h-4 text-charcoal-300 group-hover:text-blue-500 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-all duration-200" />
                </div>
                <h3 className="text-base font-semibold text-charcoal-900 mb-1.5">
                  Zoom Sync
                </h3>
                <p className="text-sm text-charcoal-400 leading-relaxed">
                  Sync AppFolio tenant and vendor contacts into Zoom Phone for click-to-call and caller ID.
                </p>
                <div className="mt-4 flex items-center gap-4">
                  <div className="flex items-center gap-1.5 text-xs text-charcoal-300">
                    <Phone className="w-3 h-3" />
                    <span>Contact sync</span>
                  </div>
                </div>
              </div>
            </Link>
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
    </>
  );
}
