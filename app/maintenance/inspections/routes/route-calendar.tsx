"use client";
import { routeTimeLabel } from "@/lib/route-builder/inspection-time";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import {
  ChevronLeft,
  ChevronRight,
  MapPin,
  Car,
  Clock,
  User,
  Plus,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────

interface RouteForCalendar {
  id: string;
  route_date: string;
  start_time?: string | null;
  assigned_to: string | null;
  total_stops: number;
  total_drive_minutes: number | null;
  total_service_minutes: number | null;
  total_estimated_minutes: number | null;
  status: string;
  notes: string | null;
}

interface RouteCalendarProps {
  routes: RouteForCalendar[];
  onCreateRoute: (date: string) => void;
  onDeleteRoute?: (routeId: string) => void;
  onClearDay?: (date: string) => void;
}

const STATUS_COLOR: Record<string, string> = {
  draft: "bg-charcoal-100 border-charcoal-300 text-charcoal-700",
  optimized: "bg-blue-50 border-blue-300 text-blue-800",
  dispatched: "bg-amber-50 border-amber-300 text-amber-800",
  completed: "bg-green-50 border-green-300 text-green-800",
};

const STATUS_DOT: Record<string, string> = {
  draft: "bg-charcoal-400",
  optimized: "bg-blue-500",
  dispatched: "bg-amber-500",
  completed: "bg-green-500",
};

// ────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────

function getMonday(d: Date): Date {
  const date = new Date(d);
  const day = date.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  date.setDate(date.getDate() + diff);
  date.setHours(0, 0, 0, 0);
  return date;
}

function addDays(d: Date, n: number): Date {
  const date = new Date(d);
  date.setDate(date.getDate() + n);
  return date;
}

function toDateKey(d: Date): string {
  return d.toISOString().split("T")[0];
}

function formatMonthYear(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

function formatDayHeader(d: Date): string {
  return d.toLocaleDateString("en-US", { weekday: "short" });
}

function formatDayNumber(d: Date): string {
  return d.getDate().toString();
}

function formatMinutes(mins: number | null): string {
  if (mins == null) return "";
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function isToday(d: Date): boolean {
  const now = new Date();
  return (
    d.getDate() === now.getDate() &&
    d.getMonth() === now.getMonth() &&
    d.getFullYear() === now.getFullYear()
  );
}

function isWeekend(d: Date): boolean {
  return d.getDay() === 0 || d.getDay() === 6;
}

/** Returns true if the date is within the 7-day notice blackout window */
function isInBlackout(d: Date): boolean {
  const minDate = new Date();
  minDate.setDate(minDate.getDate() + 7);
  minDate.setHours(0, 0, 0, 0);
  return d < minDate;
}

// ────────────────────────────────────────────────
// Component
// ────────────────────────────────────────────────

export function RouteCalendar({ routes, onCreateRoute, onDeleteRoute, onClearDay }: RouteCalendarProps) {
  const router = useRouter();
  const [viewMode, setViewMode] = useState<"week" | "month">("week");
  const [anchorDate, setAnchorDate] = useState(() => getMonday(new Date()));

  // Group routes by date
  const routesByDate = useMemo(() => {
    const map: Record<string, RouteForCalendar[]> = {};
    for (const route of routes) {
      const key = route.route_date;
      if (!map[key]) map[key] = [];
      map[key].push(route);
    }
    for (const day of Object.values(map)) day.sort((a, b) => (a.start_time || "08:00").localeCompare(b.start_time || "08:00"));
    return map;
  }, [routes]);

  // Generate days for current view
  const days = useMemo(() => {
    if (viewMode === "week") {
      // Mon-Fri (5 workdays)
      return Array.from({ length: 5 }, (_, i) => addDays(anchorDate, i));
    } else {
      // Full month grid (start from Monday of the week containing the 1st)
      const firstOfMonth = new Date(
        anchorDate.getFullYear(),
        anchorDate.getMonth(),
        1
      );
      const startMonday = getMonday(firstOfMonth);
      const lastOfMonth = new Date(
        anchorDate.getFullYear(),
        anchorDate.getMonth() + 1,
        0
      );
      // Fill to end of that week (Sunday)
      const endSunday = addDays(
        getMonday(addDays(lastOfMonth, 6)),
        6
      );
      const result: Date[] = [];
      let current = new Date(startMonday);
      while (current <= endSunday) {
        result.push(new Date(current));
        current = addDays(current, 1);
      }
      return result;
    }
  }, [viewMode, anchorDate]);

  // Navigation
  const navigatePrev = () => {
    if (viewMode === "week") {
      setAnchorDate(addDays(anchorDate, -7));
    } else {
      setAnchorDate(
        new Date(anchorDate.getFullYear(), anchorDate.getMonth() - 1, 1)
      );
    }
  };

  const navigateNext = () => {
    if (viewMode === "week") {
      setAnchorDate(addDays(anchorDate, 7));
    } else {
      setAnchorDate(
        new Date(anchorDate.getFullYear(), anchorDate.getMonth() + 1, 1)
      );
    }
  };

  const goToday = () => {
    setAnchorDate(getMonday(new Date()));
  };

  // Week range label
  const weekLabel = useMemo(() => {
    if (viewMode === "month") {
      return formatMonthYear(anchorDate);
    }
    const friday = addDays(anchorDate, 4);
    const startMonth = anchorDate.toLocaleDateString("en-US", { month: "short" });
    const endMonth = friday.toLocaleDateString("en-US", { month: "short" });
    const startDay = anchorDate.getDate();
    const endDay = friday.getDate();
    const year = friday.getFullYear();

    if (startMonth === endMonth) {
      return `${startMonth} ${startDay} - ${endDay}, ${year}`;
    }
    return `${startMonth} ${startDay} - ${endMonth} ${endDay}, ${year}`;
  }, [viewMode, anchorDate]);

  // Stats for the current view
  const viewStats = useMemo(() => {
    let totalRoutes = 0;
    let totalStops = 0;
    let totalDrive = 0;
    for (const day of days) {
      const key = toDateKey(day);
      const dayRoutes = routesByDate[key] || [];
      totalRoutes += dayRoutes.length;
      for (const r of dayRoutes) {
        totalStops += r.total_stops || 0;
        totalDrive += r.total_drive_minutes || 0;
      }
    }
    return { totalRoutes, totalStops, totalDrive };
  }, [days, routesByDate]);

  return (
    <div className="space-y-4">
      {/* ── Calendar Header ── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={navigatePrev}
            className="p-2 rounded-lg border border-charcoal-200 text-charcoal-600 hover:bg-charcoal-50 transition-colors"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <h2 className="text-lg font-semibold text-charcoal-900 min-w-[200px] text-center">
            {weekLabel}
          </h2>
          <button
            onClick={navigateNext}
            className="p-2 rounded-lg border border-charcoal-200 text-charcoal-600 hover:bg-charcoal-50 transition-colors"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
          <button
            onClick={goToday}
            className="px-3 py-1.5 rounded-lg text-xs font-medium border border-charcoal-200 text-charcoal-600 hover:bg-charcoal-50 transition-colors"
          >
            Today
          </button>
        </div>

        <div className="flex items-center gap-2">
          {/* View stats */}
          <div className="hidden sm:flex items-center gap-4 text-xs text-charcoal-500 mr-4">
            <span>{viewStats.totalRoutes} routes</span>
            <span>{viewStats.totalStops} stops</span>
            {viewStats.totalDrive > 0 && (
              <span>{formatMinutes(viewStats.totalDrive)} driving</span>
            )}
          </div>

          {/* View toggle */}
          <div className="flex rounded-lg border border-charcoal-200 overflow-hidden">
            <button
              onClick={() => {
                setViewMode("week");
                setAnchorDate(getMonday(anchorDate));
              }}
              className={cn(
                "px-3 py-1.5 text-xs font-medium transition-colors",
                viewMode === "week"
                  ? "bg-charcoal-900 text-white"
                  : "bg-white text-charcoal-600 hover:bg-charcoal-50"
              )}
            >
              Week
            </button>
            <button
              onClick={() => setViewMode("month")}
              className={cn(
                "px-3 py-1.5 text-xs font-medium transition-colors",
                viewMode === "month"
                  ? "bg-charcoal-900 text-white"
                  : "bg-white text-charcoal-600 hover:bg-charcoal-50"
              )}
            >
              Month
            </button>
          </div>
        </div>
      </div>

      {/* ── Week View ── */}
      {viewMode === "week" && (
        <div className="grid grid-cols-5 gap-3">
          {days.map((day) => {
            const key = toDateKey(day);
            const dayRoutes = routesByDate[key] || [];
            const today = isToday(day);
            const isPast =
              day < new Date(new Date().toDateString()) && !today;

            return (
              <div
                key={key}
                className={cn(
                  "bg-white rounded-xl border min-h-[280px] flex flex-col",
                  today
                    ? "border-terra-400 ring-2 ring-terra-100"
                    : "border-charcoal-200",
                  isPast && "opacity-60"
                )}
              >
                {/* Day header */}
                <div
                  className={cn(
                    "px-4 py-3 border-b flex items-center justify-between",
                    today
                      ? "bg-terra-50 border-terra-200"
                      : "bg-charcoal-50 border-charcoal-200"
                  )}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-charcoal-500 uppercase">
                      {formatDayHeader(day)}
                    </span>
                    <span
                      className={cn(
                        "text-lg font-bold",
                        today ? "text-terra-600" : "text-charcoal-900"
                      )}
                    >
                      {formatDayNumber(day)}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    {dayRoutes.length > 0 && (
                      <span className="text-xs text-charcoal-400">
                        {dayRoutes.reduce((sum, r) => sum + (r.total_stops || 0), 0)} stops
                      </span>
                    )}
                    {dayRoutes.length > 0 && onClearDay && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          if (confirm(`Clear all ${dayRoutes.length} route(s) for this day? Inspections will return to the pool.`)) {
                            onClearDay(key);
                          }
                        }}
                        className="text-xs text-red-400 hover:text-red-600 transition-colors"
                        title="Clear all routes for this day"
                      >
                        Clear Day
                      </button>
                    )}
                  </div>
                </div>

                {/* Route cards */}
                <div className="flex-1 p-2 space-y-2 overflow-y-auto">
                  {dayRoutes.map((route) => (
                    <div
                      key={route.id}
                      className={cn(
                        "relative w-full text-left p-3 rounded-lg border transition-all hover:shadow-md cursor-pointer group",
                        STATUS_COLOR[route.status] ??
                          "bg-charcoal-50 border-charcoal-200 text-charcoal-700"
                      )}
                      onClick={() =>
                        router.push(
                          `/maintenance/inspections/routes/${route.id}`
                        )
                      }
                    >
                      {/* Delete button */}
                      {onDeleteRoute && route.status !== "completed" && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            if (confirm("Delete this route? Inspections will return to the queue.")) {
                              onDeleteRoute(route.id);
                            }
                          }}
                          className="absolute top-1.5 right-1.5 w-5 h-5 flex items-center justify-center rounded-full opacity-0 group-hover:opacity-100 transition-opacity bg-red-100 hover:bg-red-200 text-red-500"
                          title="Delete route"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      )}

                      {/* Status + assignee */}
                      <div className="flex items-center gap-1.5 mb-2">
                        <span
                          className={cn(
                            "w-2 h-2 rounded-full flex-shrink-0",
                            STATUS_DOT[route.status] ?? "bg-charcoal-400"
                          )}
                        />
                        <span className="text-xs font-medium truncate">
                          {routeTimeLabel(route.start_time)} · {route.notes || `Route`}
                        </span>
                      </div>

                      {/* Stats row */}
                      <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs opacity-80">
                        <span className="flex items-center gap-1">
                          <MapPin className="w-3 h-3" />
                          {route.total_stops || 0}
                        </span>
                        {route.total_drive_minutes != null && (
                          <span className="flex items-center gap-1">
                            <Car className="w-3 h-3" />
                            {formatMinutes(route.total_drive_minutes)}
                          </span>
                        )}
                        {route.total_service_minutes != null && (
                          <span className="flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            {formatMinutes(route.total_service_minutes)}
                          </span>
                        )}
                      </div>

                      {/* Assignee */}
                      {route.assigned_to && (
                        <div className="flex items-center gap-1 mt-2 text-xs opacity-70 truncate">
                          <User className="w-3 h-3 flex-shrink-0" />
                          <span className="truncate">{route.assigned_to}</span>
                        </div>
                      )}
                    </div>
                  ))}

                  {/* Add route button */}
                  {!isPast && !isInBlackout(day) && (
                    <button
                      onClick={() => onCreateRoute(key)}
                      className={cn(
                        "w-full flex items-center justify-center gap-1.5 p-2 rounded-lg border border-dashed transition-colors",
                        dayRoutes.length === 0
                          ? "border-charcoal-300 text-charcoal-400 hover:border-terra-400 hover:text-terra-500 hover:bg-terra-50"
                          : "border-charcoal-200 text-charcoal-300 hover:border-terra-400 hover:text-terra-500 hover:bg-terra-50"
                      )}
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span className="text-xs font-medium">Add Route</span>
                    </button>
                  )}
                  {!isPast && isInBlackout(day) && dayRoutes.length === 0 && (
                    <p className="text-[10px] text-charcoal-300 text-center px-2 py-1">
                      7-day notice required
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Month View ── */}
      {viewMode === "month" && (
        <div>
          {/* Day headers */}
          <div className="grid grid-cols-7 gap-1 mb-1">
            {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
              <div
                key={d}
                className="text-center text-xs font-medium text-charcoal-500 py-2"
              >
                {d}
              </div>
            ))}
          </div>

          {/* Day cells */}
          <div className="grid grid-cols-7 gap-1">
            {days.map((day) => {
              const key = toDateKey(day);
              const dayRoutes = routesByDate[key] || [];
              const today = isToday(day);
              const weekend = isWeekend(day);
              const isCurrentMonth =
                day.getMonth() === anchorDate.getMonth();
              const isPast =
                day < new Date(new Date().toDateString()) && !today;

              return (
                <div
                  key={key}
                  className={cn(
                    "min-h-[100px] rounded-lg border p-2 transition-colors",
                    today
                      ? "border-terra-400 ring-1 ring-terra-100 bg-white"
                      : weekend
                      ? "border-charcoal-100 bg-charcoal-50/50"
                      : "border-charcoal-200 bg-white",
                    !isCurrentMonth && "opacity-40",
                    isPast && isCurrentMonth && "opacity-60"
                  )}
                >
                  {/* Day number */}
                  <div className="flex items-center justify-between mb-1">
                    <span
                      className={cn(
                        "text-xs font-medium",
                        today
                          ? "text-terra-600 font-bold"
                          : isCurrentMonth
                          ? "text-charcoal-700"
                          : "text-charcoal-400"
                      )}
                    >
                      {formatDayNumber(day)}
                    </span>
                    {dayRoutes.length > 0 && (
                      <span className="text-[10px] text-charcoal-400">
                        {dayRoutes.reduce(
                          (sum, r) => sum + (r.total_stops || 0),
                          0
                        )}{" "}
                        stops
                      </span>
                    )}
                  </div>

                  {/* Compact route pills */}
                  <div className="space-y-1">
                    {dayRoutes.slice(0, 3).map((route) => (
                      <button
                        key={route.id}
                        onClick={() =>
                          router.push(
                            `/maintenance/inspections/routes/${route.id}`
                          )
                        }
                        className={cn(
                          "w-full text-left px-2 py-1 rounded text-[10px] font-medium border transition-all hover:shadow-sm truncate",
                          STATUS_COLOR[route.status] ??
                            "bg-charcoal-50 border-charcoal-200"
                        )}
                      >
                        <span className="flex items-center gap-1">
                          <span
                            className={cn(
                              "w-1.5 h-1.5 rounded-full flex-shrink-0",
                              STATUS_DOT[route.status] ?? "bg-charcoal-400"
                            )}
                          />
                          {routeTimeLabel(route.start_time)} · {route.total_stops || 0} stops
                          {route.assigned_to && (
                            <span className="opacity-60 truncate">
                              {" "}
                              - {route.assigned_to.split("@")[0]}
                            </span>
                          )}
                        </span>
                      </button>
                    ))}
                    {dayRoutes.length > 3 && (
                      <span className="text-[10px] text-charcoal-400 pl-1">
                        +{dayRoutes.length - 3} more
                      </span>
                    )}
                  </div>

                  {/* Add button for empty future workdays outside blackout */}
                  {dayRoutes.length === 0 &&
                    !weekend &&
                    !isPast &&
                    !isInBlackout(day) &&
                    isCurrentMonth && (
                      <button
                        onClick={() => onCreateRoute(key)}
                        className="w-full mt-1 flex items-center justify-center p-1 rounded border border-dashed border-charcoal-200 text-charcoal-300 hover:border-terra-400 hover:text-terra-500 hover:bg-terra-50 transition-colors"
                      >
                        <Plus className="w-3 h-3" />
                      </button>
                    )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
