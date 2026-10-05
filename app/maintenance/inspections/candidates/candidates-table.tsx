"use client";

import { inspectionToday, inspectionHorizon, shiftInspectionDate } from "@/lib/inspection-window";

import { useState, useEffect, useCallback, useRef } from "react";
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
  review_group: 'ready' | 'handled' | 'confirmation';
  review_reason: string;
  review_item_type: 'candidate' | 'completion';
  appfolio_url: string | null;
  evidence_date: string | null;
  evidence_status: string | null;
  move_in_date: string | null;
  next_due_date: string | null;
  routine_inspections_enabled: boolean;
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

interface CandidateCounts { ready: number; handled: number; confirmation: number }
const GROUP_LABELS: Record<string,string> = {ready:'Ready to schedule',handled:'Already handled / not due',confirmation:'Needs confirmation'};
const GROUP_COLORS: Record<string,string> = {ready:'bg-blue-100 text-blue-800',handled:'bg-emerald-100 text-emerald-800',confirmation:'bg-amber-100 text-amber-800'};

function formatDate(s: string | null): string {
  if (!s) return "—";
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T12:00:00` : s);
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

export function CandidatesView({initialGroup = 'ready'}: {initialGroup?: string}) {
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [counts, setCounts] = useState<CandidateCounts>({ready:0,handled:0,confirmation:0});
  const [checkedAt, setCheckedAt] = useState<string | null>(null);
  const [verificationError, setVerificationError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [groupFilter, setGroupFilter] = useState<string>(initialGroup);
  const activeRequest = useRef<AbortController | null>(null);
  const [search, setSearch] = useState("");
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [linking, setLinking] = useState<Candidate | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [queueing, setQueueing] = useState(false);
  // A selection only means something for the rows on screen.
  useEffect(() => setSelected(new Set()), [groupFilter, search]);
  const [error, setError] = useState<string | null>(null);
  const [syncToast, setSyncToast] = useState<string | null>(null);

  const fetchCandidates = useCallback(async (refreshEvidence = false) => {
    activeRequest.current?.abort();
    const controller = new AbortController();
    activeRequest.current = controller;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (groupFilter) params.set("group", groupFilter);
      if (refreshEvidence) params.set("refresh", "1");
      if (search.trim()) params.set("search", search.trim());
      const res = await fetch(`/api/inspections/candidates?${params.toString()}`, {signal:controller.signal,cache:'no-store'});
      const data = await res.json();
      if (controller.signal.aborted) return;
      if (!res.ok) throw new Error(data.error || "Failed to load candidates");
      setCandidates(data.candidates || []);
      setCounts(data.review_counts || {ready:0,handled:0,confirmation:0});
      setCheckedAt(data.checked_at || null);
      setVerificationError(data.verification_error || null);
    } catch (err) {
      if (controller.signal.aborted) return;
      setError(err instanceof Error ? err.message : "Failed to load candidates");
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [groupFilter, search]);

  useEffect(() => {
    setGroupFilter(initialGroup);
  }, [initialGroup]);

  useEffect(() => {
    fetchCandidates();
    return () => activeRequest.current?.abort();
  }, [fetchCandidates]);

  async function handleSync() {
    setSyncing(true);
    setSyncToast(null);
    try {
      const res = await fetch("/api/inspections/candidates/sync", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Sync failed");
      setSyncToast(
        `Synced ${data.checked} units. Reviewing appointments, completions, and dates before scheduling.`
      );
      await fetchCandidates();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sync failed");
    } finally {
      setSyncing(false);
    }
  }

  async function handleRoutinePolicy(id: string, enabled: boolean) {
    try {
      const res = await fetch('/api/inspections/routine-policy', {method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({property_ids:[id],enabled})});
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to update routine policy');
      await fetchCandidates();
    } catch (err) { setError(err instanceof Error ? err.message : 'Failed to update routine policy'); }
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

  async function handleAddToQueue(ids: string[]) {
    setQueueing(true);
    setError(null);
    try {
      const res = await fetch("/api/inspections/candidates/queue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ candidate_ids: ids }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to add to queue");
      const onRoute = data.on_route ? `, ${data.on_route} already on a route` : "";
      setSyncToast(
        `Added ${data.queued} to the inspection queue${onRoute}. Route them in Route Builder → Pick Properties.`
      );
      setSelected(new Set());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add to queue");
    } finally {
      setQueueing(false);
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

  const readyRows = loading ? [] : candidates.filter((c) => c.review_group === "ready" && (!groupFilter || c.review_group === groupFilter));

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
            Next due date is six months after the later of move-in or last inspection. AppFolio’s Unit Inspection report date is trusted even if its inspection status is still open. Only work due within 21 days is ready to schedule.
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
            disabled={loading || syncing || !!verificationError || counts.ready === 0}
            className={cn(
              "flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors",
              "bg-charcoal-900 text-white hover:bg-charcoal-800 disabled:opacity-40 disabled:cursor-not-allowed"
            )}
          >
            <CalendarPlus className="w-4 h-4" />
            Schedule ready ({counts.ready})
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

      {verificationError && <div role="alert" className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">{verificationError}</div>}
      <div className="text-sm text-charcoal-600">
        {checkedAt ? `AppFolio history checked ${new Date(checkedAt).toLocaleString()}.` : 'Checking AppFolio unit and inspection records.'}
        {' '}Items needing confirmation are not included in scheduling alerts or automatic routes. Correct the source record in AppFolio, then refresh this review.
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <StatusTile icon={<CalendarPlus className="w-4 h-4" />} label="Ready to schedule" value={counts.ready} color="blue" active={groupFilter==='ready'} onClick={()=>setGroupFilter('ready')} />
        <StatusTile icon={<CheckCircle2 className="w-4 h-4" />} label="Already handled / not due" value={counts.handled} color="emerald" active={groupFilter==='handled'} onClick={()=>setGroupFilter('handled')} />
        <StatusTile icon={<AlertTriangle className="w-4 h-4" />} label="Needs confirmation" value={counts.confirmation} color="amber" active={groupFilter==='confirmation'} onClick={()=>setGroupFilter('confirmation')} />
      </div>
      {groupFilter==='confirmation' && <p className="text-sm text-charcoal-600">This is a record-review list, not a count of missed inspections. It includes uncertain unit matches, open AppFolio records, and unmatched local completions; some items may refer to the same unit.</p>}

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
          value={groupFilter}
          onChange={(e) => setGroupFilter(e.target.value)}
          className="px-3 py-2 border border-charcoal-300 rounded-lg text-sm bg-white"
        >
          <option value="">All groups</option>
          <option value="ready">Ready to schedule</option>
          <option value="handled">Already handled / not due</option>
          <option value="confirmation">Needs confirmation</option>
        </select>
        <button
          onClick={() => fetchCandidates(true)}
          className="px-3 py-2 border border-charcoal-300 rounded-lg text-sm hover:bg-charcoal-50 flex items-center gap-2"
        >
          <RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} />
          Refresh review
        </button>
      </div>

      {selected.size > 0 && (
        <div className="flex items-center gap-3 rounded-xl border border-blue-200 bg-blue-50 px-4 py-2 text-sm">
          <span className="font-medium text-blue-900">{selected.size} selected</span>
          <button
            onClick={() => handleAddToQueue([...selected])}
            disabled={queueing}
            className="px-3 py-1.5 rounded-lg bg-charcoal-900 text-white text-xs font-medium hover:bg-charcoal-800 disabled:opacity-50"
          >
            {queueing ? "Adding..." : `Add ${selected.size} to queue`}
          </button>
          <button onClick={() => setSelected(new Set())} className="text-xs text-charcoal-600 hover:underline">
            Clear
          </button>
        </div>
      )}

      {/* Table */}
      <div className="bg-white border border-charcoal-200 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-charcoal-200">
            <thead className="bg-charcoal-50">
              <tr className="text-left text-xs font-semibold text-charcoal-600 uppercase tracking-wide">
                <th className="pl-4 py-3 w-8">
                  {readyRows.length > 0 && (
                    <input
                      type="checkbox"
                      aria-label="Select all ready units"
                      checked={readyRows.every((c) => selected.has(c.id))}
                      onChange={(e) => setSelected(e.target.checked ? new Set(readyRows.map((c) => c.id)) : new Set())}
                    />
                  )}
                </th>
                <th className="px-4 py-3">Property</th>
                <th className="px-4 py-3">Address</th>
                <th className="px-4 py-3">Move-in</th>
                <th className="px-4 py-3">Last Inspection</th>
                <th className="px-4 py-3">Next due</th>
                <th className="px-4 py-3">Review</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-charcoal-100">
              {loading && (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-sm text-charcoal-500">
                    Loading…
                  </td>
                </tr>
              )}
              {!loading && candidates.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-sm text-charcoal-500">
                    No candidates match the current filters. Try "Sync from AppFolio" to refresh.
                  </td>
                </tr>
              )}
              {!loading && candidates.filter(c => !groupFilter || c.review_group === groupFilter).map((c) => (
                <tr key={c.id} className="text-sm text-charcoal-800">
                  <td className="pl-4 py-3 w-8">
                    {c.review_group === "ready" && (
                      <input
                        type="checkbox"
                        aria-label={`Select ${c.address_1}`}
                        checked={selected.has(c.id)}
                        onChange={() => setSelected((prev) => {
                          const next = new Set(prev);
                          if (next.has(c.id)) next.delete(c.id); else next.add(c.id);
                          return next;
                        })}
                      />
                    )}
                  </td>
                  <td className="px-4 py-3 font-medium">
                    {c.name || c.appfolio_property_id || "—"}
                  </td>
                  <td className="px-4 py-3">
                    <div>{c.address_1}{c.address_2 ? ` ${c.address_2}` : ""}</div>
                    <div className="text-xs text-charcoal-500">
                      {c.city}, {c.state} {c.zip}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-xs">{formatDate(c.move_in_date)}</td>
                  <td className="px-4 py-3">{formatDate(c.last_inspection_date)}</td>
                  <td className="px-4 py-3 text-xs">{formatDate(c.next_due_date)}
                    {c.review_group==='ready' && (c.latitude==null || c.longitude==null) && <div className="text-amber-700 mt-1">Geocoding needed before routing</div>}
                  </td>
                  <td className="px-4 py-3 max-w-sm">
                    <span className={cn('inline-block px-2 py-0.5 rounded-full text-xs font-medium',GROUP_COLORS[c.review_group])}>{GROUP_LABELS[c.review_group]}</span>
                    <div className="text-xs text-charcoal-600 mt-1">{c.review_reason}</div>
                    {c.evidence_status && <div className="text-xs text-charcoal-500 mt-1">Record: {c.evidence_status} · {formatDate(c.evidence_date)}</div>}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {c.review_group === "ready" && (
                      <button
                        onClick={() => handleAddToQueue([c.id])}
                        disabled={queueing}
                        className="block ml-auto mb-2 text-xs font-medium text-charcoal-900 hover:underline disabled:opacity-50"
                      >
                        Add to queue
                      </button>
                    )}
                    {c.appfolio_url && <a href={c.appfolio_url} target="_blank" rel="noopener noreferrer" className="block mb-2 text-xs text-blue-700 hover:underline">Open AppFolio unit</a>}
                    {c.review_item_type==='completion' ? <button onClick={() => setLinking(c)} className="text-xs text-blue-700 hover:underline">Link to unit</button> : <>
                    <button onClick={() => handleRoutinePolicy(c.id, c.routine_inspections_enabled === false)} className="block ml-auto mb-2 text-xs text-amber-700 hover:underline">{c.routine_inspections_enabled === false ? "Enable routine inspections" : "Exclude routine inspections"}</button>
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
                    ) : c.review_group === "confirmation" ? (
                      // Flagged scheduled but no live appointment: put it back up for review.
                      <button
                        onClick={() => handleRestore(c.id)}
                        className="text-xs text-terra-600 hover:text-terra-700"
                      >
                        Return to queue
                      </button>
                    ) : null}
                    </>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {linking && (
        <LinkUnitModal
          completion={linking}
          onClose={() => setLinking(null)}
          onLinked={async () => {
            setLinking(null);
            await fetchCandidates(true);
          }}
        />
      )}

      {scheduleOpen && (
        <ScheduleModal
          eligibleCount={counts.ready}
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
  const minDate = shiftInspectionDate(inspectionToday(), 7);
  const maxDate = inspectionHorizon();
  const [startDate, setStartDate] = useState(minDate);
  const [endDate, setEndDate] = useState(maxDate);
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
          <h3 className="text-base font-bold text-charcoal-900">Schedule Verified Inspections</h3>
          <p className="text-xs text-charcoal-500 mt-1">
            Buckets {eligibleCount} verified {eligibleCount === 1 ? "unit" : "units"} into proximity-grouped daily routes.
          </p>
        </div>

        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-charcoal-700 mb-1">Start date</label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              min={minDate}
              max={maxDate}
              className="w-full px-3 py-2 border border-charcoal-300 rounded-lg text-sm"
            />
            <p className="text-xs text-charcoal-500 mt-1">Schedule 7–21 days ahead for tenant notices.</p>
          </div>
          <div>
            <label className="block text-xs font-medium text-charcoal-700 mb-1">End date</label>
            <input
              type="date"
              value={endDate}
              min={startDate}
              max={maxDate}
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

/** A street number and the word after it ("2002 SW") — a useful first search. */
function addressSeed(address: string | null): string {
  return address?.match(/\b\d+[A-Za-z]?\s+\S+/)?.[0] ?? "";
}

function LinkUnitModal({
  completion,
  onClose,
  onLinked,
}: {
  completion: Candidate;
  onClose: () => void;
  onLinked: () => Promise<void>;
}) {
  const inspectionId = completion.id.replace(/^completion:/, "");
  const [query, setQuery] = useState(addressSeed(completion.address_1));
  const [units, setUnits] = useState<Candidate[]>([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<Candidate | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const needle = query.trim();
    if (needle.length < 2) {
      setUnits([]);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(`/api/inspections/candidates?search=${encodeURIComponent(needle)}`, { signal: controller.signal, cache: "no-store" });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Search failed");
        setUnits((data.candidates || []).filter((u: Candidate) => u.review_item_type === "candidate").slice(0, 25));
      } catch (err) {
        if (!controller.signal.aborted) setError(err instanceof Error ? err.message : "Search failed");
      } finally {
        if (!controller.signal.aborted) setSearching(false);
      }
    }, 300);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  async function handleLink() {
    if (!selected) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/inspections/candidates/link-completion", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inspection_id: inspectionId, property_id: selected.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Link failed");
      await onLinked();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Link failed");
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="bg-white rounded-xl shadow-card-hover w-full max-w-lg p-6 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div>
          <h3 className="text-base font-bold text-charcoal-900">Link inspection to a unit</h3>
          <p className="text-xs text-charcoal-500 mt-1">
            Completed {formatDate(completion.last_inspection_date)} at {completion.address_1}. Pick the unit that was
            inspected; it will be credited with this visit and its next inspection set 6 months out.
          </p>
        </div>

        <input
          type="text"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setSelected(null); }}
          placeholder="Search address, owner, property name..."
          autoFocus
          className="w-full rounded-lg border border-charcoal-200 px-3 py-2 text-sm"
        />

        <div className="max-h-72 overflow-y-auto rounded-lg border border-charcoal-100 divide-y divide-charcoal-100">
          {searching ? (
            <div className="p-4 text-center text-xs text-charcoal-400">Searching...</div>
          ) : units.length === 0 ? (
            <div className="p-4 text-center text-xs text-charcoal-400">
              {query.trim().length < 2 ? "Type at least 2 characters" : "No units match"}
            </div>
          ) : (
            units.map((u) => (
              <button
                key={u.id}
                type="button"
                onClick={() => setSelected(u)}
                className={cn(
                  "w-full text-left px-3 py-2 hover:bg-charcoal-50",
                  selected?.id === u.id && "bg-terra-50"
                )}
              >
                <div className="text-xs font-medium text-charcoal-800">
                  {u.address_1}{u.address_2 ? ` ${u.address_2}` : ""}
                </div>
                <div className="text-[10px] text-charcoal-500">
                  {[u.name, u.city, u.owner_name].filter(Boolean).join(" • ")}
                  {` • Last inspected ${formatDate(u.last_inspection_date)}`}
                </div>
              </button>
            ))
          )}
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-sm text-red-700">{error}</div>
        )}

        <div className="flex items-center justify-end gap-3">
          <button
            onClick={onClose}
            disabled={saving}
            className="px-4 py-2 rounded-lg text-sm font-medium text-charcoal-700 hover:bg-charcoal-50 disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            onClick={handleLink}
            disabled={!selected || saving}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-charcoal-900 text-white hover:bg-charcoal-800 disabled:opacity-50"
          >
            {saving ? "Linking..." : "Link to this unit"}
          </button>
        </div>
      </div>
    </div>
  );
}
