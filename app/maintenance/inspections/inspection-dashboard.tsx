"use client";

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
  property_name: string | null;
  address_1: string | null;
  unit_name: string | null;
  city: string | null;
  inspection_type: string | null;
  due_date: string | null;
  target_date: string | null;
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
}

interface DueNoticesResult {
  count: number;
  with_email: number;
  missing_email: number;
  notices: DueNotice[];
}

interface InspectionStats {
  total: number;
  overdue: number;
  this_week: number;
  completed: number;
  unassigned: number;
  assignees: string[];
}

type InspectionStatus =
  | "imported"
  | "validated"
  | "queued"
  | "planned"
  | "dispatched"
  | "in_progress"
  | "completed";

const STATUS_OPTIONS: { value: InspectionStatus | ""; label: string }[] = [
  { value: "", label: "All Statuses" },
  { value: "imported", label: "Imported" },
  { value: "validated", label: "Validated" },
  { value: "queued", label: "Queued" },
  { value: "planned", label: "Planned" },
  { value: "dispatched", label: "Dispatched" },
  { value: "in_progress", label: "In Progress" },
  { value: "completed", label: "Completed" },
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
  planned: "bg-indigo-100 text-indigo-700",
  dispatched: "bg-purple-100 text-purple-700",
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
  const now = new Date();
  const d = new Date(due);
  const diffDays = Math.floor((d.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays < 0) return "text-red-600 font-medium";
  if (diffDays <= 7) return "text-amber-600 font-medium";
  return "text-green-600";
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "\u2014";
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function formatStatus(status: string): string {
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
  const [activeTab, setActiveTab] = useState<"queue" | "summary">("queue");
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
      const params = new URLSearchParams();
      if (filterStatus) params.set("status", filterStatus);
      if (filterCity) params.set("city", filterCity);
      if (filterAssignee) params.set("assigned_to", filterAssignee);
      if (searchQuery) params.set("search", searchQuery);
      // Fetch all inspections for summary view (need full dataset for 12-month chart)
      if (activeTab === "summary") params.set("page_size", "2000");
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
          unit_name: prop.address_2 || null,
          city: prop.city || null,
          move_in_date: prop.move_in_date || null,
          last_inspection_date: prop.last_inspection_date || null,
        };
      });
      // Client-side search filter as fallback (Supabase referenced table filters
      // don't properly exclude parent rows)
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        const filtered = flattened.filter((insp: Record<string, unknown>) => {
          const fields = [insp.property_name, insp.address_1, insp.unit_name, insp.city];
          return fields.some((f) => typeof f === "string" && f.toLowerCase().includes(q));
        });
        setInspections(filtered);
      } else {
        setInspections(flattened);
      }
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

  const handleMarkNoticesSent = async (ids: string[]) => {
    if (!ids.length) return;
    setMarkingSent(true);
    try {
      const res = await fetch("/api/inspections/notify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to mark sent");
      setNoticeModal(null);
      await fetchInspections();
    } catch (err) {
      alert(`Mark sent failed: ${err instanceof Error ? err.message : err}`);
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

  // ── Build route from selected inspections ──
  const handleAddToRoute = async () => {
    // Navigate to Route Builder with selected IDs pre-loaded
    const ids = Array.from(selected).join(",");
    router.push(`/maintenance/inspections/routes?ids=${ids}`);
    return;
    // Old code kept for reference - used to just change status
    setBulkActioning(true);
    try {
      const res = await fetch("/api/inspections", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ids: Array.from(selected),
          updates: { status: "scheduled" },
        }),
      });
      if (!res.ok) throw new Error("Add to route failed");
      await fetchInspections();
      await fetchStats();
      setSelected(new Set());
    } catch (err) {
      console.error("Add to route error:", err);
    } finally {
      setBulkActioning(false);
    }
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
            {stats?.total ?? inspections.length} inspection{(stats?.total ?? inspections.length) !== 1 ? "s" : ""} in queue
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

      {/* ── Stats Bar ── */}
      {stats && (
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
              <span className="text-xs font-medium text-charcoal-500">Overdue</span>
            </div>
            <p className="text-2xl font-bold text-red-600">{stats.overdue}</p>
          </div>
          <div className="bg-white rounded-xl shadow-card border border-charcoal-200 p-4">
            <div className="flex items-center gap-2 mb-1">
              <Calendar className="w-4 h-4 text-amber-500" />
              <span className="text-xs font-medium text-charcoal-500">This Week</span>
            </div>
            <p className="text-2xl font-bold text-amber-600">{stats.this_week}</p>
          </div>
          <div className="bg-white rounded-xl shadow-card border border-charcoal-200 p-4">
            <div className="flex items-center gap-2 mb-1">
              <CheckCircle2 className="w-4 h-4 text-green-500" />
              <span className="text-xs font-medium text-charcoal-500">Completed</span>
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
            {STATUS_OPTIONS.map((opt) => (
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
                {STATUS_OPTIONS.filter((o) => o.value).map((opt) => (
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
          onClick={() => setActiveTab("queue")}
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
          onClick={() => setActiveTab("summary")}
          className={cn(
            "flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px",
            activeTab === "summary"
              ? "border-terra-500 text-terra-600"
              : "border-transparent text-charcoal-500 hover:text-charcoal-700 hover:border-charcoal-300"
          )}
        >
          <BarChart3 className="w-4 h-4" />
          12-Month Summary
        </button>
      </div>

      {/* ── 12-Month Summary View ── */}
      {activeTab === "summary" && (
        <MonthlySummary inspections={inspections} />
      )}

      {/* ── Table ── */}
      {activeTab === "queue" && inspections.length === 0 ? (
        <div className="text-center py-16 text-charcoal-400">
          <ClipboardCheck className="w-10 h-10 mx-auto mb-3 text-charcoal-300" />
          <p className="font-medium">No inspections yet</p>
          <p className="text-sm mt-1">
            Import a spreadsheet to get started.
          </p>
          <Link
            href="/maintenance/inspections/import"
            className="inline-flex items-center gap-2 mt-4 px-4 py-2 rounded-lg text-sm font-medium bg-terra-500 text-white hover:bg-terra-600 transition-colors"
          >
            <Upload className="w-4 h-4" />
            Import Inspections
          </Link>
        </div>
      ) : activeTab === "queue" ? (
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
                      <span className={cn("text-xs", dueDateClass(insp.due_date))}>
                        {formatDate(insp.due_date)}
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

const COMPANY_PHONE = "(541) 406-6409";

function longDate(dateStr: string): string {
  return new Date(`${dateStr}T12:00:00`).toLocaleDateString("en-US", {
    weekday: "long", month: "long", day: "numeric", year: "numeric",
  });
}

// One bulk email goes to many recipients, so the body is generic per send-date.
function genericNotice(dateStr: string): { subject: string; body: string } {
  const d = longDate(dateStr);
  return {
    subject: `Notice of Routine Property Inspection — ${d}`,
    body: [
      "Hello,",
      "",
      `This is an advance notice that High Desert Property Management will conduct a routine inspection of your residence on ${d}.`,
      "",
      "Routine inspections occur about twice a year and help us keep the property well maintained. Our inspector will briefly walk through the unit to check its condition and note any maintenance needs. You are welcome to be present but do not need to be.",
      "",
      `Please make sure pets are secured and the unit is accessible on that day. If the scheduled date does not work, contact us as soon as possible at ${COMPANY_PHONE}.`,
      "",
      "Thank you,",
      "High Desert Property Management",
      COMPANY_PHONE,
    ].join("\n"),
  };
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
  onMarkSent: (ids: string[]) => void;
}) {
  const [copied, setCopied] = useState<string | null>(null);

  const copy = (key: string, text: string) => {
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(key);
      setTimeout(() => setCopied((c) => (c === key ? null : c)), 1500);
    });
  };

  // Group by target date so each bulk send is a single date's recipients.
  const groups = new Map<string, DueNotice[]>();
  for (const n of result.notices) {
    const key = n.target_date || "no-date";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(n);
  }
  const sortedDates = [...groups.keys()].sort();
  const allIds = result.notices.map((n) => n.id);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-card-hover w-full max-w-2xl max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between p-6 pb-4 border-b border-charcoal-200">
          <div>
            <h3 className="text-base font-bold text-charcoal-900">Send Tenant Inspection Notices</h3>
            <p className="text-xs text-charcoal-500 mt-1 max-w-md">
              For each date, click <b>Open Inspection Letter in AppFolio</b> — it opens the saved
              <b> &ldquo;Inspection Letter — TENANT NOTIFICATION&rdquo;</b> template. Set the inspection
              date, search each unit below and check its resident, send, then mark them sent here.
            </p>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-charcoal-100 rounded-lg">
            <XIcon className="w-4 h-4 text-charcoal-400" />
          </button>
        </div>

        <div className="px-6 py-2 text-xs text-charcoal-500 border-b border-charcoal-100">
          {result.count} due &bull; {result.with_email} with email
          {result.missing_email > 0 && <span className="text-amber-600"> &bull; {result.missing_email} missing email</span>}
          {result.notices.some((n) => n.status === "failed") && (
            <span className="text-red-600"> &bull; {result.notices.filter((n) => n.status === "failed").length} failed (will retry)</span>
          )}
        </div>

        <div className="px-6 py-2 text-[11px] text-charcoal-500 bg-charcoal-50 border-b border-charcoal-100">
          The button opens the exact letter template (Communication → Letters). AppFolio picks
          recipients in-page, so each unit&apos;s address + resident is listed to search &amp; check.
          Fully-automated send via the Realm-X connector is still pending activation.
        </div>

        <div className="overflow-y-auto px-6 py-4 space-y-4 flex-1">
          {result.count === 0 && (
            <p className="text-sm text-charcoal-500 py-8 text-center">No scheduled inspections are awaiting a notice.</p>
          )}
          {sortedDates.map((dateKey) => {
            const items = groups.get(dateKey)!;
            const emails = [...new Set(items.map((n) => n.email).filter(Boolean) as string[])];
            const tmpl = dateKey !== "no-date" ? genericNotice(dateKey) : { subject: "Routine Property Inspection", body: "" };
            return (
              <div key={dateKey} className="border border-charcoal-200 rounded-lg p-4">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm font-semibold text-charcoal-800">
                    {dateKey === "no-date" ? "No date" : longDate(dateKey)}
                  </p>
                  <span className="text-xs text-charcoal-500">
                    {items.length} unit{items.length !== 1 ? "s" : ""} &bull; {emails.length} email{emails.length !== 1 ? "s" : ""}
                    {items.some((n) => n.status === "failed") && (
                      <span className="text-red-600"> &bull; {items.filter((n) => n.status === "failed").length} retry</span>
                    )}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-2 mb-2">
                  {/* Primary: open the exact AppFolio letter template */}
                  <a
                    href={APPFOLIO_INSPECTION_LETTER_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-semibold bg-terra-500 text-white hover:bg-terra-600"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    Open Inspection Letter in AppFolio
                  </a>
                  {dateKey !== "no-date" && (
                    <button
                      onClick={() => copy(`date-${dateKey}`, longDate(dateKey))}
                      className="px-2.5 py-1.5 rounded-md text-xs font-medium bg-charcoal-100 text-charcoal-700 hover:bg-charcoal-200"
                    >
                      {copied === `date-${dateKey}` ? "Copied!" : "Copy date"}
                    </button>
                  )}
                  <button
                    onClick={() => copy(`body-${dateKey}`, tmpl.body)}
                    className="px-2.5 py-1.5 rounded-md text-xs font-medium bg-charcoal-100 text-charcoal-700 hover:bg-charcoal-200"
                  >
                    {copied === `body-${dateKey}` ? "Copied!" : "Copy message"}
                  </button>
                  {emails.length > 0 && (
                    <button
                      onClick={() => copy(`em-${dateKey}`, emails.join(", "))}
                      className="px-2.5 py-1.5 rounded-md text-xs font-medium bg-charcoal-100 text-charcoal-700 hover:bg-charcoal-200"
                      title="For the Realm-X email fallback"
                    >
                      {copied === `em-${dateKey}` ? "Copied!" : "Copy emails"}
                    </button>
                  )}
                </div>

                {dateKey !== "no-date" && (
                  <p className="text-[11px] text-charcoal-500 mb-2">
                    In AppFolio: set the inspection date to <b>{longDate(dateKey)}</b>, then search
                    each unit below and check its resident.
                  </p>
                )}

                {/* Per-unit recipients — the search term + resident to check in AppFolio */}
                <div className="space-y-1">
                  {items.map((n) => (
                    <div
                      key={n.id}
                      className="flex items-center justify-between gap-2 text-xs bg-charcoal-50 rounded px-2 py-1.5"
                    >
                      <div className="min-w-0">
                        <span className="font-medium text-charcoal-800">{n.resident_name || "Resident"}</span>
                        {n.address && <span className="text-charcoal-400"> &middot; {n.address}</span>}
                        {!n.email && <span className="ml-1 text-amber-600">(no email)</span>}
                      </div>
                      {n.address && (
                        <button
                          onClick={() => copy(`addr-${n.id}`, n.address)}
                          className="shrink-0 px-2 py-1 rounded text-[11px] bg-white border border-charcoal-200 text-charcoal-600 hover:bg-charcoal-100"
                          title="Copy the unit address to search recipients in AppFolio"
                        >
                          {copied === `addr-${n.id}` ? "Copied!" : "Copy address"}
                        </button>
                      )}
                    </div>
                  ))}
                </div>

                <details className="text-xs text-charcoal-500 mt-2">
                  <summary className="cursor-pointer hover:text-charcoal-700">Letter message (reference)</summary>
                  <pre className="mt-2 whitespace-pre-wrap font-sans bg-charcoal-50 rounded p-2 text-charcoal-600">{tmpl.body}</pre>
                </details>
              </div>
            );
          })}
        </div>

        <div className="flex items-center justify-between gap-3 p-6 pt-4 border-t border-charcoal-200">
          <p className="text-xs text-charcoal-400">Mark sent only after you&apos;ve sent them in AppFolio.</p>
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm text-charcoal-600 hover:bg-charcoal-100">Close</button>
            <button
              onClick={() => onMarkSent(allIds)}
              disabled={marking || result.count === 0}
              className="px-4 py-2 rounded-lg text-sm font-medium text-white bg-terra-500 hover:bg-terra-600 disabled:opacity-50"
            >
              {marking ? "Marking…" : `Mark ${result.count} as sent`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────
// 12-Month Summary Component
// ────────────────────────────────────────────────

function MonthlySummary({ inspections }: { inspections: Inspection[] }) {
  // Tag each inspection as "first" or "second" for its property
  // Group by property_id (unique per unit)
  const byProperty = new Map<string, Inspection[]>();
  for (const insp of inspections) {
    const propKey = insp.property_id || insp.id;
    if (!byProperty.has(propKey)) byProperty.set(propKey, []);
    byProperty.get(propKey)!.push(insp);
  }

  // For each property, sort by due date and tag 1st/2nd
  const inspectionRound = new Map<string, 1 | 2>();
  for (const [, group] of byProperty) {
    group.sort((a, b) => {
      const da = a.due_date || "9999";
      const db = b.due_date || "9999";
      return da.localeCompare(db);
    });
    group.forEach((insp, idx) => {
      inspectionRound.set(insp.id, idx === 0 ? 1 : 2);
    });
  }

  // Build 12-month buckets starting from current month
  const now = new Date();
  const months: { key: string; label: string; start: Date; end: Date }[] = [];

  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    const end = new Date(d.getFullYear(), d.getMonth() + 1, 0); // last day of month
    months.push({
      key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
      label: d.toLocaleDateString("en-US", { month: "short", year: "numeric" }),
      start: d,
      end,
    });
  }

  // Also track "overdue" bucket (due before current month)
  const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  // Count inspections per month, per city, and by status
  const monthData = months.map((m) => {
    const inMonth = inspections.filter((insp) => {
      if (!insp.due_date) return false;
      const d = new Date(insp.due_date + "T12:00:00");
      return d >= m.start && d <= m.end;
    });

    // Split by round
    const firstRound = inMonth.filter((i) => inspectionRound.get(i.id) === 1).length;
    const secondRound = inMonth.filter((i) => inspectionRound.get(i.id) === 2).length;

    // By city
    const byCityMap: Record<string, number> = {};
    inMonth.forEach((insp) => {
      const city = insp.city || "Unknown";
      byCityMap[city] = (byCityMap[city] || 0) + 1;
    });

    // By status
    const byStatus = {
      imported: inMonth.filter((i) => i.status === "imported").length,
      scheduled: inMonth.filter((i) => i.status === "scheduled").length,
      completed: inMonth.filter((i) => i.status === "completed").length,
      other: inMonth.filter((i) => !["imported", "scheduled", "completed"].includes(i.status)).length,
    };

    return {
      ...m,
      total: inMonth.length,
      firstRound,
      secondRound,
      byCity: byCityMap,
      byStatus,
      inspections: inMonth,
    };
  });

  const overdue = inspections.filter((insp) => {
    if (!insp.due_date) return false;
    const d = new Date(insp.due_date + "T12:00:00");
    return d < currentMonthStart;
  });

  // Collect all unique cities
  const allCities = [...new Set(inspections.map((i) => i.city || "Unknown"))].sort();

  // Max for bar chart scaling
  const maxCount = Math.max(...monthData.map((m) => m.total), overdue.length, 1);

  return (
    <div className="space-y-6">
      {/* ── Overview Cards ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl shadow-card border border-charcoal-200 p-4">
          <span className="text-xs font-medium text-charcoal-500">Total Inspections</span>
          <p className="text-2xl font-bold text-charcoal-900 mt-1">{inspections.length}</p>
        </div>
        <div className="bg-white rounded-xl shadow-card border border-red-200 p-4">
          <span className="text-xs font-medium text-red-500">Overdue</span>
          <p className="text-2xl font-bold text-red-600 mt-1">{overdue.length}</p>
        </div>
        <div className="bg-white rounded-xl shadow-card border border-charcoal-200 p-4">
          <span className="text-xs font-medium text-charcoal-500">Avg / Month</span>
          <p className="text-2xl font-bold text-charcoal-900 mt-1">
            {Math.round(inspections.length / 12)}
          </p>
        </div>
        <div className="bg-white rounded-xl shadow-card border border-charcoal-200 p-4">
          <span className="text-xs font-medium text-charcoal-500">Cities</span>
          <p className="text-2xl font-bold text-charcoal-900 mt-1">{allCities.length}</p>
        </div>
      </div>

      {/* ── Bar Chart ── */}
      <div className="bg-white rounded-xl shadow-card border border-charcoal-200 p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-charcoal-700">Inspections Due by Month</h3>
          <div className="flex items-center gap-4 text-xs">
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-sm bg-blue-400" />
              1st Inspection
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-sm bg-amber-400" />
              2nd Inspection
            </span>
            {overdue.length > 0 && (
              <span className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-sm bg-red-400" />
                Overdue
              </span>
            )}
          </div>
        </div>
        <div className="flex items-end gap-2" style={{ height: 220 }}>
          {/* Overdue bar */}
          {overdue.length > 0 && (
            <div className="flex-1 flex flex-col items-center gap-1">
              <span className="text-xs font-bold text-red-600">{overdue.length}</span>
              <div
                className="w-full bg-red-400 rounded-t-md transition-all"
                style={{ height: `${(overdue.length / maxCount) * 170}px`, minHeight: 4 }}
              />
              <span className="text-[10px] text-red-500 font-medium mt-1">Overdue</span>
            </div>
          )}
          {monthData.map((m) => {
            const isCurrentMonth = m.key === `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
            const firstH = m.firstRound > 0 ? (m.firstRound / maxCount) * 170 : 0;
            const secondH = m.secondRound > 0 ? (m.secondRound / maxCount) * 170 : 0;
            const totalH = firstH + secondH;
            return (
              <div key={m.key} className="flex-1 flex flex-col items-center gap-1">
                <span className="text-xs font-bold text-charcoal-600">{m.total || ""}</span>
                <div
                  className="w-full flex flex-col justify-end"
                  style={{ height: totalH > 0 ? `${totalH}px` : "2px", minHeight: 2 }}
                >
                  {/* 2nd inspection (top) */}
                  {m.secondRound > 0 && (
                    <div
                      className="w-full bg-amber-400 rounded-t-md"
                      style={{ height: `${secondH}px` }}
                    />
                  )}
                  {/* 1st inspection (bottom) */}
                  {m.firstRound > 0 && (
                    <div
                      className={cn(
                        "w-full bg-blue-400",
                        m.secondRound === 0 && "rounded-t-md"
                      )}
                      style={{ height: `${firstH}px` }}
                    />
                  )}
                </div>
                <span
                  className={cn(
                    "text-[10px] font-medium mt-1",
                    isCurrentMonth ? "text-terra-600" : "text-charcoal-400"
                  )}
                >
                  {m.label.split(" ")[0]}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Monthly Breakdown Table ── */}
      <div className="bg-white rounded-xl shadow-card border border-charcoal-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-charcoal-50 border-b border-charcoal-200">
                <th className="text-left px-4 py-3 font-semibold text-charcoal-600">Month</th>
                <th className="text-right px-4 py-3 font-semibold text-charcoal-600">Total</th>
                <th className="text-right px-4 py-3 font-semibold text-blue-600">1st</th>
                <th className="text-right px-4 py-3 font-semibold text-amber-600">2nd</th>
                <th className="text-right px-4 py-3 font-semibold text-charcoal-600">Pending</th>
                <th className="text-right px-4 py-3 font-semibold text-charcoal-600">Scheduled</th>
                <th className="text-right px-4 py-3 font-semibold text-charcoal-600">Completed</th>
                {allCities.map((city) => (
                  <th key={city} className="text-right px-3 py-3 font-semibold text-charcoal-600 hidden lg:table-cell">
                    {city}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {/* Overdue row */}
              {overdue.length > 0 && (
                <tr className="bg-red-50 border-b border-red-100">
                  <td className="px-4 py-3 font-medium text-red-700">
                    <div className="flex items-center gap-2">
                      <AlertTriangle className="w-3.5 h-3.5" />
                      Overdue
                    </div>
                  </td>
                  <td className="text-right px-4 py-3 font-bold text-red-700">{overdue.length}</td>
                  <td className="text-right px-4 py-3 text-red-600">
                    {overdue.filter((i) => inspectionRound.get(i.id) === 1).length || "\u2014"}
                  </td>
                  <td className="text-right px-4 py-3 text-red-600">
                    {overdue.filter((i) => inspectionRound.get(i.id) === 2).length || "\u2014"}
                  </td>
                  <td className="text-right px-4 py-3 text-red-600">
                    {overdue.filter((i) => i.status === "imported").length || "\u2014"}
                  </td>
                  <td className="text-right px-4 py-3 text-red-600">
                    {overdue.filter((i) => i.status === "scheduled").length || "\u2014"}
                  </td>
                  <td className="text-right px-4 py-3 text-red-600">
                    {overdue.filter((i) => i.status === "completed").length || "\u2014"}
                  </td>
                  {allCities.map((city) => {
                    const count = overdue.filter((i) => (i.city || "Unknown") === city).length;
                    return (
                      <td key={city} className="text-right px-3 py-3 text-red-600 hidden lg:table-cell">
                        {count || "\u2014"}
                      </td>
                    );
                  })}
                </tr>
              )}
              {/* Monthly rows */}
              {monthData.map((m, idx) => {
                const isCurrentMonth = m.key === `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
                return (
                  <tr
                    key={m.key}
                    className={cn(
                      "border-b border-charcoal-100 transition-colors hover:bg-charcoal-50",
                      isCurrentMonth && "bg-terra-50/50"
                    )}
                  >
                    <td className="px-4 py-3">
                      <span className={cn("font-medium", isCurrentMonth ? "text-terra-700" : "text-charcoal-800")}>
                        {m.label}
                        {isCurrentMonth && (
                          <span className="ml-2 text-[10px] bg-terra-100 text-terra-600 px-1.5 py-0.5 rounded-full">
                            Current
                          </span>
                        )}
                      </span>
                    </td>
                    <td className="text-right px-4 py-3 font-bold text-charcoal-800">{m.total}</td>
                    <td className="text-right px-4 py-3 text-blue-600">
                      {m.firstRound || "\u2014"}
                    </td>
                    <td className="text-right px-4 py-3 text-amber-600">
                      {m.secondRound || "\u2014"}
                    </td>
                    <td className="text-right px-4 py-3 text-charcoal-500">
                      {m.byStatus.imported || "\u2014"}
                    </td>
                    <td className="text-right px-4 py-3 text-charcoal-500">
                      {m.byStatus.scheduled || "\u2014"}
                    </td>
                    <td className="text-right px-4 py-3 text-green-600">
                      {m.byStatus.completed || "\u2014"}
                    </td>
                    {allCities.map((city) => (
                      <td key={city} className="text-right px-3 py-3 text-charcoal-500 hidden lg:table-cell">
                        {m.byCity[city] || "\u2014"}
                      </td>
                    ))}
                  </tr>
                );
              })}
              {/* Totals row */}
              <tr className="bg-charcoal-50 border-t-2 border-charcoal-300">
                <td className="px-4 py-3 font-bold text-charcoal-800">12-Month Total</td>
                <td className="text-right px-4 py-3 font-bold text-charcoal-800">
                  {monthData.reduce((s, m) => s + m.total, 0)}
                </td>
                <td className="text-right px-4 py-3 font-bold text-blue-600">
                  {monthData.reduce((s, m) => s + m.firstRound, 0)}
                </td>
                <td className="text-right px-4 py-3 font-bold text-amber-600">
                  {monthData.reduce((s, m) => s + m.secondRound, 0)}
                </td>
                <td className="text-right px-4 py-3 font-bold text-charcoal-600">
                  {monthData.reduce((s, m) => s + m.byStatus.imported, 0)}
                </td>
                <td className="text-right px-4 py-3 font-bold text-charcoal-600">
                  {monthData.reduce((s, m) => s + m.byStatus.scheduled, 0)}
                </td>
                <td className="text-right px-4 py-3 font-bold text-green-600">
                  {monthData.reduce((s, m) => s + m.byStatus.completed, 0)}
                </td>
                {allCities.map((city) => {
                  const total = monthData.reduce((s, m) => s + (m.byCity[city] || 0), 0);
                  return (
                    <td key={city} className="text-right px-3 py-3 font-bold text-charcoal-600 hidden lg:table-cell">
                      {total || "\u2014"}
                    </td>
                  );
                })}
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
