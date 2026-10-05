"use client";

import { buildInspectionOutlook } from "@/lib/inspection-outlook";

import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  RefreshCw,
  Upload,
  MapPin,
  Search,
  ChevronDown,
  CheckCircle2,
  AlertTriangle,
  ClipboardCheck,
  Users,
  Calendar,
  MoreHorizontal,
  BarChart3,
  List,
  Bell,
  X as XIcon,
  ExternalLink,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { buildRealmxRequest, longDate, noticeDateLine, realmxEnabled } from "@/lib/inspection-realmx-request";
import { SkeletonCard, SkeletonRows } from "@/components/ui/skeleton";

// AppFolio "Letters" deep link. Opens the saved "Inspection Letter — TENANT
// NOTIFICATION" template (id 197) in edit mode: Communication → Letters. AppFolio
// has no send API and recipients are chosen in-page (search each unit, check the
// resident), so this lands staff on the exact template; the per-date inspection
// date + per-unit address/resident below make recipient selection one search each.
const APPFOLIO_WEB_BASE = "https://highdesertpm.appfolio.com";
const APPFOLIO_INSPECTION_LETTER_ID = 197;
const APPFOLIO_INSPECTION_LETTER_URL = `${APPFOLIO_WEB_BASE}/letter_writing/tenant_letters/${APPFOLIO_INSPECTION_LETTER_ID}/edit`;

// ────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────

interface Inspection {
  id: string;
  property_id: string;
  routine_inspections_enabled?: boolean;
  property_name: string | null;
  address_1: string | null;
  unit_name: string | null;
  city: string | null;
  inspection_type: string | null;
  due_date: string | null;
  target_date: string | null;
  scheduled_route_id?: string | null;
  move_in_date: string | null;
  priority: string | null;
  assigned_to: string | null;
  status: string;
  resident_name: string | null;
  created_at: string;
  notice_status: string | null;
  notice_sent_at: string | null;
}

interface DueNotice {
  id: string;
  target_date: string | null;
  resident_name: string;
  email: string | null;
  address: string;
  subject: string;
  body: string;
  status?: string | null;
  attempts?: number;
  channel?: string | null;
  error?: string | null;
  route_plan_id?: string | null;
  route_assigned_to?: string | null;
  route_window?: string | null;
  arrival?: string | null;
  previous_target_date?: string | null;
  financially_responsible?: string[] | null;
  synced_at?: string | null;
}

interface DueNoticesResult {
  count: number;
  with_email: number;
  missing_email: number;
  notices: DueNotice[];
}

interface InspectionStats {
  review_counts?: {ready:number;handled:number;confirmation:number};
  verification_error?: string | null;
  scheduling_alert?: { total: number; overdue: number; upcoming: number; undated: number };
  total: number;
  overdue: number;
  this_week: number;
  week?: { routes: number; planned: number; pending: number; skipped: number; completed: number };
  completed: number;
  unassigned: number;
  assignees: string[];
}

type InspectionStatus =
  | "imported"
  | "validated"
  | "queued"
  | "scheduled"
  | "canceled"
  | "planned"
  | "dispatched"
  | "needs_review"
  | "in_progress"
  | "completed";

const STATUS_OPTIONS: { value: InspectionStatus | ""; label: string }[] = [
  { value: "", label: "All Statuses" },
  { value: "queued", label: "Needs scheduling" },
  { value: "scheduled", label: "Scheduled" },
  { value: "needs_review", label: "Needs review" },
  { value: "in_progress", label: "In Progress" },
  { value: "completed", label: "Completed" },
  { value: "canceled", label: "Canceled" },
];

const CITY_OPTIONS = [
  "",
  "Bend",
  "Redmond",
  "Sisters",
  "Prineville",
  "La Pine",
  "Madras",
  "Metolius",
];

const ASSIGNEE_OPTIONS = [
  { value: "brody@highdesertpm.com", label: "Brody" },
  { value: "matt@highdesertpm.com", label: "Matt" },
  { value: "craig@highdesertpm.com", label: "Craig" },
];

const STATUS_BADGE: Record<string, string> = {
  imported: "bg-charcoal-100 text-charcoal-700",
  validated: "bg-blue-100 text-blue-700",
  queued: "bg-amber-100 text-amber-700",
  scheduled: "bg-indigo-100 text-indigo-700",
  planned: "bg-indigo-100 text-indigo-700",
  dispatched: "bg-purple-100 text-purple-700",
  needs_review: "bg-amber-100 text-amber-800",
  in_progress: "bg-emerald-100 text-emerald-700",
  completed: "bg-green-100 text-green-700",
};

const PRIORITY_BADGE: Record<string, string> = {
  urgent: "bg-red-100 text-red-700",
  high: "bg-amber-100 text-amber-700",
  normal: "bg-charcoal-100 text-charcoal-600",
  low: "bg-charcoal-50 text-charcoal-500",
};

// ────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────

