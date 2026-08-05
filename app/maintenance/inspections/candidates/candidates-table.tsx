"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import {
  RefreshCw,
  CloudDownload,
  CalendarPlus,
  CheckCircle2,
  Clock,
  AlertTriangle,
  XCircle,
  ChevronLeft,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { StaffSelect, DEFAULT_INSPECTOR } from "@/components/StaffSelect";

interface Candidate {
  id: string;
  appfolio_property_id: string | null;
  appfolio_unit_id: string | null;
  name: string | null;
  address_1: string;
  address_2: string | null;
  city: string;
  state: string;
  zip: string;
  region: string | null;
  owner_name: string | null;
  latitude: number | null;
  longitude: number | null;
  geocode_status: string | null;
  uses_custom_inspection_date: boolean;
  last_inspection_date: string | null;
  candidate_status: string | null;
  local_skip_reason: string | null;
  last_appfolio_sync_at: string | null;
}

interface CandidateCounts {
  skip_recent: number;
  defer: number;
  eligible: number;
  scheduled: number;
  dismissed: number;
}

const STATUS_LABELS: Record<string, string> = {
  skip_recent: "Recently inspected",
  defer: "Defer (3–6 mo)",
  eligible: "Eligible",
  scheduled: "Scheduled",
  dismissed: "Dismissed",
};

const STATUS_COLORS: Record<string, string> = {
  skip_recent: "bg-emerald-100 text-emerald-800",
  defer: "bg-amber-100 text-amber-800",
  eligible: "bg-blue-100 text-blue-800",
  scheduled: "bg-violet-100 text-violet-800",
  dismissed: "bg-charcoal-200 text-charcoal-700",
};

