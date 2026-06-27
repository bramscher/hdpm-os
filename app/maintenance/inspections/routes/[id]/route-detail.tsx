"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import {
  RefreshCw,
  MapPin,
  Clock,
  Car,
  Building2,
  Navigation,
  Calendar,
  CalendarPlus,
  ArrowLeft,
  Play,
  CheckCircle2,
  Route,
  Send,
  Map,
  AlertTriangle,
  Check,
  SkipForward,
  MessageSquare,
  Trash2,
  ExternalLink,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { GoogleMap } from "@/components/GoogleMap";

// ────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────

interface RouteStop {
  id: string;
  stop_order: number;
  inspection_id: string;
  address: string;
  city: string | null;
  unit_name: string | null;
  property_name: string | null;
  inspection_type: string | null;
  due_date: string | null;
  status: string;
  drive_minutes: number | null;
  drive_miles: number | null;
  service_minutes: number | null;
  estimated_arrival: string | null;
  lat: number | null;
  lng: number | null;
}

interface InspectionRoute {
  id: string;
  name: string;
  date: string;
  status: "draft" | "optimized" | "dispatched" | "in_progress" | "completed";
  assigned_to: string | null;
  stop_count: number;
  total_drive_minutes: number | null;
  total_service_minutes: number | null;
  estimated_finish_time: string | null;
  return_drive_minutes: number | null;
  stops: RouteStop[];
}

const ROUTE_STATUS_BADGE: Record<string, string> = {
  draft: "bg-charcoal-100 text-charcoal-700",
  optimized: "bg-blue-100 text-blue-700",
  dispatched: "bg-amber-100 text-amber-700",
  in_progress: "bg-terra-100 text-terra-700",
  completed: "bg-green-100 text-green-700",
};

const STOP_STATUS_BADGE: Record<string, string> = {
  pending: "bg-charcoal-100 text-charcoal-600",
  in_progress: "bg-blue-100 text-blue-700",
  completed: "bg-green-100 text-green-700",
  skipped: "bg-amber-100 text-amber-700",
};

