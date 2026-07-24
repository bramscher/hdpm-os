"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  RefreshCw,
  MapPin,
  Calendar,
  CalendarDays,
  Clock,
  Car,
  Navigation,
  ArrowLeft,
  Play,
  Route,
  X,
  User,
  Hash,
  LayoutGrid,
  List,
  Search,
  CheckSquare,
  Square,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { StaffSelect, DEFAULT_INSPECTOR } from "@/components/StaffSelect";
import { RouteCalendar } from "./route-calendar";

// ────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────

interface InspectionRoute {
  id: string;
  route_date: string;
  assigned_to: string | null;
  total_stops: number;
  total_drive_minutes: number | null;
  total_service_minutes: number | null;
  total_estimated_minutes: number | null;
  status: string;
  notes: string | null;
  created_at: string;
}

interface PickableInspection {
  id: string;
  property_name: string;
  address: string;
  city: string;
  due_date: string | null;
  status: string;
}

const ROUTE_STATUS_BADGE: Record<string, string> = {
  draft: "bg-charcoal-100 text-charcoal-700",
  optimized: "bg-blue-100 text-blue-700",
  dispatched: "bg-amber-100 text-amber-700",
  completed: "bg-green-100 text-green-700",
};

// ────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────

/** Earliest date a route can be scheduled (7 days from today) */
function getMinRouteDate(): string {
  const d = new Date();
  d.setDate(d.getDate() + 7);
  return d.toISOString().split("T")[0];
}

/** Default route date: next Monday that is at least 7 days out */
function getDefaultRouteDate(): string {
  const minDate = new Date(getMinRouteDate());
  const day = minDate.getDay(); // 0=Sun, 1=Mon, ...
  // Advance to next Monday (or stay if already Monday)
  const diff = day === 0 ? 1 : day === 1 ? 0 : (8 - day);
  minDate.setDate(minDate.getDate() + diff);
  return minDate.toISOString().split("T")[0];
}

function getNextFriday(): string {
  const monday = new Date(getDefaultRouteDate());
  const d = new Date(monday);
  d.setDate(d.getDate() + 4);
  return d.toISOString().split("T")[0];
}

function formatRouteDate(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00");
  return d.toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
  });
}