function dueDateClass(due: string | null): string {
  if (!due) return "text-charcoal-400";
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
  const now = new Date(`${today}T12:00:00Z`);
  const d = new Date(`${due.slice(0, 10)}T12:00:00Z`);
  const diffDays = Math.floor((d.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays < 0) return "text-red-600 font-medium";
  if (diffDays <= 7) return "text-amber-600 font-medium";
  return "text-green-600";
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "\u2014";
  const d = new Date(`${dateStr.slice(0, 10)}T12:00:00Z`);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

function formatStatus(status: string): string {
  if (status === "queued") return "Needs scheduling";
  return status
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// ────────────────────────────────────────────────
// Component
// ────────────────────────────────────────────────

export function InspectionDashboard() {
  const router = useRouter();
  const [inspections, setInspections] = useState<Inspection[]>([]);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<InspectionStats | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [geocoding, setGeocoding] = useState(false);
  const [geocodeProgress, setGeocodeProgress] = useState<{ completed: number; total: number } | null>(null);
  const [sendingNotices, setSendingNotices] = useState(false);
  const [noticeModal, setNoticeModal] = useState<DueNoticesResult | null>(null);
  const [markingSent, setMarkingSent] = useState(false);
  const [activeTab, setActiveTab] = useState<"queue" | "summary" | "all">("queue");
  const [showBulkModal, setShowBulkModal] = useState(false);
  const [bulkFilter, setBulkFilter] = useState({ fromStatus: "", beforeDate: "", toStatus: "" });
  const [bulkUpdating, setBulkUpdating] = useState(false);
  const [bulkResult, setBulkResult] = useState<string | null>(null);

  // Filters
  const [filterStatus, setFilterStatus] = useState("");
  const [filterCity, setFilterCity] = useState("");
  const [filterAssignee, setFilterAssignee] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const searchTimer = useRef<NodeJS.Timeout | null>(null);

  // Debounce search — wait 400ms after user stops typing
  const handleSearchChange = (value: string) => {
    setSearchInput(value);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      setSearchQuery(value);
    }, 400);
  };

  // Bulk actions
  const [bulkAssignee, setBulkAssignee] = useState("");
  const [bulkStatus, setBulkStatus] = useState("");
  const [bulkActioning, setBulkActioning] = useState(false);

  // ── Fetch inspections ──
  const fetchInspections = useCallback(async () => {
    try {
      setLoading(true);
      setSelected(new Set());
      const params = new URLSearchParams();
      params.set("view", activeTab === "summary" ? "outlook" : activeTab === "all" ? "all" : "active");
      if (filterStatus) params.set("status", filterStatus);
      if (filterCity) params.set("city", filterCity);
      if (filterAssignee) params.set("assigned_to", filterAssignee);
      if (searchQuery) params.set("search", searchQuery);
      // Fetch all inspections for summary view (need full dataset for 12-month chart)
      params.set("page_size", "2000");
      const qs = params.toString();
      const res = await fetch(`/api/inspections${qs ? `?${qs}` : ""}`);
      if (!res.ok) throw new Error("Failed to fetch inspections");
      const data = await res.json();
      // Flatten nested inspection_properties into each inspection row
      const flattened = (data.inspections || []).map((insp: Record<string, unknown>) => {
        const prop = (insp.inspection_properties || {}) as Record<string, unknown>;
        return {
          ...insp,
          property_name: prop.name || prop.address_1 || null,
          address_1: prop.address_1 || null,
          unit_name: insp.unit_name || prop.address_2 || null,
          city: prop.city || null,
          move_in_date: prop.move_in_date || null,
          last_inspection_date: prop.last_inspection_date || null,
        };
      });
      setInspections(flattened);

    } catch (err) {
      console.error("Fetch inspections error:", err);
    } finally {
      setLoading(false);
    }
  }, [filterStatus, filterCity, filterAssignee, searchQuery, activeTab]);

  // ── Fetch stats ──
  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch("/api/inspections/stats");
      if (!res.ok) throw new Error("Failed to fetch stats");
      const data = await res.json();
      setStats(data);
    } catch (err) {
      console.error("Fetch stats error:", err);
    }
  }, []);

  useEffect(() => {
    fetchInspections();
    fetchStats();
  }, [fetchInspections, fetchStats]);

  useEffect(() => {
    const refreshOnReturn = () => {
      if (document.visibilityState === "visible") void fetchStats();
    };
    window.addEventListener("focus", refreshOnReturn);
    document.addEventListener("visibilitychange", refreshOnReturn);
    return () => {
      window.removeEventListener("focus", refreshOnReturn);
      document.removeEventListener("visibilitychange", refreshOnReturn);
    };
  }, [fetchStats]);

  // ── Batch geocode with SSE progress ──
  const handleBatchGeocode = async () => {
    setGeocoding(true);
    setGeocodeProgress(null);
    try {
      const res = await fetch("/api/inspections/geocode", { method: "POST" });
      if (!res.ok) throw new Error("Geocode failed");

      const reader = res.body?.getReader();
      if (!reader) throw new Error("No stream");

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split("\n\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          const match = line.match(/^data: (.+)$/m);
          if (!match) continue;
          try {
            const event = JSON.parse(match[1]);
            if (event.type === "progress") {
              setGeocodeProgress({ completed: event.completed, total: event.total });
            }
          } catch { /* skip malformed */ }
        }
      }

      await fetchInspections();
      await fetchStats();
    } catch (err) {
      console.error("Geocode error:", err);
    } finally {
      setGeocoding(false);
      setGeocodeProgress(null);
    }
  };

  // ── Tenant inspection notices: load the "due" list to bulk-send via AppFolio ──
  // AppFolio has no send API and notices must be logged in AppFolio, so staff
  // send these through Realm-X Assistant ("Send Bulk Email"), then mark them sent.
  const handleSendNotices = async () => {
    setSendingNotices(true);
    try {
      const res = await fetch("/api/inspections/notify");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load due notices");
      setNoticeModal(data as DueNoticesResult);
    } catch (err) {
      alert(`Could not load notices: ${err instanceof Error ? err.message : err}`);
    } finally {
      setSendingNotices(false);
    }
  };

  const handleMarkNoticesSent = async (ids: string[]): Promise<string[]> => {
    if (!ids.length) return [];
    setMarkingSent(true);
    try {
      const res = await fetch("/api/inspections/notify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to mark sent");
      // Keep the window open on the remaining routes.
      const refreshed = await fetch("/api/inspections/notify");
      if (refreshed.ok) setNoticeModal((await refreshed.json()) as DueNoticesResult);
      await fetchInspections();
      return Array.isArray(data.late) ? data.late : [];
    } catch (err) {
      alert(`Mark sent failed: ${err instanceof Error ? err.message : err}`);
      return [];
    } finally {
      setMarkingSent(false);
    }
  };

  // ── Bulk assign ──
  const handleBulkAssign = async () => {
    if (!bulkAssignee) return;
    setBulkActioning(true);
    try {
      const res = await fetch("/api/inspections/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ids: Array.from(selected),
          action: "assign",
          value: bulkAssignee,
        }),
      });
      if (!res.ok) throw new Error("Bulk assign failed");
      await fetchInspections();
      await fetchStats();
      setSelected(new Set());
      setBulkAssignee("");
    } catch (err) {
      console.error("Bulk assign error:", err);
    } finally {
      setBulkActioning(false);
    }
  };

  // ── Bulk status change ──
  const handleBulkStatus = async () => {
    if (!bulkStatus) return;
    setBulkActioning(true);
    try {
      const res = await fetch("/api/inspections/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ids: Array.from(selected),
          action: "status",
          value: bulkStatus,
        }),
      });
      if (!res.ok) throw new Error("Bulk status change failed");
      await fetchInspections();
      await fetchStats();
      setSelected(new Set());
      setBulkStatus("");
    } catch (err) {
      console.error("Bulk status error:", err);
    } finally {
      setBulkActioning(false);
    }
  };

  // ── Bulk update by filter ──
  const handleBulkFilterUpdate = async () => {
    if (!bulkFilter.fromStatus || !bulkFilter.toStatus) return;
    const desc = `Change all "${bulkFilter.fromStatus}" inspections${bulkFilter.beforeDate ? ` before ${bulkFilter.beforeDate}` : ""} to "${bulkFilter.toStatus}"`;
    if (!confirm(`${desc}?\n\nThis cannot be undone.`)) return;
    setBulkUpdating(true);
    setBulkResult(null);
    try {
      const filter: Record<string, string> = { status: bulkFilter.fromStatus };
      if (bulkFilter.beforeDate) filter.before_date = bulkFilter.beforeDate;
      const res = await fetch("/api/inspections/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filter, action: "status", value: bulkFilter.toStatus }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Bulk update failed");
      setBulkResult(`Updated ${data.updated} inspections`);
      await fetchInspections();
      await fetchStats();
    } catch (err) {
      setBulkResult(`Error: ${err instanceof Error ? err.message : err}`);
    } finally {
      setBulkUpdating(false);
    }
  };

  const handleRoutinePolicy = async (enabled: boolean) => {
    setBulkActioning(true);
    try {
      const property_ids = [...new Set(inspections.filter(i => selected.has(i.id)).map(i => i.property_id))];
      const res = await fetch('/api/inspections/routine-policy', {method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({property_ids,enabled})});
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to update routine inspection policy');
      await fetchInspections(); await fetchStats();
    } catch (err) { alert(err instanceof Error ? err.message : 'Failed to update routine inspection policy'); }
    finally { setBulkActioning(false); }
  };

  // ── Build route from selected inspections ──
  const handleAddToRoute = async () => {
    // Navigate to Route Builder with selected IDs pre-loaded
    const ids = Array.from(selected).join(",");
    router.push(`/maintenance/inspections/routes?ids=${ids}`);

  };

  // ── Select helpers ──
  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selected.size === inspections.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(inspections.map((i) => i.id)));
    }
  };

  // ────────────────────────────────────────────────
  // Render
  // ────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {Array.from({ length: 4 }, (_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
        <div className="rounded-xl border border-sand-200 bg-white shadow-card p-4">
          <SkeletonRows rows={8} />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* ── Header ── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-charcoal-900">Inspection Queue</h1>
          <p className="text-charcoal-500 text-sm mt-1">
            {activeTab === "queue" ? "Overdue, due within 21 days, and scheduled inspections" : activeTab === "summary" ? "Upcoming work by scheduled date or next due date" : "All inspections, including completed and canceled records"}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/maintenance/inspections/candidates"
            className={cn(
              "flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors",
              "bg-blue-500 text-white hover:bg-blue-600"
            )}
          >
            <ClipboardCheck className="w-4 h-4" />
            AppFolio Candidates
          </Link>
          <Link
            href="/maintenance/inspections/import"
            className={cn(
              "flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors",
              "border border-charcoal-300 text-charcoal-700 hover:bg-charcoal-50"
            )}
          >
            <Upload className="w-4 h-4" />
            Import XLSX
          </Link>
          <button
            onClick={handleSendNotices}
            disabled={sendingNotices}
            className={cn(
              "flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors",
              "border border-charcoal-300 text-charcoal-700 hover:bg-charcoal-50 disabled:opacity-60"
            )}
          >
            <Bell className={cn("w-4 h-4", sendingNotices && "animate-pulse")} />
            {sendingNotices ? "Sending..." : "Send Notices"}
          </button>
          <button
            onClick={handleBatchGeocode}
            disabled={geocoding}
            className={cn(
              "flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors",
              "border border-charcoal-300 text-charcoal-700 hover:bg-charcoal-50 disabled:opacity-60"
            )}
          >
            <MapPin className={cn("w-4 h-4", geocoding && "animate-pulse")} />
            {geocoding
              ? geocodeProgress
                ? `Geocoding ${geocodeProgress.completed}/${geocodeProgress.total}`
                : "Geocoding..."
              : "Batch Geocode"}
          </button>
        </div>
      </div>

      {/* ── Tenant Notices Modal ── */}
      {noticeModal && (
        <NoticeModal
          result={noticeModal}
          marking={markingSent}
          onClose={() => setNoticeModal(null)}
          onMarkSent={handleMarkNoticesSent}
        />
      )}

      {/* ── Bulk Update Modal ── */}
      {showBulkModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-card-hover w-full max-w-md p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-charcoal-900">Bulk Status Update</h3>
              <button onClick={() => setShowBulkModal(false)} className="text-charcoal-400 hover:text-charcoal-600 text-xl">&times;</button>
            </div>
            <p className="text-sm text-charcoal-500">Change all inspections matching a filter to a new status.</p>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-charcoal-600 mb-1">Current Status</label>
                <select
                  value={bulkFilter.fromStatus}
                  onChange={(e) => setBulkFilter({ ...bulkFilter, fromStatus: e.target.value })}
                  className="w-full border border-charcoal-300 rounded-lg px-3 py-2 text-sm"
                >
                  <option value="">Select status...</option>
                  <option value="imported">Imported</option>
                  <option value="validated">Validated</option>
                  <option value="queued">Queued</option>
                  <option value="scheduled">Scheduled</option>
                  <option value="in_progress">In Progress</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-charcoal-600 mb-1">Due Date Before (optional)</label>
                <input
                  type="date"
                  value={bulkFilter.beforeDate}
                  onChange={(e) => setBulkFilter({ ...bulkFilter, beforeDate: e.target.value })}
                  className="w-full border border-charcoal-300 rounded-lg px-3 py-2 text-sm"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-charcoal-600 mb-1">Change To</label>
                <select
                  value={bulkFilter.toStatus}
                  onChange={(e) => setBulkFilter({ ...bulkFilter, toStatus: e.target.value })}
                  className="w-full border border-charcoal-300 rounded-lg px-3 py-2 text-sm"
                >
                  <option value="">Select new status...</option>
                  <option value="imported">Imported</option>
                  <option value="validated">Validated</option>
                  <option value="queued">Queued</option>
                  <option value="scheduled">Scheduled</option>
                  <option value="completed">Completed</option>
                  <option value="skipped">Skipped</option>
                </select>
              </div>
            </div>

            {bulkResult && (
              <div className={cn(
                "text-sm px-3 py-2 rounded-lg",
                bulkResult.startsWith("Error") ? "bg-red-50 text-red-700" : "bg-green-50 text-green-700"
              )}>
                {bulkResult}
              </div>
            )}

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                onClick={() => setShowBulkModal(false)}
                className="px-4 py-2 rounded-lg text-sm text-charcoal-600 hover:bg-charcoal-100"
              >
                Cancel
              </button>
              <button
                onClick={handleBulkFilterUpdate}
                disabled={bulkUpdating || !bulkFilter.fromStatus || !bulkFilter.toStatus}
                className={cn(
                  "px-4 py-2 rounded-lg text-sm font-medium text-white transition-colors",
                  "bg-terra-500 hover:bg-terra-600 disabled:opacity-50"
                )}
              >
                {bulkUpdating ? "Updating..." : "Update Inspections"}
              </button>
            </div>
          </div>
        </div>
      )}

      {stats?.review_counts && stats.review_counts.confirmation > 0 && (
        <div className="rounded-xl border border-charcoal-200 bg-charcoal-50 p-4 flex flex-wrap items-center justify-between gap-3">
          <div><p className="font-semibold text-charcoal-900">{stats.review_counts.confirmation} records need confirmation</p>
          <p className="text-sm text-charcoal-600">These are not counted as overdue work to schedule. Review unit matches, move-in dates, and open inspection records first.</p>
          {stats.verification_error && <p className="text-sm text-amber-800 mt-1">{stats.verification_error}</p>}</div>
          <Link href="/maintenance/inspections/candidates?group=confirmation" className="text-sm font-medium text-blue-700 hover:underline">Review records</Link>
        </div>
      )}

      {stats?.scheduling_alert && stats.scheduling_alert.total > 0 && (
        <div role="status" className="rounded-xl border border-amber-200 bg-amber-50 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex gap-3">
            <Bell className="w-5 h-5 text-amber-700 shrink-0 mt-0.5" aria-hidden="true" />
            <div>
              <p className="font-semibold text-charcoal-900">
                {stats.scheduling_alert.total} {stats.scheduling_alert.total === 1 ? "inspection needs" : "inspections need"} scheduling
              </p>
              <p className="text-sm text-charcoal-700">
                {stats.scheduling_alert.overdue} overdue · {stats.scheduling_alert.upcoming} upcoming
                {stats.scheduling_alert.undated > 0 && ` · ${stats.scheduling_alert.undated} need a due date reviewed`}
              </p>
              <p className="text-xs text-charcoal-500 mt-1">Only verified candidates are included. Uncertain history is held for confirmation. Schedule routes 7–21 days ahead.</p>
            </div>
          </div>
          <Link href="/maintenance/inspections/candidates" className="shrink-0 rounded-lg bg-amber-700 px-4 py-2 text-sm font-medium text-white hover:bg-amber-800">
            Review &amp; schedule
          </Link>
        </div>
      )}

      {/* ── Stats Bar ── */}
      {stats && activeTab === "queue" && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
          <div className="bg-white rounded-xl shadow-card border border-charcoal-200 p-4">
            <div className="flex items-center gap-2 mb-1">
              <ClipboardCheck className="w-4 h-4 text-blue-500" />
              <span className="text-xs font-medium text-charcoal-500">Total in Queue</span>
            </div>
            <p className="text-2xl font-bold text-blue-600">{stats.total}</p>
          </div>
          <div className="bg-white rounded-xl shadow-card border border-charcoal-200 p-4">
            <div className="flex items-center gap-2 mb-1">
              <AlertTriangle className="w-4 h-4 text-red-500" />
              <span className="text-xs font-medium text-charcoal-500">Overdue to Schedule</span>
            </div>
            <p className="text-2xl font-bold text-red-600">{stats.overdue}</p>
            <Link href="/maintenance/inspections/candidates" className="text-xs text-red-700 hover:underline">Review unscheduled candidates</Link>
          </div>
          <div className="bg-white rounded-xl shadow-card border border-charcoal-200 p-4">
            <div className="flex items-center gap-2 mb-1">
              <Calendar className="w-4 h-4 text-amber-500" />
              <span className="text-xs font-medium text-charcoal-500">Route Visits This Week</span>
            </div>
            <p className="text-2xl font-bold text-amber-600">{stats.this_week}</p>
            {stats.week && <p className="text-xs text-charcoal-500 mt-1">
              {stats.week.routes} routes · {stats.week.pending} pending · {stats.week.skipped} skipped
              {stats.week.completed > 0 && ` · ${stats.week.completed} completed`}
            </p>}
          </div>
          <div className="bg-white rounded-xl shadow-card border border-charcoal-200 p-4">
            <div className="flex items-center gap-2 mb-1">
              <CheckCircle2 className="w-4 h-4 text-green-500" />
              <span className="text-xs font-medium text-charcoal-500">Completed This Week</span>
            </div>
            <p className="text-2xl font-bold text-green-600">{stats.completed}</p>
          </div>
          <div className="bg-white rounded-xl shadow-card border border-charcoal-200 p-4">
            <div className="flex items-center gap-2 mb-1">
              <Users className="w-4 h-4 text-charcoal-500" />
              <span className="text-xs font-medium text-charcoal-500">Unassigned</span>
            </div>
            <p className="text-2xl font-bold text-charcoal-700">{stats.unassigned}</p>
          </div>
        </div>
      )}

      {/* ── Filters Row ── */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative">
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="appearance-none bg-white border border-charcoal-300 rounded-lg px-3 py-2 pr-8 text-sm text-charcoal-700 focus:outline-none focus:ring-2 focus:ring-terra-400 focus:border-transparent"
          >
            {STATUS_OPTIONS.filter(opt => activeTab === "all" || !["completed", "canceled"].includes(opt.value)).map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-charcoal-400 pointer-events-none" />
        </div>

        <div className="relative">
          <select
            value={filterCity}
            onChange={(e) => setFilterCity(e.target.value)}
            className="appearance-none bg-white border border-charcoal-300 rounded-lg px-3 py-2 pr-8 text-sm text-charcoal-700 focus:outline-none focus:ring-2 focus:ring-terra-400 focus:border-transparent"
          >
            <option value="">All Cities</option>
            {CITY_OPTIONS.filter(Boolean).map((city) => (
              <option key={city} value={city}>
                {city}
              </option>
            ))}
          </select>
          <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-charcoal-400 pointer-events-none" />
        </div>

        <div className="relative">
          <select
            value={filterAssignee}
            onChange={(e) => setFilterAssignee(e.target.value)}
            className="appearance-none bg-white border border-charcoal-300 rounded-lg px-3 py-2 pr-8 text-sm text-charcoal-700 focus:outline-none focus:ring-2 focus:ring-terra-400 focus:border-transparent"
          >
            <option value="">All Assignees</option>
            {ASSIGNEE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-charcoal-400 pointer-events-none" />
        </div>

        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-charcoal-400" />
          <input
            type="text"
            placeholder="Search by address, tenant, or property..."
            value={searchInput}
            onChange={(e) => handleSearchChange(e.target.value)}
            className="w-full bg-white border border-charcoal-300 rounded-lg pl-9 pr-3 py-2 text-sm text-charcoal-700 placeholder:text-charcoal-400 focus:outline-none focus:ring-2 focus:ring-terra-400 focus:border-transparent"
          />
        </div>
      </div>

      <p className="text-xs text-charcoal-500">Scheduled means a route appointment today or later. Past unfinished appointments need review. In progress means the inspection was started today on today’s route.</p>

      {/* ── Bulk Action Bar ── */}
      {selected.size > 0 && (
        <div className="bg-charcoal-900 text-white rounded-lg px-4 py-3 flex items-center justify-between">
          <span className="text-sm font-medium">{selected.size} selected</span>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <select
                value={bulkAssignee}
                onChange={(e) => setBulkAssignee(e.target.value)}
                className="appearance-none bg-white/10 border border-white/20 rounded-md px-2 py-1.5 text-xs text-white focus:outline-none focus:ring-1 focus:ring-white/40"
              >
                <option value="">Assign To...</option>
                {ASSIGNEE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value} className="text-charcoal-900">
                    {opt.label}
                  </option>
                ))}
              </select>
              <button
                onClick={handleBulkAssign}
                disabled={!bulkAssignee || bulkActioning}
                className="px-3 py-1.5 rounded-md text-xs font-medium bg-white/10 hover:bg-white/20 transition-colors disabled:opacity-40"
              >
                Assign
              </button>
            </div>

            <div className="w-px h-5 bg-white/20" />

            <div className="flex items-center gap-2">
              <select
                value={bulkStatus}
                onChange={(e) => setBulkStatus(e.target.value)}
                className="appearance-none bg-white/10 border border-white/20 rounded-md px-2 py-1.5 text-xs text-white focus:outline-none focus:ring-1 focus:ring-white/40"
              >
                <option value="">Change Status...</option>
                {STATUS_OPTIONS.filter((o) => ["completed", "canceled"].includes(o.value)).map((opt) => (
                  <option key={opt.value} value={opt.value} className="text-charcoal-900">
                    {opt.label}
                  </option>
                ))}
              </select>
              <button
                onClick={handleBulkStatus}
                disabled={!bulkStatus || bulkActioning}
                className="px-3 py-1.5 rounded-md text-xs font-medium bg-white/10 hover:bg-white/20 transition-colors disabled:opacity-40"
              >
                Update
              </button>
            </div>

            <div className="w-px h-5 bg-white/20" />

            <button onClick={() => handleRoutinePolicy(false)} disabled={bulkActioning} className="px-3 py-1.5 rounded-md text-xs bg-white/10 hover:bg-white/20 disabled:opacity-40">Exclude routine</button>
            {activeTab === "all" && <button onClick={() => handleRoutinePolicy(true)} disabled={bulkActioning} className="px-3 py-1.5 rounded-md text-xs bg-white/10 hover:bg-white/20 disabled:opacity-40">Enable routine</button>}
            <button
              onClick={handleAddToRoute}
              disabled={bulkActioning}
              className={cn(
                "px-4 py-1.5 rounded-md text-sm font-medium transition-colors",
                "bg-white text-charcoal-900 hover:bg-charcoal-100 disabled:opacity-60"
              )}
            >
              Build Route
            </button>
          </div>
        </div>
      )}

      {/* ── Tab Bar ── */}
      <div className="flex items-center gap-1 border-b border-charcoal-200">
        <button
          onClick={() => { setActiveTab("queue"); setFilterStatus(""); setSelected(new Set()); }}
          className={cn(
            "flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px",
            activeTab === "queue"
              ? "border-terra-500 text-terra-600"
              : "border-transparent text-charcoal-500 hover:text-charcoal-700 hover:border-charcoal-300"
          )}
        >
          <List className="w-4 h-4" />
          Inspection Queue
        </button>
        <button
          onClick={() => { setActiveTab("summary"); setFilterStatus(""); setSelected(new Set()); }}
          className={cn(
            "flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px",
            activeTab === "summary"
              ? "border-terra-500 text-terra-600"
              : "border-transparent text-charcoal-500 hover:text-charcoal-700 hover:border-charcoal-300"
          )}
        >
          <BarChart3 className="w-4 h-4" />
          12-Month Outlook
        </button>
        <button onClick={() => { setActiveTab("all"); setFilterStatus(""); setSelected(new Set()); }} className={cn("px-4 py-2.5 text-sm font-medium border-b-2 -mb-px", activeTab === "all" ? "border-terra-500 text-terra-600" : "border-transparent text-charcoal-500")}>
          All Inspections
        </button>
      </div>

      {/* ── 12-Month Summary View ── */}
      {activeTab === "summary" && (
        <MonthlySummary inspections={inspections} />
      )}

      {/* ── Table ── */}
      {activeTab !== "summary" && inspections.length === 0 ? (
        <div className="text-center py-16 text-charcoal-400">
          <ClipboardCheck className="w-10 h-10 mx-auto mb-3 text-charcoal-300" />
          <p className="font-medium">No inspections match this view</p>
          <p className="text-sm mt-1">
            Try changing the filters or open All Inspections to review history.
          </p>
          <Link
            href="/maintenance/inspections/import"
            className="inline-flex items-center gap-2 mt-4 px-4 py-2 rounded-lg text-sm font-medium bg-terra-500 text-white hover:bg-terra-600 transition-colors"
          >
            <Upload className="w-4 h-4" />
            Import Inspections
          </Link>
        </div>
      ) : activeTab !== "summary" ? (
        <div className="bg-white rounded-xl shadow-card border border-charcoal-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-charcoal-50 border-b border-charcoal-200">
                  <th className="w-10 px-3 py-3">
                    <input
                      type="checkbox"
                      checked={selected.size === inspections.length && inspections.length > 0}
                      onChange={toggleSelectAll}
                      className="rounded border-charcoal-300"
                    />
                  </th>
                  <th className="text-left px-3 py-3 font-semibold text-charcoal-600">Property</th>
                  <th className="text-left px-3 py-3 font-semibold text-charcoal-600 w-20">Unit</th>
                  <th className="text-left px-3 py-3 font-semibold text-charcoal-600">Type</th>
                  <th className="text-left px-3 py-3 font-semibold text-charcoal-600">Move In</th>
                  <th className="text-left px-3 py-3 font-semibold text-charcoal-600">Due Date</th>
                  <th className="text-left px-3 py-3 font-semibold text-charcoal-600">Scheduled Date</th>
                  <th className="text-left px-3 py-3 font-semibold text-charcoal-600">Priority</th>
                  <th className="text-left px-3 py-3 font-semibold text-charcoal-600 hidden lg:table-cell">Assigned To</th>
                  <th className="text-left px-3 py-3 font-semibold text-charcoal-600">Status</th>
                  <th className="text-left px-3 py-3 font-semibold text-charcoal-600 hidden lg:table-cell">Notice</th>
                  <th className="text-left px-3 py-3 font-semibold text-charcoal-600 hidden md:table-cell">City</th>
                  <th className="w-10 px-3 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-charcoal-100">
                {inspections.map((insp) => (
                  <tr
                    key={insp.id}
                    className={cn(
                      "hover:bg-charcoal-50 transition-colors",
                      selected.has(insp.id) && "bg-terra-50"
                    )}
                  >
                    <td className="px-3 py-3">
                      <input
                        type="checkbox"
                        checked={selected.has(insp.id)}
                        onChange={() => toggleSelect(insp.id)}
                        className="rounded border-charcoal-300"
                      />
                    </td>
                    <td className="px-3 py-3">
                      <div className="font-medium text-charcoal-900 truncate max-w-[200px]">
                        {insp.property_name || insp.address_1 || "\u2014"}
                      </div>
                      {insp.routine_inspections_enabled === false && <div className="text-xs text-amber-700">Routine inspections excluded</div>}
                      {insp.address_1 && insp.property_name && (
                        <div className="text-xs text-charcoal-400 truncate max-w-[200px]">
                          {insp.address_1}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-3 text-charcoal-600">
                      {insp.unit_name || "\u2014"}
                    </td>
                    <td className="px-3 py-3">
                      {insp.inspection_type ? (
                        <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-indigo-100 text-indigo-700">
                          {insp.inspection_type}
                        </span>
                      ) : (
                        <span className="text-charcoal-400">\u2014</span>
                      )}
                    </td>
                    <td className="px-3 py-3">
                      <span className="text-xs text-charcoal-500">
                        {insp.move_in_date ? formatDate(insp.move_in_date) : "\u2014"}
                      </span>
                    </td>
                    <td className="px-3 py-3">
                      <span className={cn("text-xs whitespace-nowrap", dueDateClass(insp.due_date))}>
                        {formatDate(insp.due_date)}
                      </span>
                    </td>
                    <td className="px-3 py-3">
                      <span className="text-xs whitespace-nowrap text-charcoal-600">
                        {insp.status === "needs_review" && <span className="block text-amber-700">Past appointment</span>}
                        {insp.scheduled_route_id ? <Link href={`/maintenance/inspections/routes/${insp.scheduled_route_id}`} className="text-blue-600 hover:underline">{formatDate(insp.target_date)} · View route</Link> : insp.target_date ? formatDate(insp.target_date) : "Not scheduled"}
                      </span>
                    </td>
                    <td className="px-3 py-3">
                      {insp.priority ? (
                        <span
                          className={cn(
                            "inline-flex px-2 py-0.5 rounded-full text-xs font-medium",
                            PRIORITY_BADGE[insp.priority] ?? "bg-charcoal-100 text-charcoal-600"
                          )}
                        >
                          {insp.priority.charAt(0).toUpperCase() + insp.priority.slice(1)}
                        </span>
                      ) : (
                        <span className="text-charcoal-400">\u2014</span>
                      )}
                    </td>
                    <td className="px-3 py-3 hidden lg:table-cell">
                      <span className="text-charcoal-600 truncate max-w-[120px] block">
                        {insp.assigned_to || "\u2014"}
                      </span>
                    </td>
                    <td className="px-3 py-3">
                      <span
                        className={cn(
                          "inline-flex px-2 py-0.5 rounded-full text-xs font-medium",
                          STATUS_BADGE[insp.status] ?? "bg-charcoal-100 text-charcoal-600"
                        )}
                      >
                        {formatStatus(insp.status)}
                      </span>
                    </td>
                    <td className="px-3 py-3 hidden lg:table-cell">
                      <NoticeBadge inspection={insp} />
                    </td>
                    <td className="px-3 py-3 hidden md:table-cell">
                      <span className="text-charcoal-500">{insp.city || "\u2014"}</span>
                    </td>
                    <td className="px-3 py-3">
                      <button
                        title="Actions"
                        className={cn(
                          "p-1.5 rounded-md transition-colors",
                          "text-charcoal-400 hover:text-charcoal-900 hover:bg-charcoal-100"
                        )}
                      >
                        <MoreHorizontal className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ────────────────────────────────────────────────
// Notice status badge
// ────────────────────────────────────────────────

function NoticeBadge({ inspection }: { inspection: Inspection }) {
  const { status, notice_status, notice_sent_at } = inspection;

  if (notice_sent_at || notice_status === "sent") {
    return (
      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">
        <CheckCircle2 className="w-3.5 h-3.5" /> Sent
      </span>
    );
  }
  if (notice_status === "skipped_no_email") {
    return (
      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700">
        <AlertTriangle className="w-3.5 h-3.5" /> No email
      </span>
    );
  }
  if (notice_status === "failed") {
    return (
      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700">
        <AlertTriangle className="w-3.5 h-3.5" /> Failed
      </span>
    );
  }
  if (status === "scheduled") {
    return (
      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium bg-charcoal-100 text-charcoal-500">
        <Bell className="w-3.5 h-3.5" /> Pending
      </span>
    );
  }
  return <span className="text-charcoal-300">—</span>;
}

// ────────────────────────────────────────────────
// Tenant Notices Modal — bulk-send via AppFolio Realm-X
// ────────────────────────────────────────────────

interface RecipientTenant {
  name: string;
  email: string | null;
  phone: string | null;
  financially_responsible: boolean;
  primary: boolean;
  move_in: string | null;
  move_out: string | null;
}
interface RecipientCheck { id: string; tenants: RecipientTenant[]; warnings: string[] }

function syncedAgo(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const hours = Math.round((Date.now() - new Date(iso).getTime()) / 3_600_000);
  if (!Number.isFinite(hours)) return null;
  return hours < 1 ? "synced <1 h ago" : hours < 48 ? `synced ${hours} h ago` : `synced ${Math.round(hours / 24)} days ago`;
}

function NoticeModal({
  result,
  marking,
  onClose,
  onMarkSent,
}: {
  result: DueNoticesResult;
  marking: boolean;
  onClose: () => void;
  onMarkSent: (ids: string[]) => Promise<string[]>;
}) {
  const [copied, setCopied] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [checks, setChecks] = useState<Map<string, RecipientCheck>>(new Map());
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState<string | null>(null);
  const [lateIds, setLateIds] = useState<string[]>([]);

  const copy = (key: string, text: string) => {
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(key);
      setTimeout(() => setCopied((c) => (c === key ? null : c)), 1500);
    });
  };

  // One section per route: one Realm-X bulk email (same date + window) per route.
  const groups = new Map<string, DueNotice[]>();
  for (const n of result.notices) {
    const key = n.route_plan_id || `date:${n.target_date || "none"}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(n);
  }
  const sortedKeys = [...groups.keys()].sort((a, b) =>
    (groups.get(a)![0].target_date || "").localeCompare(groups.get(b)![0].target_date || ""));

  const toggle = (id: string) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  async function recheckTenants() {
    setChecking(true);
    setCheckError(null);
    try {
      const ids = result.notices.map((n) => n.id).join(",");
      const res = await fetch(`/api/inspections/notify/recipients?ids=${encodeURIComponent(ids)}`, { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Tenant check failed");
      setChecks(new Map((data.results as RecipientCheck[]).map((r) => [r.id, r])));
    } catch (err) {
      setCheckError(err instanceof Error ? err.message : "Tenant check failed");
    } finally {
      setChecking(false);
    }
  }

  async function markSelected(ids: string[]) {
    const late = await onMarkSent(ids);
    setLateIds(late);
    setSelected((prev) => new Set([...prev].filter((id) => !ids.includes(id))));
  }

  const warningCount = [...checks.values()].filter((c) => c.warnings.length > 0).length;
  const realmx = realmxEnabled();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-card-hover w-full max-w-3xl max-h-[88vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between p-6 pb-4 border-b border-charcoal-200">
          <div>
            <h3 className="text-base font-bold text-charcoal-900">Send Tenant Inspection Notices</h3>
            {realmx ? (
              <p className="text-xs text-charcoal-500 mt-1 max-w-xl">
                For each route: click <b>Re-check tenants</b>, then <b>Copy Realm-X request</b> and paste it into
                AppFolio → Realm-X Assistant. Realm-X drafts the email to each unit&apos;s current tenants — check its
                recipients, send, then tick the units here and <b>Mark selected sent</b>.
              </p>
            ) : (
              <p className="text-xs text-charcoal-500 mt-1 max-w-xl">
                For each route: click <b>Re-check tenants</b>, then <b>Open Inspection Letter in AppFolio</b>. Paste
                the date (<b>Copy date</b>), search each unit (<b>Copy address</b>) and tick the people listed here,
                send, then tick the units here and <b>Mark selected sent</b>.
              </p>
            )}
          </div>
          <button onClick={onClose} className="p-1 hover:bg-charcoal-100 rounded-lg">
            <XIcon className="w-4 h-4 text-charcoal-400" />
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-3 px-6 py-2 text-xs text-charcoal-500 border-b border-charcoal-100">
          <span>
            {result.count} due &bull; {result.with_email} with email
            {result.missing_email > 0 && <span className="text-amber-600"> &bull; {result.missing_email} missing email</span>}
            {result.notices.some((n) => n.previous_target_date) && (
              <span className="text-blue-700"> &bull; {result.notices.filter((n) => n.previous_target_date).length} date changed</span>
            )}
          </span>
          <button
            onClick={recheckTenants}
            disabled={checking || result.count === 0}
            className="ml-auto px-2.5 py-1.5 rounded-md text-xs font-medium bg-charcoal-900 text-white hover:bg-charcoal-800 disabled:opacity-50"
            title="Pulls current tenants from AppFolio now"
          >
            {checking ? "Checking AppFolio…" : checks.size ? "Re-check tenants again" : "Re-check tenants"}
          </button>
        </div>
        {checkError && <div className="px-6 py-2 text-xs text-red-700 bg-red-50">{checkError}</div>}
        {checks.size > 0 && (
          <div className={cn("px-6 py-2 text-xs border-b", warningCount ? "bg-amber-50 text-amber-800 border-amber-100" : "bg-emerald-50 text-emerald-800 border-emerald-100")}>
            {warningCount ? `${warningCount} unit${warningCount === 1 ? " needs" : "s need"} attention before sending — see the warnings below.` : "Tenants match AppFolio for every unit."}
          </div>
        )}
        {lateIds.length > 0 && (
          <div className="px-6 py-2 text-xs bg-amber-50 text-amber-800 border-b border-amber-100">
            {lateIds.length} notice{lateIds.length === 1 ? " was" : "s were"} marked sent less than 7 days before the inspection.
          </div>
        )}

        <div className="overflow-y-auto px-6 py-4 space-y-4 flex-1">
          {result.count === 0 && (
            <p className="text-sm text-charcoal-500 py-8 text-center">No scheduled inspections are awaiting a notice.</p>
          )}
          {sortedKeys.map((key) => {
            const items = groups.get(key)!;
            const first = items[0];
            const dateKey = first.target_date;
            const dateChanged = items.some((n) => n.previous_target_date);
            const notice = dateKey
              ? buildRealmxRequest({ routeDate: dateKey, windowLabel: first.route_window, units: items.map((n) => ({ address: n.address })), dateChanged })
              : null;
            const emails = [...new Set(items.map((n) => n.email).filter(Boolean) as string[])];
            const groupIds = items.map((n) => n.id);
            const groupSelected = groupIds.filter((id) => selected.has(id));
            return (
              <div key={key} className="border border-charcoal-200 rounded-lg p-4">
                <div className="flex items-start justify-between gap-3 mb-2">
                  <div>
                    <p className="text-sm font-semibold text-charcoal-800">
                      {dateKey ? longDate(dateKey) : "No date"}
                      {first.route_window && <span className="font-normal text-charcoal-500"> &middot; {first.route_window}</span>}
                    </p>
                    <p className="text-xs text-charcoal-500">
                      {items.length} unit{items.length !== 1 ? "s" : ""}
                      {first.route_assigned_to && <> &bull; {first.route_assigned_to.split("@")[0]}</>}
                      {dateChanged && <span className="ml-1 text-blue-700 font-medium">&bull; Date changed — send the updated notice</span>}
                    </p>
                  </div>
                  <label className="flex items-center gap-1.5 text-xs text-charcoal-600">
                    <input
                      type="checkbox"
                      checked={groupSelected.length === groupIds.length}
                      onChange={(e) => setSelected((prev) => {
                        const next = new Set(prev);
                        for (const id of groupIds) if (e.target.checked) next.add(id); else next.delete(id);
                        return next;
                      })}
                    />
                    All
                  </label>
                </div>

                <div className="flex flex-wrap items-center gap-2 mb-3">
                  {realmx && notice && (
                    <button
                      onClick={() => copy(`rx-${key}`, notice.request)}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-semibold bg-terra-500 text-white hover:bg-terra-600"
                    >
                      {copied === `rx-${key}` ? "Copied!" : "Copy Realm-X request"}
                    </button>
                  )}
                  <a
                    href={APPFOLIO_INSPECTION_LETTER_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={cn(
                      "inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs",
                      realmx ? "font-medium bg-charcoal-100 text-charcoal-700 hover:bg-charcoal-200" : "font-semibold bg-terra-500 text-white hover:bg-terra-600"
                    )}
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    {realmx ? "Or open the Inspection Letter" : "Open Inspection Letter in AppFolio"}
                  </a>
                  {dateKey && (
                    <button
                      onClick={() => copy(`date-${key}`, noticeDateLine(dateKey, first.route_window))}
                      className="px-2.5 py-1.5 rounded-md text-xs font-medium bg-charcoal-100 text-charcoal-700 hover:bg-charcoal-200"
                      title="Date and arrival window, to paste into the letter"
                    >
                      {copied === `date-${key}` ? "Copied!" : "Copy date"}
                    </button>
                  )}
                  {notice && (
                    <button
                      onClick={() => copy(`body-${key}`, notice.body)}
                      className="px-2.5 py-1.5 rounded-md text-xs font-medium bg-charcoal-100 text-charcoal-700 hover:bg-charcoal-200"
                    >
                      {copied === `body-${key}` ? "Copied!" : "Copy message"}
                    </button>
                  )}
                  {emails.length > 0 && (
                    <button
                      onClick={() => copy(`em-${key}`, emails.join(", "))}
                      className="px-2.5 py-1.5 rounded-md text-xs font-medium bg-charcoal-100 text-charcoal-700 hover:bg-charcoal-200"
                    >
                      {copied === `em-${key}` ? "Copied!" : "Copy emails"}
                    </button>
                  )}
                </div>
                {dateKey && !realmx && (
                  <p className="text-[11px] text-charcoal-500 mb-2">
                    In the letter, set the inspection date to <b>{noticeDateLine(dateKey, first.route_window)}</b>, then search
                    each unit below and tick the people listed.
                  </p>
                )}

                <div className="space-y-1.5">
                  {items.map((n) => {
                    const check = checks.get(n.id);
                    return (
                      <label key={n.id} className={cn("flex items-start gap-2 text-xs rounded px-2 py-1.5 cursor-pointer", selected.has(n.id) ? "bg-terra-50" : "bg-charcoal-50")}>
                        <input type="checkbox" className="mt-0.5" checked={selected.has(n.id)} onChange={() => toggle(n.id)} />
                        <div className="min-w-0 flex-1">
                          <div>
                            <span className="font-medium text-charcoal-800">{n.address}</span>
                            {n.arrival && <span className="text-charcoal-500"> &middot; ~{n.arrival}</span>}
                            {n.previous_target_date && (
                              <span className="ml-1 px-1.5 py-0.5 rounded bg-blue-100 text-blue-800 text-[10px] font-medium">
                                Date changed (was {new Date(`${n.previous_target_date}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" })})
                              </span>
                            )}
                          </div>
                          {check ? (
                            <div className="mt-0.5 space-y-0.5">
                              {check.tenants.length > 0 && (
                                <div className="text-charcoal-600">
                                  {check.tenants.map((t) => (
                                    <span key={t.name + (t.email || "")} className="mr-3 inline-block">
                                      <b>{t.name}</b>{t.financially_responsible && " (fin. resp.)"}
                                      {t.email ? ` · ${t.email}` : " · no email"}{t.phone ? ` · ${t.phone}` : ""}
                                    </span>
                                  ))}
                                </div>
                              )}
                              {check.warnings.map((w) => <div key={w} className="text-amber-700">⚠️ {w}</div>)}
                            </div>
                          ) : (
                            <div className="text-charcoal-500 mt-0.5">
                              Tick in AppFolio: <b>{n.financially_responsible?.length ? n.financially_responsible.join(", ") : n.resident_name || "the current resident"}</b>
                              {n.email ? ` · ${n.email}` : <span className="text-amber-600"> · no email</span>}
                              {syncedAgo(n.synced_at) && <span className="text-charcoal-400"> · {syncedAgo(n.synced_at)}</span>}
                            </div>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={(e) => { e.preventDefault(); copy(`addr-${n.id}`, n.address); }}
                          className="shrink-0 px-2 py-1 rounded text-[11px] bg-white border border-charcoal-200 text-charcoal-600 hover:bg-charcoal-100"
                          title="Copy the unit address to search in AppFolio"
                        >
                          {copied === `addr-${n.id}` ? "Copied!" : "Copy address"}
                        </button>
                      </label>
                    );
                  })}
                </div>

                <div className="flex items-center justify-between mt-3">
                  {notice ? (
                    <details className="text-xs text-charcoal-500">
                      <summary className="cursor-pointer hover:text-charcoal-700">{realmx ? "Show the Realm-X request" : "Letter message (reference)"}</summary>
                      <pre className="mt-2 whitespace-pre-wrap font-sans bg-charcoal-50 rounded p-2 text-charcoal-600">{realmx ? notice.request : notice.body}</pre>
                    </details>
                  ) : <span />}
                  <button
                    onClick={() => markSelected(groupSelected)}
                    disabled={marking || groupSelected.length === 0}
                    className="shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium text-white bg-charcoal-900 hover:bg-charcoal-800 disabled:opacity-40"
                  >
                    {marking ? "Marking…" : `Mark ${groupSelected.length || ""} selected sent`.replace("  ", " ")}
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        <div className="flex items-center justify-between gap-3 p-6 pt-4 border-t border-charcoal-200">
          <p className="text-xs text-charcoal-400">Mark sent only after the email has gone out from AppFolio.</p>
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm text-charcoal-600 hover:bg-charcoal-100">Close</button>
        </div>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────
// 12-Month Summary Component
// ────────────────────────────────────────────────

function MonthlySummary({ inspections }: { inspections: Inspection[] }) {
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
  const { months, overdue, undated, total } = buildInspectionOutlook(inspections, today);
  const maximum = Math.max(1, ...months.map(month => month.total));
  return (
    <div className="space-y-6">
      <p className="text-sm text-charcoal-500">Uses the filters above. Scheduled visits appear on their appointment date; unscheduled work uses its current due date.</p>
      <div className="grid grid-cols-3 gap-4">
        {[['Inspections in this outlook', total], ['Overdue', overdue], ['Date needed', undated]].map(([label, value]) => (
          <div key={label} className="bg-white rounded-xl border border-charcoal-200 p-4"><p className="text-sm text-charcoal-500">{label}</p><p className="text-2xl font-bold">{value}</p></div>
        ))}
      </div>
      {total === 0 && <p className="rounded-lg bg-charcoal-50 p-4 text-charcoal-600">No upcoming inspections match these filters. Choose All Statuses or clear the other filters.</p>}
      <div className="bg-white rounded-xl border border-charcoal-200 p-5">
        <h3 className="font-semibold mb-4">Upcoming inspections by month</h3>
        <div className="flex items-end gap-3 h-56" role="img" aria-label="Upcoming inspections by month; exact counts appear in the table below">
          {months.map(month => <div key={month.key} className="flex-1 flex flex-col items-center justify-end h-full min-w-0">
            <span className="text-xs text-charcoal-600 mb-1">{month.total || ''}</span>
            <div className="w-full bg-blue-400 rounded-t" style={{height: `${month.total / maximum * 170}px`}} />
            <span className="text-xs text-charcoal-500 mt-2">{month.label.split(' ')[0]}</span>
          </div>)}
        </div>
      </div>
      <div className="bg-white rounded-xl border border-charcoal-200 overflow-x-auto">
        <table className="w-full text-sm"><thead className="bg-charcoal-50"><tr>
          <th className="p-4 text-left">Month</th><th className="p-4 text-right">Total</th><th className="p-4 text-right">Needs scheduling</th><th className="p-4 text-right">Scheduled / in progress</th>
        </tr></thead><tbody>
          {months.map(month => <tr key={month.key} className="border-t border-charcoal-100"><td className="p-4">{month.label}</td><td className="p-4 text-right font-semibold">{month.total}</td><td className="p-4 text-right">{month.pending}</td><td className="p-4 text-right">{month.scheduled}</td></tr>)}
        </tbody></table>
      </div>
    </div>
  );
}