// ────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "\u2014";
  const d = new Date(dateStr + "T12:00:00");
  return d.toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatShortDate(dateStr: string | null): string {
  if (!dateStr) return "\u2014";
  const d = new Date(dateStr + "T12:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function formatStatus(status: string): string {
  return status
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function dueDateClass(due: string | null): string {
  if (!due) return "text-charcoal-400";
  const now = new Date();
  const d = new Date(due + "T12:00:00");
  const diffDays = Math.floor(
    (d.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
  );
  if (diffDays < 0) return "text-red-600 font-medium";
  if (diffDays <= 7) return "text-amber-600 font-medium";
  return "text-charcoal-500";
}

function formatTime(timeStr: string | null): string {
  if (!timeStr) return "\u2014";
  // If already formatted like "8:42 AM", return as is
  if (timeStr.includes("AM") || timeStr.includes("PM")) return timeStr;
  // Try to parse as date
  const d = new Date(timeStr);
  if (isNaN(d.getTime())) return timeStr;
  return d.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function computeEstimatedFinish(
  totalDrive: number | null,
  totalService: number | null
): string {
  const startHour = 8; // 8:00 AM
  const totalMinutes =
    (totalDrive ?? 0) + (totalService ?? 0);
  const finishDate = new Date();
  finishDate.setHours(startHour, 0, 0, 0);
  finishDate.setMinutes(finishDate.getMinutes() + totalMinutes);
  return finishDate.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

// ────────────────────────────────────────────────
// Component
// ────────────────────────────────────────────────

interface RouteDetailProps {
  routeId: string;
}

export function RouteDetail({ routeId }: RouteDetailProps) {
  const router = useRouter();
  const [route, setRoute] = useState<InspectionRoute | null>(null);
  const [loading, setLoading] = useState(true);
  const [optimizing, setOptimizing] = useState(false);
  const [dispatching, setDispatching] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showMap, setShowMap] = useState(true);
  const [completingStop, setCompletingStop] = useState<string | null>(null);
  const [startingStop, setStartingStop] = useState<string | null>(null);
  const [stopNotes, setStopNotes] = useState<Record<string, string>>({});
  const [polyline, setPolyline] = useState<string | null>(null);
  const [addingToCalendar, setAddingToCalendar] = useState(false);
  const [calendarLink, setCalendarLink] = useState<string | null>(null);

  // ── Fetch route ──
  const fetchRoute = useCallback(async () => {
    try {
      const res = await fetch(`/api/inspections/routes/${routeId}`);
      if (!res.ok) throw new Error("Failed to fetch route");
      const data = await res.json();
      // Transform API shape to component shape
      const raw = data.route || data;
      const transformed: InspectionRoute = {
        id: raw.id,
        name: raw.notes || `Route ${raw.route_date}`,
        date: raw.route_date,
        status: raw.status,
        assigned_to: raw.assigned_to,
        stop_count: raw.total_stops || 0,
        total_drive_minutes: raw.total_drive_minutes,
        total_service_minutes: raw.total_service_minutes,
        estimated_finish_time: null,
        return_drive_minutes: null,
        stops: (raw.stops || []).map((s: Record<string, unknown>) => {
          const insp = (s.inspections || {}) as Record<string, unknown>;
          const prop = (insp.inspection_properties || {}) as Record<string, unknown>;
          return {
            id: s.id,
            stop_order: s.stop_order,
            inspection_id: s.inspection_id,
            address: prop.address_1 || "Unknown",
            city: prop.city || null,
            unit_name: insp.unit_name || null,
            property_name: null,
            inspection_type: insp.inspection_type || null,
            due_date: insp.due_date || null,
            status: (s.status as string) || "pending",
            drive_minutes: s.travel_minutes_from_previous as number | null,
            drive_miles: null,
            service_minutes: s.service_minutes as number | null,
            estimated_arrival: s.estimated_arrival as string | null,
            lat: (prop.latitude as number) || null,
            lng: (prop.longitude as number) || null,
          };
        }),
      };
      setRoute(transformed);
      if (raw.polyline) setPolyline(raw.polyline);
    } catch (err) {
      console.error("Fetch route error:", err);
      setError("Failed to load route details.");
    } finally {
      setLoading(false);
    }
  }, [routeId]);

  useEffect(() => {
    fetchRoute();
  }, [fetchRoute]);

  // ── Optimize route ──
  const handleOptimize = async () => {
    setOptimizing(true);
    try {
      const res = await fetch(`/api/inspections/routes/${routeId}/optimize`, {
        method: "POST",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        const msg = body.error || `Optimization failed (${res.status})`;
        console.error("Optimize API error:", msg);
        alert(`Optimization failed: ${msg}`);
        return;
      }
      await fetchRoute();
    } catch (err) {
      console.error("Optimize error:", err);
      alert(`Optimization error: ${err instanceof Error ? err.message : err}`);
    } finally {
      setOptimizing(false);
    }
  };

  // ── Dispatch route ──
  const handleDispatch = async () => {
    setDispatching(true);
    try {
      const res = await fetch(`/api/inspections/routes/${routeId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "dispatched" }),
      });
      if (!res.ok) throw new Error("Dispatch failed");
      await fetchRoute();
    } catch (err) {
      console.error("Dispatch error:", err);
    } finally {
      setDispatching(false);
    }
  };

  // ── Delete route ──
  const handleDelete = async () => {
    if (!confirm("Delete this route? All stops will be returned to the inspection queue.")) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/inspections/routes/${routeId}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Delete failed");
      }
      // Navigate back to route builder
      router.push("/maintenance/inspections/routes");
    } catch (err) {
      console.error("Delete error:", err);
      alert(`Delete failed: ${err instanceof Error ? err.message : err}`);
      setDeleting(false);
    }
  };

  // ── Add to Outlook Calendar ──
  const handleAddToCalendar = async () => {
    setAddingToCalendar(true);
    try {
      const res = await fetch(`/api/inspections/routes/${routeId}/calendar`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || "Failed to add to calendar");
        return;
      }
      setCalendarLink(data.webLink || null);
      alert("Route added to your Outlook calendar!");
    } catch (err) {
      console.error("Calendar error:", err);
      alert(`Calendar error: ${err instanceof Error ? err.message : err}`);
    } finally {
      setAddingToCalendar(false);
    }
  };

  // ── Complete / Skip / Flag stop ──
  const handleStopAction = async (
    stopId: string,
    action: "complete" | "skip" | "flag_issue"
  ) => {
    setCompletingStop(stopId);
    try {
      const res = await fetch(`/api/inspections/routes/${routeId}/stops`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stop_id: stopId,
          action,
          notes: stopNotes[stopId] || undefined,
          issues_found: action === "flag_issue",
          issue_severity: action === "flag_issue" ? "medium" : undefined,
        }),
      });
      if (!res.ok) throw new Error("Stop update failed");
      await fetchRoute();
    } catch (err) {
      console.error("Stop action error:", err);
    } finally {
      setCompletingStop(null);
    }
  };

  // ── Start Inspection ──
  const handleStartInspection = async (stopId: string) => {
    setStartingStop(stopId);
    try {
      const res = await fetch(`/api/inspections/routes/${routeId}/stops`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stop_id: stopId, action: "start" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to start inspection");

      await fetchRoute();
    } catch (err) {
      console.error("Start inspection error:", err);
      alert(`Failed to start inspection: ${err instanceof Error ? err.message : err}`);
    } finally {
      setStartingStop(null);
    }
  };

  // ────────────────────────────────────────────────
  // Render
  // ────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <RefreshCw className="w-6 h-6 animate-spin text-charcoal-400" />
        <span className="ml-3 text-charcoal-500">Loading route...</span>
      </div>
    );
  }

  if (error || !route) {
    return (
      <div className="text-center py-16 text-charcoal-400">
        <Route className="w-10 h-10 mx-auto mb-3 text-charcoal-300" />
        <p className="font-medium">{error || "Route not found"}</p>
        <Link
          href="/maintenance/inspections/routes"
          className="inline-flex items-center gap-2 mt-4 px-4 py-2 rounded-lg text-sm font-medium border border-charcoal-300 text-charcoal-700 hover:bg-charcoal-50 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Routes
        </Link>
      </div>
    );
  }

  const stops = route.stops || [];
  const totalDrive = route.total_drive_minutes ?? stops.reduce((sum, s) => sum + (s.drive_minutes ?? 0), 0);
  const totalService = route.total_service_minutes ?? stops.reduce((sum, s) => sum + (s.service_minutes ?? 0), 0);
  const estimatedFinish = route.estimated_finish_time
    ? formatTime(route.estimated_finish_time)
    : computeEstimatedFinish(totalDrive, totalService);

  return (
    <div className="space-y-6">
      {/* ── Header ── */}
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
        <div>
          <Link
            href="/maintenance/inspections/routes"
            className="inline-flex items-center gap-1.5 text-sm text-charcoal-500 hover:text-charcoal-700 transition-colors mb-3"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Back to Routes
          </Link>
          <h1 className="text-2xl font-bold text-charcoal-900">{route.name}</h1>
          <div className="flex flex-wrap items-center gap-3 mt-2">
            <div className="flex items-center gap-1.5 text-sm text-charcoal-600">
              <Calendar className="w-3.5 h-3.5 text-charcoal-400" />
              {formatDate(route.date)}
            </div>
            {route.assigned_to && (
              <span className="text-sm text-charcoal-500">
                Assigned to {route.assigned_to}
              </span>
            )}
            <span
              className={cn(
                "inline-flex px-2 py-0.5 rounded-full text-xs font-medium",
                ROUTE_STATUS_BADGE[route.status] ?? "bg-charcoal-100 text-charcoal-600"
              )}
            >
              {formatStatus(route.status)}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {route.status === "draft" && (
            <button
              onClick={handleOptimize}
              disabled={optimizing}
              className={cn(
                "flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors",
                "bg-terra-500 text-white hover:bg-terra-600 disabled:opacity-60"
              )}
            >
              {optimizing ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  Optimizing...
                </>
              ) : (
                <>
                  <Navigation className="w-4 h-4" />
                  Optimize Route
                </>
              )}
            </button>
          )}
          {(route.status === "draft" || route.status === "optimized") && (
            <button
              onClick={handleDispatch}
              disabled={dispatching}
              className={cn(
                "flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors",
                "border border-charcoal-300 text-charcoal-700 hover:bg-charcoal-50 disabled:opacity-60"
              )}
            >
              {dispatching ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  Dispatching...
                </>
              ) : (
                <>
                  <Send className="w-4 h-4" />
                  Dispatch
                </>
              )}
            </button>
          )}
          {(route.status === "optimized" || route.status === "dispatched") && (
            calendarLink ? (
              <a
                href={calendarLink}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors border border-green-300 text-green-700 hover:bg-green-50"
              >
                <ExternalLink className="w-4 h-4" />
                View in Outlook
              </a>
            ) : (
              <button
                onClick={handleAddToCalendar}
                disabled={addingToCalendar}
                className={cn(
                  "flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors",
                  "border border-blue-300 text-blue-700 hover:bg-blue-50 disabled:opacity-60"
                )}
              >
                {addingToCalendar ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    Adding...
                  </>
                ) : (
                  <>
                    <CalendarPlus className="w-4 h-4" />
                    Add to Outlook
                  </>
                )}
              </button>
            )
          )}
          {route.status !== "completed" && (
            <button
              onClick={handleDelete}
              disabled={deleting}
              className={cn(
                "flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors",
                "border border-red-300 text-red-600 hover:bg-red-50 disabled:opacity-60"
              )}
            >
              {deleting ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  Deleting...
                </>
              ) : (
                <>
                  <Trash2 className="w-4 h-4" />
                  Delete Route
                </>
              )}
            </button>
          )}
        </div>
      </div>

      {/* ── Stats Bar ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="bg-white rounded-lg border border-charcoal-200 p-4">
          <div className="flex items-center gap-2 mb-1">
            <MapPin className="w-4 h-4 text-terra-500" />
            <span className="text-xs font-medium text-charcoal-500">Stops</span>
          </div>
          <p className="text-2xl font-bold text-charcoal-900">{stops.length}</p>
        </div>
        <div className="bg-white rounded-lg border border-charcoal-200 p-4">
          <div className="flex items-center gap-2 mb-1">
            <Car className="w-4 h-4 text-blue-500" />
            <span className="text-xs font-medium text-charcoal-500">Drive Time</span>
          </div>
          <p className="text-2xl font-bold text-charcoal-900">
            {totalDrive > 0 ? `${totalDrive} min` : "\u2014"}
          </p>
        </div>
        <div className="bg-white rounded-lg border border-charcoal-200 p-4">
          <div className="flex items-center gap-2 mb-1">
            <Clock className="w-4 h-4 text-amber-500" />
            <span className="text-xs font-medium text-charcoal-500">Service Time</span>
          </div>
          <p className="text-2xl font-bold text-charcoal-900">
            {totalService > 0 ? `${totalService} min` : "\u2014"}
          </p>
        </div>
        <div className="bg-white rounded-lg border border-charcoal-200 p-4">
          <div className="flex items-center gap-2 mb-1">
            <CheckCircle2 className="w-4 h-4 text-green-500" />
            <span className="text-xs font-medium text-charcoal-500">Est. Finish</span>
          </div>
          <p className="text-2xl font-bold text-charcoal-900">
            {totalDrive > 0 || totalService > 0 ? `~${estimatedFinish}` : "\u2014"}
          </p>
        </div>
      </div>

      {/* ── Map ── */}
      {stops.length > 0 && (
        <div className="bg-white rounded-lg border border-charcoal-200 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-charcoal-200">
            <h2 className="text-sm font-semibold text-charcoal-900 flex items-center gap-2">
              <Map className="w-4 h-4 text-charcoal-400" />
              Route Map
            </h2>
            <button
              onClick={() => setShowMap(!showMap)}
              className="text-xs text-charcoal-500 hover:text-charcoal-700"
            >
              {showMap ? "Hide" : "Show"}
            </button>
          </div>
          {showMap && (
            <GoogleMap
              pins={[...stops]
                .sort((a, b) => a.stop_order - b.stop_order)
                .filter((s) => s.lat && s.lng)
                .map((s) => ({
                  lat: s.lat!,
                  lng: s.lng!,
                  label: String(s.stop_order),
                  title: `${s.stop_order}. ${s.address}${s.city ? `, ${s.city}` : ""}`,
                  color: (s.status === "completed"
                    ? "green"
                    : s.status === "skipped"
                    ? "gray"
                    : "terra") as "green" | "gray" | "terra",
                }))}
              polyline={polyline}
              showOffice
              height="400px"
            />
          )}
        </div>
      )}

      {/* ── Stop Timeline ── */}
      <div className="bg-white rounded-lg border border-charcoal-200 p-6">
        <h2 className="text-lg font-semibold text-charcoal-900 mb-6">Route Timeline</h2>

        <div className="relative">
          {/* ── Start: Office ── */}
          <div className="flex items-start gap-4 mb-0">
            <div className="flex flex-col items-center">
              <div className="w-10 h-10 rounded-full bg-charcoal-900 flex items-center justify-center flex-shrink-0">
                <Building2 className="w-5 h-5 text-white" />
              </div>
              {stops.length > 0 && (
                <div className="w-0.5 bg-charcoal-200 flex-1 min-h-[40px] mt-2" />
              )}
            </div>
            <div className="pt-2">
              <p className="font-semibold text-charcoal-900">Start: HDPM Office</p>
              <p className="text-sm text-charcoal-500">
                1515 SW Reindeer Ave, Redmond
              </p>
              <p className="text-xs text-charcoal-400 mt-0.5">8:00 AM</p>
            </div>
          </div>

          {/* ── Stops ── */}
          {stops.map((stop, idx) => {
            const isLast = idx === stops.length - 1;
            return (
              <div key={stop.id} className="flex items-start gap-4">
                <div className="flex flex-col items-center">
                  {/* Drive time connector */}
                  {stop.drive_minutes != null && (
                    <div className="flex items-center gap-2 py-2">
                      <div className="w-0.5 bg-charcoal-200 h-4" />
                    </div>
                  )}
                  {/* Drive label */}
                  {stop.drive_minutes != null && (
                    <div className="mb-2 -ml-1">
                      <span className="inline-flex items-center gap-1 text-xs text-charcoal-400 bg-charcoal-50 rounded-full px-2 py-0.5">
                        <Car className="w-3 h-3" />
                        {stop.drive_minutes} min
                        {stop.drive_miles != null && `, ${stop.drive_miles} mi`}
                      </span>
                    </div>
                  )}
                  {/* Stop number circle */}
                  <div className="w-10 h-10 rounded-full bg-terra-500 flex items-center justify-center flex-shrink-0">
                    <span className="text-sm font-bold text-white">
                      {stop.stop_order}
                    </span>
                  </div>
                  {/* Connector to next */}
                  {!isLast && (
                    <div className="w-0.5 bg-charcoal-200 flex-1 min-h-[40px] mt-2" />
                  )}
                  {/* Connector to return */}
                  {isLast && route.return_drive_minutes != null && (
                    <div className="w-0.5 bg-charcoal-200 flex-1 min-h-[40px] mt-2" />
                  )}
                </div>

                <div className="pt-1 pb-4 flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-semibold text-charcoal-900 truncate">
                        {stop.property_name || stop.address}
                        {stop.unit_name && (
                          <span className="ml-1.5 inline-flex px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-700 text-xs font-bold">
                            #{stop.unit_name}
                          </span>
                        )}
                      </p>
                      {stop.property_name && (
                        <p className="text-sm text-charcoal-600 truncate">
                          {stop.address}
                        </p>
                      )}
                      {stop.city && (
                        <p className="text-sm text-charcoal-500">{stop.city}</p>
                      )}
                    </div>
                    <div className="flex flex-col items-end gap-1 flex-shrink-0">
                      {stop.estimated_arrival && (
                        <span className="text-xs font-medium text-charcoal-600">
                          ~{formatTime(stop.estimated_arrival)}
                        </span>
                      )}
                      <span
                        className={cn(
                          "inline-flex px-2 py-0.5 rounded-full text-xs font-medium",
                          STOP_STATUS_BADGE[stop.status] ?? "bg-charcoal-100 text-charcoal-600"
                        )}
                      >
                        {formatStatus(stop.status)}
                      </span>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 mt-2">
                    {stop.inspection_type && (
                      <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-indigo-100 text-indigo-700">
                        {stop.inspection_type}
                      </span>
                    )}
                    {stop.due_date && (
                      <span
                        className={cn(
                          "inline-flex items-center gap-1 text-xs",
                          dueDateClass(stop.due_date)
                        )}
                      >
                        <Calendar className="w-3 h-3" />
                        Due {formatShortDate(stop.due_date)}
                      </span>
                    )}
                    {stop.service_minutes != null && (
                      <span className="inline-flex items-center gap-1 text-xs text-charcoal-400">
                        <Clock className="w-3 h-3" />
                        ~{stop.service_minutes} min service
                      </span>
                    )}
                  </div>

                  {/* ── Stop Actions ── */}
                  {stop.status === "pending" && (route.status === "dispatched" || route.status === "optimized" || route.status === "draft") && (
                    <div className="mt-3 flex items-center gap-2">
                      <button
                        onClick={() => handleStartInspection(stop.id)}
                        disabled={startingStop === stop.id}
                        className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold bg-terra-500 text-white hover:bg-terra-600 transition-colors disabled:opacity-60"
                      >
                        {startingStop === stop.id ? (
                          <>
                            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                            Starting...
                          </>
                        ) : (
                          <>
                            <Play className="w-3.5 h-3.5" />
                            Start Inspection
                          </>
                        )}
                      </button>
                      <button
                        onClick={() => handleStopAction(stop.id, "skip")}
                        disabled={completingStop === stop.id}
                        className="flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs font-medium bg-charcoal-100 text-charcoal-600 hover:bg-charcoal-200 transition-colors disabled:opacity-50"
                      >
                        <SkipForward className="w-3 h-3" />
                        Skip
                      </button>
                    </div>
                  )}

                  {/* In-progress: show complete/flag/notes */}
                  {stop.status === "in_progress" && (
                    <div className="mt-3 space-y-2">
                      <input
                        type="text"
                        placeholder="Add inspection notes..."
                        value={stopNotes[stop.id] || ""}
                        onChange={(e) =>
                          setStopNotes((prev) => ({
                            ...prev,
                            [stop.id]: e.target.value,
                          }))
                        }
                        className="w-full text-xs bg-charcoal-50 border border-charcoal-200 rounded-md px-2.5 py-1.5 text-charcoal-700 placeholder:text-charcoal-400 focus:outline-none focus:ring-1 focus:ring-terra-400"
                      />
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => handleStopAction(stop.id, "complete")}
                          disabled={completingStop === stop.id}
                          className="flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs font-medium bg-green-100 text-green-700 hover:bg-green-200 transition-colors disabled:opacity-50"
                        >
                          <Check className="w-3 h-3" />
                          Complete
                        </button>
                        <button
                          onClick={() => handleStopAction(stop.id, "flag_issue")}
                          disabled={completingStop === stop.id}
                          className="flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs font-medium bg-amber-100 text-amber-700 hover:bg-amber-200 transition-colors disabled:opacity-50"
                        >
                          <AlertTriangle className="w-3 h-3" />
                          Flag Issue
                        </button>
                        <button
                          onClick={() => handleStopAction(stop.id, "skip")}
                          disabled={completingStop === stop.id}
                          className="flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs font-medium bg-charcoal-100 text-charcoal-600 hover:bg-charcoal-200 transition-colors disabled:opacity-50"
                        >
                          <SkipForward className="w-3 h-3" />
                          Skip
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Completed indicator */}
                  {stop.status === "completed" && (
                    <div className="mt-2 flex items-center gap-1.5 text-xs text-green-600">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      Completed
                    </div>
                  )}
                  {stop.status === "skipped" && (
                    <div className="mt-2 flex items-center gap-1.5 text-xs text-charcoal-400">
                      <SkipForward className="w-3.5 h-3.5" />
                      Skipped
                    </div>
                  )}
                </div>
              </div>
            );
          })}

          {/* ── Return to office ── */}
          {route.return_drive_minutes != null && (
            <div className="flex items-start gap-4">
              <div className="flex flex-col items-center">
                <div className="mb-2 -ml-1">
                  <span className="inline-flex items-center gap-1 text-xs text-charcoal-400 bg-charcoal-50 rounded-full px-2 py-0.5">
                    <Car className="w-3 h-3" />
                    {route.return_drive_minutes} min return
                  </span>
                </div>
                <div className="w-10 h-10 rounded-full bg-charcoal-900 flex items-center justify-center flex-shrink-0">
                  <Building2 className="w-5 h-5 text-white" />
                </div>
              </div>
              <div className="pt-6">
                <p className="font-semibold text-charcoal-900">Return to Office</p>
                <p className="text-sm text-charcoal-500">
                  1515 SW Reindeer Ave, Redmond
                </p>
              </div>
            </div>
          )}

          {/* ── Empty stops ── */}
          {stops.length === 0 && (
            <div className="text-center py-8 text-charcoal-400">
              <MapPin className="w-8 h-8 mx-auto mb-2 text-charcoal-300" />
              <p className="text-sm">No stops in this route yet.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