function formatStatus(status: string): string {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

// ────────────────────────────────────────────────
// Component
// ────────────────────────────────────────────────

export function RouteBuilder() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [routes, setRoutes] = useState<InspectionRoute[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewStyle, setViewStyle] = useState<"list" | "calendar">("calendar");

  // Generate modal state
  const [showModal, setShowModal] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [genSuccess, setGenSuccess] = useState<number | null>(null);
  const [genError, setGenError] = useState<string | null>(null);
  const [routeDate, setRouteDate] = useState(getDefaultRouteDate);
  const [assignee, setAssignee] = useState(DEFAULT_INSPECTOR);
  const [maxStops, setMaxStops] = useState(10);

  // Manual pick mode state
  const [pickMode, setPickMode] = useState<"auto" | "pick">("auto");
  const [availableInspections, setAvailableInspections] = useState<PickableInspection[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [pickSearch, setPickSearch] = useState("");
  const [loadingInspections, setLoadingInspections] = useState(false);

  // Fetch available inspections for pick mode
  const fetchAvailableInspections = useCallback(async () => {
    setLoadingInspections(true);
    try {
      const res = await fetch("/api/inspections?page_size=2000");
      if (!res.ok) return;
      const data = await res.json();
      const inspections = (data.inspections || [])
        .filter((i: Record<string, string>) => ["imported", "validated", "queued"].includes(i.status))
        .map((i: Record<string, unknown>) => ({
          id: i.id as string,
          property_name: (i.name as string) || (i.property_name as string) || "",
          address: (i.address_1 as string) || "",
          city: (i.city as string) || "",
          due_date: (i.due_date as string) || null,
          status: (i.status as string) || "",
        }));
      setAvailableInspections(inspections);
    } catch (err) {
      console.error("Fetch inspections error:", err);
    } finally {
      setLoadingInspections(false);
    }
  }, []);

  // Check URL params for pre-selected inspection IDs (from dashboard)
  useEffect(() => {
    const idsParam = searchParams.get("ids");
    if (idsParam) {
      const ids = idsParam.split(",").filter(Boolean);
      if (ids.length > 0) {
        setSelectedIds(new Set(ids));
        setPickMode("pick");
        setShowModal(true);
        fetchAvailableInspections();
        // Clean up URL
        router.replace("/maintenance/inspections/routes", { scroll: false });
      }
    }
  }, [searchParams, fetchAvailableInspections, router]);

  // Fetch inspections when switching to pick mode
  useEffect(() => {
    if (pickMode === "pick" && availableInspections.length === 0) {
      fetchAvailableInspections();
    }
  }, [pickMode, availableInspections.length, fetchAvailableInspections]);

  // ── Fetch routes ──
  const fetchRoutes = useCallback(async () => {
    try {
      const res = await fetch("/api/inspections/routes");
      if (!res.ok) throw new Error("Failed to fetch routes");
      const data = await res.json();
      setRoutes(data.routes || []);
    } catch (err) {
      console.error("Fetch routes error:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRoutes();
  }, [fetchRoutes]);

  // ── Generate routes ──
  const handleGenerate = async () => {
    if (pickMode === "pick" && selectedIds.size === 0) {
      setGenError("Select at least one property");
      return;
    }
    setGenerating(true);
    setGenSuccess(null);
    setGenError(null);
    try {
      const payload: Record<string, unknown> = {
        date_range_start: routeDate,
        date_range_end: routeDate,
        assigned_to: assignee || undefined,
      };
      if (pickMode === "pick") {
        payload.inspection_ids = [...selectedIds];
      } else {
        payload.max_stops_per_route = maxStops;
      }

      const res = await fetch("/api/inspections/routes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Generation failed");
      }
      const data = await res.json();
      setGenSuccess(data.routes_created ?? data.routes?.length ?? 0);
      await fetchRoutes();
    } catch (err) {
      console.error("Generate routes error:", err);
      setGenError(err instanceof Error ? err.message : "Generation failed");
    } finally {
      setGenerating(false);
    }
  };

  const resetModal = () => {
    setShowModal(false);
    setGenSuccess(null);
    setGenError(null);
    setRouteDate(getDefaultRouteDate());
    setAssignee(DEFAULT_INSPECTOR);
    setMaxStops(10);
    setPickMode("auto");
    setSelectedIds(new Set());
    setPickSearch("");
  };

  // Pick mode helpers
  const togglePickId = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const filteredInspections = availableInspections.filter((i) => {
    if (!pickSearch) return true;
    const q = pickSearch.toLowerCase();
    return (
      i.property_name.toLowerCase().includes(q) ||
      i.address.toLowerCase().includes(q) ||
      i.city.toLowerCase().includes(q)
    );
  });

  // ────────────────────────────────────────────────
  // Render
  // ────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <RefreshCw className="w-6 h-6 animate-spin text-charcoal-400" />
        <span className="ml-3 text-charcoal-500">Loading routes...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* ── Header ── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-charcoal-900">Route Builder</h1>
          <p className="text-charcoal-500 text-sm mt-1">
            {routes.length} route{routes.length !== 1 ? "s" : ""}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {/* View toggle */}
          <div className="flex rounded-lg border border-charcoal-200 overflow-hidden">
            <button
              onClick={() => setViewStyle("calendar")}
              className={cn(
                "flex items-center gap-1.5 px-3 py-2 text-xs font-medium transition-colors",
                viewStyle === "calendar"
                  ? "bg-charcoal-900 text-white"
                  : "bg-white text-charcoal-600 hover:bg-charcoal-50"
              )}
            >
              <CalendarDays className="w-3.5 h-3.5" />
              Calendar
            </button>
            <button
              onClick={() => setViewStyle("list")}
              className={cn(
                "flex items-center gap-1.5 px-3 py-2 text-xs font-medium transition-colors",
                viewStyle === "list"
                  ? "bg-charcoal-900 text-white"
                  : "bg-white text-charcoal-600 hover:bg-charcoal-50"
              )}
            >
              <List className="w-3.5 h-3.5" />
              List
            </button>
          </div>

          <Link
            href="/maintenance/inspections"
            className={cn(
              "flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors",
              "border border-charcoal-300 text-charcoal-700 hover:bg-charcoal-50"
            )}
          >
            <ArrowLeft className="w-4 h-4" />
            Queue
          </Link>
          <button
            onClick={() => setShowModal(true)}
            className={cn(
              "flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors",
              "bg-terra-500 text-white hover:bg-terra-600"
            )}
          >
            <Play className="w-4 h-4" />
            Schedule Route
          </button>
        </div>
      </div>

      {/* ── Calendar View ── */}
      {viewStyle === "calendar" && (
        <RouteCalendar
          routes={routes}
          onCreateRoute={(date) => {
            const minDate = getMinRouteDate();
            setRouteDate(date < minDate ? minDate : date);
            setShowModal(true);
          }}
          onDeleteRoute={async (routeId) => {
            try {
              const res = await fetch(`/api/inspections/routes/${routeId}`, { method: "DELETE" });
              if (!res.ok) {
                const body = await res.json().catch(() => ({}));
                alert(`Delete failed: ${body.error || res.statusText}`);
                return;
              }
              await fetchRoutes();
            } catch (err) {
              console.error("Delete route error:", err);
              alert("Failed to delete route");
            }
          }}
          onClearDay={async (date) => {
            try {
              const res = await fetch("/api/inspections/routes/bulk-delete", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ date }),
              });
              const body = await res.json();
              if (!res.ok) {
                alert(`Clear day failed: ${body.error || res.statusText}`);
                return;
              }
              alert(body.message);
              await fetchRoutes();
            } catch (err) {
              console.error("Clear day error:", err);
              alert("Failed to clear day");
            }
          }}
        />
      )}

      {/* ── List View ── */}
      {viewStyle === "list" && (
        <>
          {routes.length === 0 ? (
            <div className="text-center py-16 text-charcoal-400">
              <Route className="w-10 h-10 mx-auto mb-3 text-charcoal-300" />
              <p className="font-medium">No routes yet</p>
              <p className="text-sm mt-1">Generate routes to get started.</p>
              <button
                onClick={() => setShowModal(true)}
                className="inline-flex items-center gap-2 mt-4 px-4 py-2 rounded-lg text-sm font-medium bg-terra-500 text-white hover:bg-terra-600 transition-colors"
              >
                <Play className="w-4 h-4" />
                Schedule Route
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {routes.map((route) => (
                <button
                  key={route.id}
                  onClick={() => router.push(`/maintenance/inspections/routes/${route.id}`)}
                  className={cn(
                    "bg-white rounded-lg border border-charcoal-200 p-5 text-left",
                    "hover:border-terra-300 hover:shadow-md transition-all duration-150",
                    "focus:outline-none focus:ring-2 focus:ring-terra-400 focus:border-transparent"
                  )}
                >
                  <div className="flex items-start justify-between gap-2 mb-3">
                    <h3 className="font-semibold text-charcoal-900 leading-tight">
                      {route.notes || "Route"}
                    </h3>
                    <span
                      className={cn(
                        "inline-flex px-2 py-0.5 rounded-full text-xs font-medium flex-shrink-0",
                        ROUTE_STATUS_BADGE[route.status] ?? "bg-charcoal-100 text-charcoal-600"
                      )}
                    >
                      {formatStatus(route.status)}
                    </span>
                  </div>

                  <div className="space-y-2 text-sm">
                    <div className="flex items-center gap-2 text-charcoal-600">
                      <Calendar className="w-3.5 h-3.5 text-charcoal-400" />
                      <span>{formatRouteDate(route.route_date)}</span>
                    </div>

                    <div className="flex items-center gap-4">
                      <div className="flex items-center gap-2 text-charcoal-600">
                        <MapPin className="w-3.5 h-3.5 text-charcoal-400" />
                        <span>
                          {route.total_stops} stop{route.total_stops !== 1 ? "s" : ""}
                        </span>
                      </div>
                      {route.total_drive_minutes != null && (
                        <div className="flex items-center gap-2 text-charcoal-600">
                          <Car className="w-3.5 h-3.5 text-charcoal-400" />
                          <span>~{route.total_drive_minutes} min drive</span>
                        </div>
                      )}
                    </div>

                    {route.assigned_to && (
                      <div className="flex items-center gap-2 text-charcoal-500">
                        <User className="w-3.5 h-3.5 text-charcoal-400" />
                        <span>{route.assigned_to}</span>
                      </div>
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}
        </>
      )}

      {/* ── Generate Routes Modal ── */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            onClick={resetModal}
          />

          {/* Modal */}
          <div className={cn(
            "relative bg-white rounded-xl shadow-xl mx-4 p-6",
            pickMode === "pick" ? "w-full max-w-2xl" : "w-full max-w-md"
          )}>
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-lg font-bold text-charcoal-900">Schedule Route</h2>
              <button
                onClick={resetModal}
                className="p-1.5 rounded-md text-charcoal-400 hover:text-charcoal-900 hover:bg-charcoal-100 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {genSuccess !== null ? (
              <div className="text-center py-6">
                <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-green-100 flex items-center justify-center">
                  <Navigation className="w-6 h-6 text-green-600" />
                </div>
                <p className="font-semibold text-charcoal-900">
                  {genSuccess} route{genSuccess !== 1 ? "s" : ""} created
                </p>
                <p className="text-sm text-charcoal-500 mt-1">
                  Routes are ready to review and optimize.
                </p>
                <button
                  onClick={resetModal}
                  className="mt-4 px-4 py-2 rounded-lg text-sm font-medium bg-terra-500 text-white hover:bg-terra-600 transition-colors"
                >
                  Done
                </button>
              </div>
            ) : (
              <div className="space-y-4">
                {/* Route Date */}
                <div>
                  <label className="block text-xs font-medium text-charcoal-600 mb-1">
                    Route Date
                  </label>
                  <div className="relative">
                    <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-charcoal-400 pointer-events-none" />
                    <input
                      type="date"
                      value={routeDate}
                      min={getMinRouteDate()}
                      onChange={(e) => setRouteDate(e.target.value)}
                      className="w-full bg-white border border-charcoal-300 rounded-lg pl-9 pr-3 py-2 text-sm text-charcoal-700 focus:outline-none focus:ring-2 focus:ring-terra-400 focus:border-transparent"
                    />
                  </div>
                  <p className="text-xs text-charcoal-400 mt-1">
                    Must be at least 7 days from today for tenant notification.
                  </p>
                </div>

                {/* Assignee */}
                <div>
                  <label className="block text-xs font-medium text-charcoal-600 mb-1">
                    Assignee
                  </label>
                  <div className="relative">
                    <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-charcoal-400 pointer-events-none" />
                    <StaffSelect
                      value={assignee}
                      onChange={setAssignee}
                      className="w-full appearance-none bg-white border border-charcoal-300 rounded-lg pl-9 pr-8 py-2 text-sm text-charcoal-700 focus:outline-none focus:ring-2 focus:ring-terra-400 focus:border-transparent"
                    />
                  </div>
                </div>

                {/* Mode toggle */}
                <div>
                  <label className="block text-xs font-medium text-charcoal-600 mb-1.5">
                    Selection Mode
                  </label>
                  <div className="flex rounded-lg border border-charcoal-200 overflow-hidden">
                    <button
                      type="button"
                      onClick={() => setPickMode("auto")}
                      className={cn(
                        "flex-1 px-3 py-1.5 text-xs font-medium transition-colors",
                        pickMode === "auto"
                          ? "bg-terra-500 text-white"
                          : "bg-white text-charcoal-600 hover:bg-charcoal-50"
                      )}
                    >
                      Auto-select
                    </button>
                    <button
                      type="button"
                      onClick={() => setPickMode("pick")}
                      className={cn(
                        "flex-1 px-3 py-1.5 text-xs font-medium transition-colors",
                        pickMode === "pick"
                          ? "bg-terra-500 text-white"
                          : "bg-white text-charcoal-600 hover:bg-charcoal-50"
                      )}
                    >
                      Pick Properties
                    </button>
                  </div>
                </div>

                {/* Auto mode: Max stops slider */}
                {pickMode === "auto" && (
                  <div>
                    <label className="block text-xs font-medium text-charcoal-600 mb-1">
                      Stops in Route: {maxStops}
                    </label>
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-charcoal-400">5</span>
                      <input
                        type="range"
                        min={5}
                        max={25}
                        value={maxStops}
                        onChange={(e) => setMaxStops(Number(e.target.value))}
                        className="flex-1 accent-terra-500"
                      />
                      <span className="text-xs text-charcoal-400">25</span>
                    </div>
                  </div>
                )}

                {/* Pick mode: Property search + checklist */}
                {pickMode === "pick" && (
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="text-xs font-medium text-charcoal-600">
                        Select Properties
                      </label>
                      <span className="text-xs text-terra-600 font-medium">
                        {selectedIds.size} selected
                      </span>
                    </div>
                    {/* Search */}
                    <div className="relative mb-2">
                      <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-charcoal-400 pointer-events-none" />
                      <input
                        type="text"
                        placeholder="Search by name, address, or city..."
                        value={pickSearch}
                        onChange={(e) => setPickSearch(e.target.value)}
                        className="w-full bg-white border border-charcoal-200 rounded-lg pl-8 pr-3 py-1.5 text-xs text-charcoal-700 focus:outline-none focus:ring-2 focus:ring-terra-400 focus:border-transparent"
                      />
                    </div>
                    {/* Scrollable list */}
                    <div className="border border-charcoal-200 rounded-lg max-h-64 overflow-y-auto divide-y divide-charcoal-100">
                      {loadingInspections ? (
                        <div className="p-4 text-center text-xs text-charcoal-400">
                          <RefreshCw className="w-4 h-4 animate-spin mx-auto mb-1" />
                          Loading properties...
                        </div>
                      ) : filteredInspections.length === 0 ? (
                        <div className="p-4 text-center text-xs text-charcoal-400">
                          {pickSearch ? "No properties match your search" : "No eligible inspections found"}
                        </div>
                      ) : (
                        filteredInspections.map((insp) => (
                          <button
                            key={insp.id}
                            type="button"
                            onClick={() => togglePickId(insp.id)}
                            className={cn(
                              "w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-charcoal-50",
                              selectedIds.has(insp.id) && "bg-terra-50"
                            )}
                          >
                            {selectedIds.has(insp.id) ? (
                              <CheckSquare className="w-4 h-4 text-terra-500 flex-shrink-0" />
                            ) : (
                              <Square className="w-4 h-4 text-charcoal-300 flex-shrink-0" />
                            )}
                            <div className="min-w-0 flex-1">
                              <div className="text-xs font-medium text-charcoal-800 truncate">
                                {insp.property_name || insp.address}
                              </div>
                              <div className="text-[10px] text-charcoal-400 truncate">
                                {insp.address}{insp.city ? ` • ${insp.city}` : ""}
                                {insp.due_date ? ` • Due ${insp.due_date}` : ""}
                              </div>
                            </div>
                          </button>
                        ))
                      )}
                    </div>
                  </div>
                )}

                {/* Error */}
                {genError && (
                  <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-sm text-red-700">
                    {genError}
                  </div>
                )}

                {/* Actions */}
                <div className="flex items-center justify-end gap-3 pt-2">
                  <button
                    onClick={resetModal}
                    disabled={generating}
                    className="px-4 py-2 rounded-lg text-sm font-medium text-charcoal-700 hover:bg-charcoal-50 transition-colors disabled:opacity-60"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleGenerate}
                    disabled={generating || !routeDate || (pickMode === "pick" && selectedIds.size === 0)}
                    className={cn(
                      "flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors",
                      "bg-terra-500 text-white hover:bg-terra-600 disabled:opacity-60"
                    )}
                  >
                    {generating ? (
                      <>
                        <RefreshCw className="w-4 h-4 animate-spin" />
                        Generating...
                      </>
                    ) : (
                      <>
                        <Play className="w-4 h-4" />
                        {pickMode === "pick"
                          ? `Schedule ${selectedIds.size} Stop${selectedIds.size !== 1 ? "s" : ""}`
                          : "Generate"}
                      </>
                    )}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