function formatDate(s: string | null): string {
  if (!s) return "—";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

export function CandidatesView() {
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [counts, setCounts] = useState<CandidateCounts>({
    skip_recent: 0,
    defer: 0,
    eligible: 0,
    scheduled: 0,
    dismissed: 0,
  });
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>("eligible");
  const [search, setSearch] = useState("");
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [syncToast, setSyncToast] = useState<string | null>(null);

  const fetchCandidates = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (statusFilter) params.set("status", statusFilter);
      if (search.trim()) params.set("search", search.trim());
      const res = await fetch(`/api/inspections/candidates?${params.toString()}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load candidates");
      setCandidates(data.candidates || []);
      setCounts(data.counts || counts);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load candidates");
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter, search]);

  useEffect(() => {
    fetchCandidates();
  }, [fetchCandidates]);

  async function handleSync() {
    setSyncing(true);
    setSyncToast(null);
    try {
      const res = await fetch("/api/inspections/candidates/sync", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Sync failed");
      setSyncToast(
        `Synced ${data.checked} units · ${data.skip_recent} recent · ${data.defer} defer · ${data.eligible} eligible (inserted ${data.inserted}, updated ${data.updated})`
      );
      await fetchCandidates();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sync failed");
    } finally {
      setSyncing(false);
    }
  }

  async function handleDismiss(id: string) {
    if (!confirm("Dismiss this property from the current inspection cycle?")) return;
    try {
      const res = await fetch(`/api/inspections/candidates/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ candidate_status: "dismissed" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to dismiss");
      await fetchCandidates();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to dismiss");
    }
  }

  async function handleRestore(id: string) {
    try {
      const res = await fetch(`/api/inspections/candidates/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ candidate_status: "eligible", local_skip_reason: null }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to restore");
      await fetchCandidates();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to restore");
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <Link
            href="/maintenance/inspections"
            className="inline-flex items-center gap-1 text-xs text-charcoal-500 hover:text-charcoal-700 mb-2"
          >
            <ChevronLeft className="w-3 h-3" />
            Back to Inspections
          </Link>
          <h1 className="text-2xl font-bold text-charcoal-900">Inspection Candidates</h1>
          <p className="text-sm text-charcoal-500 mt-1">
            Properties flagged in AppFolio with "Use Custom Inspection Date." Auto-skipped if inspected in the last 90 days.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleSync}
            disabled={syncing}
            className={cn(
              "flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors",
              "bg-terra-500 text-white hover:bg-terra-600 disabled:opacity-60"
            )}
          >
            <CloudDownload className={cn("w-4 h-4", syncing && "animate-pulse")} />
            {syncing ? "Syncing..." : "Sync from AppFolio"}
          </button>
          <button
            onClick={() => setScheduleOpen(true)}
            disabled={counts.eligible === 0}
            className={cn(
              "flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors",
              "bg-charcoal-900 text-white hover:bg-charcoal-800 disabled:opacity-40 disabled:cursor-not-allowed"
            )}
          >
            <CalendarPlus className="w-4 h-4" />
            Schedule eligible ({counts.eligible})
          </button>
        </div>
      </div>

      {syncToast && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-900 px-4 py-2 rounded-lg text-sm">
          {syncToast}
        </div>
      )}

      {error && (
        <div className="bg-rose-50 border border-rose-200 text-rose-900 px-4 py-2 rounded-lg text-sm">
          {error}
        </div>
      )}

      {/* Counts */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <StatusTile
          icon={<CheckCircle2 className="w-4 h-4" />}
          label="Recent (<90d)"
          value={counts.skip_recent}
          color="emerald"
          active={statusFilter === "skip_recent"}
          onClick={() => setStatusFilter("skip_recent")}
        />
        <StatusTile
          icon={<Clock className="w-4 h-4" />}
          label="Defer (3–6 mo)"
          value={counts.defer}
          color="amber"
          active={statusFilter === "defer"}
          onClick={() => setStatusFilter("defer")}
        />
        <StatusTile
          icon={<AlertTriangle className="w-4 h-4" />}
          label="Eligible (>6 mo)"
          value={counts.eligible}
          color="blue"
          active={statusFilter === "eligible"}
          onClick={() => setStatusFilter("eligible")}
        />
        <StatusTile
          icon={<CalendarPlus className="w-4 h-4" />}
          label="Scheduled"
          value={counts.scheduled}
          color="violet"
          active={statusFilter === "scheduled"}
          onClick={() => setStatusFilter("scheduled")}
        />
        <StatusTile
          icon={<XCircle className="w-4 h-4" />}
          label="Dismissed"
          value={counts.dismissed}
          color="charcoal"
          active={statusFilter === "dismissed"}
          onClick={() => setStatusFilter("dismissed")}
        />
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3">
        <input
          type="text"
          placeholder="Search address, owner, property name…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 max-w-md px-3 py-2 border border-charcoal-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-terra-500"
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-3 py-2 border border-charcoal-300 rounded-lg text-sm bg-white"
        >
          <option value="">All statuses</option>
          <option value="eligible">Eligible</option>
          <option value="defer">Defer</option>
          <option value="skip_recent">Recently inspected</option>
          <option value="scheduled">Scheduled</option>
          <option value="dismissed">Dismissed</option>
        </select>
        <button
          onClick={fetchCandidates}
          className="px-3 py-2 border border-charcoal-300 rounded-lg text-sm hover:bg-charcoal-50 flex items-center gap-2"
        >
          <RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} />
          Refresh
        </button>
      </div>

      {/* Table */}
      <div className="bg-white border border-charcoal-200 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-charcoal-200">
            <thead className="bg-charcoal-50">
              <tr className="text-left text-xs font-semibold text-charcoal-600 uppercase tracking-wide">
                <th className="px-4 py-3">Property</th>
                <th className="px-4 py-3">Address</th>
                <th className="px-4 py-3">Owner</th>
                <th className="px-4 py-3">Last Inspection</th>
                <th className="px-4 py-3">Geocode</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-charcoal-100">
              {loading && (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-sm text-charcoal-500">
                    Loading…
                  </td>
                </tr>
              )}
              {!loading && candidates.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-sm text-charcoal-500">
                    No candidates match the current filters. Try "Sync from AppFolio" to refresh.
                  </td>
                </tr>
              )}
              {candidates.map((c) => (
                <tr key={c.id} className="text-sm text-charcoal-800">
                  <td className="px-4 py-3 font-medium">
                    {c.name || c.appfolio_property_id || "—"}
                  </td>
                  <td className="px-4 py-3">
                    <div>{c.address_1}{c.address_2 ? ` ${c.address_2}` : ""}</div>
                    <div className="text-xs text-charcoal-500">
                      {c.city}, {c.state} {c.zip}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-xs">{c.owner_name || "—"}</td>
                  <td className="px-4 py-3">{formatDate(c.last_inspection_date)}</td>
                  <td className="px-4 py-3 text-xs">
                    {c.latitude != null && c.longitude != null ? (
                      <span className="text-emerald-700">✓</span>
                    ) : (
                      <span className="text-amber-700">pending</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={cn(
                        "inline-block px-2 py-0.5 rounded-full text-xs font-medium",
                        STATUS_COLORS[c.candidate_status || ""] || "bg-charcoal-100 text-charcoal-700"
                      )}
                    >
                      {STATUS_LABELS[c.candidate_status || ""] || c.candidate_status || "—"}
                    </span>
                    {c.local_skip_reason && (
                      <div className="text-xs text-charcoal-500 mt-1">{c.local_skip_reason}</div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {c.candidate_status === "dismissed" ? (
                      <button
                        onClick={() => handleRestore(c.id)}
                        className="text-xs text-terra-600 hover:text-terra-700"
                      >
                        Restore
                      </button>
                    ) : c.candidate_status !== "scheduled" ? (
                      <button
                        onClick={() => handleDismiss(c.id)}
                        className="text-xs text-charcoal-500 hover:text-rose-600"
                      >
                        Dismiss
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {scheduleOpen && (
        <ScheduleModal
          eligibleCount={counts.eligible}
          onClose={() => setScheduleOpen(false)}
          onScheduled={async () => {
            setScheduleOpen(false);
            await fetchCandidates();
          }}
        />
      )}
    </div>
  );
}

function StatusTile({
  icon,
  label,
  value,
  color,
  active,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  color: "emerald" | "amber" | "blue" | "violet" | "charcoal";
  active: boolean;
  onClick: () => void;
}) {
  const palette = {
    emerald: active ? "border-emerald-500 bg-emerald-50" : "border-charcoal-200",
    amber: active ? "border-amber-500 bg-amber-50" : "border-charcoal-200",
    blue: active ? "border-blue-500 bg-blue-50" : "border-charcoal-200",
    violet: active ? "border-violet-500 bg-violet-50" : "border-charcoal-200",
    charcoal: active ? "border-charcoal-500 bg-charcoal-100" : "border-charcoal-200",
  }[color];

  return (
    <button
      onClick={onClick}
      className={cn(
        "border rounded-xl p-3 text-left transition-colors hover:bg-charcoal-50",
        palette
      )}
    >
      <div className="flex items-center gap-2 text-xs text-charcoal-600">
        {icon}
        {label}
      </div>
      <div className="text-2xl font-bold text-charcoal-900 mt-1">{value}</div>
    </button>
  );
}

function ScheduleModal({
  eligibleCount,
  onClose,
  onScheduled,
}: {
  eligibleCount: number;
  onClose: () => void;
  onScheduled: () => Promise<void>;
}) {
  const today = new Date();
  const sevenDaysOut = new Date(today);
  sevenDaysOut.setDate(today.getDate() + 7);
  const thirtyDaysOut = new Date(today);
  thirtyDaysOut.setDate(today.getDate() + 30);

  const [startDate, setStartDate] = useState(sevenDaysOut.toISOString().split("T")[0]);
  const [endDate, setEndDate] = useState(thirtyDaysOut.toISOString().split("T")[0]);
  const [assignedTo, setAssignedTo] = useState(DEFAULT_INSPECTOR);
  const [maxStops, setMaxStops] = useState(10);
  const [scheduling, setScheduling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ routes: number; scheduled: number } | null>(null);

  async function handleSchedule() {
    setScheduling(true);
    setError(null);
    try {
      const res = await fetch("/api/inspections/candidates/schedule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date_range_start: startDate,
          date_range_end: endDate,
          assigned_to: assignedTo,
          max_stops_per_route: maxStops,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Schedule failed");
      setResult({ routes: (data.routes || []).length, scheduled: data.scheduled_count || 0 });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Schedule failed");
    } finally {
      setScheduling(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="bg-white rounded-xl shadow-card-hover w-full max-w-md p-6 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div>
          <h3 className="text-base font-bold text-charcoal-900">Schedule Eligible Inspections</h3>
          <p className="text-xs text-charcoal-500 mt-1">
            Buckets {eligibleCount} eligible {eligibleCount === 1 ? "unit" : "units"} into proximity-grouped daily routes.
          </p>
        </div>

        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-charcoal-700 mb-1">Start date</label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              min={sevenDaysOut.toISOString().split("T")[0]}
              className="w-full px-3 py-2 border border-charcoal-300 rounded-lg text-sm"
            />
            <p className="text-xs text-charcoal-500 mt-1">Must be at least 7 days out for tenant notices.</p>
          </div>
          <div>
            <label className="block text-xs font-medium text-charcoal-700 mb-1">End date</label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="w-full px-3 py-2 border border-charcoal-300 rounded-lg text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-charcoal-700 mb-1">Assigned inspector</label>
            <StaffSelect
              value={assignedTo}
              onChange={setAssignedTo}
              className="w-full px-3 py-2 border border-charcoal-300 rounded-lg text-sm bg-white"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-charcoal-700 mb-1">Max stops per day</label>
            <input
              type="number"
              value={maxStops}
              onChange={(e) => setMaxStops(parseInt(e.target.value, 10) || 10)}
              min={1}
              max={30}
              className="w-full px-3 py-2 border border-charcoal-300 rounded-lg text-sm"
            />
          </div>
        </div>

        {error && (
          <div className="bg-rose-50 border border-rose-200 text-rose-900 px-3 py-2 rounded-lg text-sm">
            {error}
          </div>
        )}

        {result && (
          <div className="bg-emerald-50 border border-emerald-200 text-emerald-900 px-3 py-2 rounded-lg text-sm">
            Created {result.routes} {result.routes === 1 ? "route" : "routes"} with {result.scheduled} {result.scheduled === 1 ? "inspection" : "inspections"}.
          </div>
        )}

        <div className="flex items-center justify-end gap-2 pt-2">
          <button
            onClick={result ? () => void onScheduled() : onClose}
            className="px-4 py-2 text-sm text-charcoal-700 hover:bg-charcoal-50 rounded-lg"
          >
            {result ? "Close" : "Cancel"}
          </button>
          {result ? (
            <Link
              href="/maintenance/inspections/routes"
              className="px-4 py-2 text-sm bg-charcoal-900 text-white rounded-lg hover:bg-charcoal-800"
            >
              View routes
            </Link>
          ) : (
            <button
              onClick={handleSchedule}
              disabled={scheduling}
              className="px-4 py-2 text-sm bg-charcoal-900 text-white rounded-lg hover:bg-charcoal-800 disabled:opacity-60"
            >
              {scheduling ? "Scheduling…" : "Schedule"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
