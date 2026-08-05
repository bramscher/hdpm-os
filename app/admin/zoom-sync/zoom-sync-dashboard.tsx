"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Phone,
  RefreshCw,
  AlertCircle,
  CheckCircle2,
  XCircle,
  Users,
  Building2,
  Home,
  Search,
} from "lucide-react";

// ============================================
// Types (mirror the API responses)
// ============================================

type ContactType = "vendor" | "owner" | "tenant";

interface SyncRun {
  id: string;
  status: "running" | "completed" | "failed";
  triggered_by: string | null;
  started_at: string;
  completed_at: string | null;
  total_source: number;
  with_phone: number;
  created_count: number;
  updated_count: number;
  skipped_count: number;
  failed_count: number;
  deactivated_count: number;
  error_message: string | null;
  details: { writeCapHit?: boolean; withoutPhone?: number; sampleErrors?: string[] } | null;
}

interface Summary {
  total: number;
  active: number;
  byType: Record<ContactType, { active: number; total: number }>;
}

interface StatusResponse {
  configured: boolean;
  appfolioConfigured: boolean;
  lastRun: SyncRun | null;
  recentRuns: SyncRun[];
  summary: Summary;
}

interface ContactRow {
  id: string;
  contact_type: ContactType;
  appfolio_id: string;
  zoom_external_contact_id: string | null;
  name: string;
  phone: string | null;
  email: string | null;
  active: boolean;
  last_synced_at: string | null;
  last_error: string | null;
}

// ============================================
// Helpers
// ============================================

function fmtDateTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/Los_Angeles",
  });
}

const TYPE_META: Record<ContactType, { label: string; icon: typeof Users }> = {
  vendor: { label: "Vendors", icon: Building2 },
  owner: { label: "Owners", icon: Users },
  tenant: { label: "Tenants", icon: Home },
};

// ============================================
// Sub-components
// ============================================

function StatCard({
  label,
  value,
  sub,
  icon: Icon,
}: {
  label: string;
  value: string;
  sub: string;
  icon: typeof Users;
}) {
  return (
    <div className="bg-white rounded-xl border border-sand-200 p-5 shadow-card">
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-medium text-charcoal-500">{label}</p>
        <Icon className="w-4 h-4 text-charcoal-300" />
      </div>
      <p className="text-2xl font-bold text-charcoal-900 tracking-tight">{value}</p>
      <p className="mt-1 text-xs text-charcoal-400">{sub}</p>
    </div>
  );
}

function RunBadge({ status }: { status: SyncRun["status"] }) {
  if (status === "completed")
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-green-600">
        <CheckCircle2 className="w-3.5 h-3.5" /> Completed
      </span>
    );
  if (status === "failed")
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-red-500">
        <XCircle className="w-3.5 h-3.5" /> Failed
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-600">
      <RefreshCw className="w-3.5 h-3.5 animate-spin" /> Running
    </span>
  );
}

// ============================================
// Page
// ============================================

export function ZoomSyncDashboard() {
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);

  const [contacts, setContacts] = useState<ContactRow[]>([]);
  const [contactsTotal, setContactsTotal] = useState(0);
  const [typeFilter, setTypeFilter] = useState<ContactType | "all">("all");
  const [search, setSearch] = useState("");
  const [offset, setOffset] = useState(0);
  const LIMIT = 50;

  const loadStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/zoom-sync");
      if (res.ok) setStatus(await res.json());
    } catch {
      // non-critical
    } finally {
      setLoading(false);
    }
  }, []);

  const loadContacts = useCallback(async () => {
    const qs = new URLSearchParams({ limit: String(LIMIT), offset: String(offset) });
    if (typeFilter !== "all") qs.set("type", typeFilter);
    if (search.trim()) qs.set("search", search.trim());
    try {
      const res = await fetch(`/api/zoom-sync/contacts?${qs.toString()}`);
      if (res.ok) {
        const data: { rows: ContactRow[]; total: number } = await res.json();
        setContacts(data.rows);
        setContactsTotal(data.total);
      }
    } catch {
      // non-critical
    }
  }, [typeFilter, search, offset]);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  useEffect(() => {
    loadContacts();
  }, [loadContacts]);

  const runSync = async () => {
    setSyncing(true);
    setSyncError(null);
    try {
      const res = await fetch("/api/zoom-sync/run", { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setSyncError(body.error || `Sync failed (HTTP ${res.status})`);
      }
      await Promise.all([loadStatus(), loadContacts()]);
    } catch (err) {
      setSyncError(err instanceof Error ? err.message : "Sync failed");
    } finally {
      setSyncing(false);
    }
  };

  const lastRun = status?.lastRun;
  const summary = status?.summary;

  return (
    <div>
      {/* Header */}
      <div className="mb-8 animate-slide-up">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold text-terra-500 uppercase tracking-widest mb-1">
              Integrations
            </p>
            <h1 className="text-2xl font-bold text-charcoal-900 tracking-tight flex items-center gap-2">
              <Phone className="w-6 h-6 text-terra-500" />
              Zoom Phone Contact Sync
            </h1>
            <p className="text-xs text-charcoal-400 mt-1">
              Pushes AppFolio vendors, owners &amp; current tenants into Zoom Phone external
              contacts. Last synced {fmtDateTime(lastRun?.completed_at ?? null)} PT.
            </p>
          </div>
          <button
            onClick={runSync}
            disabled={syncing}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-terra-600 rounded-lg hover:bg-terra-700 transition-all duration-150 disabled:opacity-50 shadow-sm"
          >
            <RefreshCw className={`w-4 h-4 ${syncing ? "animate-spin" : ""}`} />
            {syncing ? "Syncing…" : "Sync Now"}
          </button>
        </div>
      </div>

      {/* Config warnings */}
      {status && !status.configured && (
        <div className="mb-6 bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-start gap-3">
          <AlertCircle className="w-4 h-4 text-amber-500 mt-0.5 flex-shrink-0" />
          <div className="text-xs text-amber-700 leading-relaxed">
            <strong>Zoom not configured.</strong> Set <code className="bg-amber-100 px-1 rounded">ZOOM_ACCOUNT_ID</code>,{" "}
            <code className="bg-amber-100 px-1 rounded">ZOOM_CLIENT_ID</code> and{" "}
            <code className="bg-amber-100 px-1 rounded">ZOOM_CLIENT_SECRET</code> from a
            Server-to-Server OAuth app. Sync will skip until these are present.
          </div>
        </div>
      )}

      {syncError && (
        <div className="mb-6 bg-red-50 border border-red-200 rounded-xl p-4 flex items-start gap-3">
          <XCircle className="w-4 h-4 text-red-500 mt-0.5 flex-shrink-0" />
          <div className="text-xs text-red-600 leading-relaxed">{syncError}</div>
        </div>
      )}

      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5 mb-8">
        <StatCard
          label="Synced Contacts"
          value={summary ? String(summary.active) : loading ? "…" : "0"}
          sub={summary ? `${summary.total} total in map` : "active in Zoom"}
          icon={Phone}
        />
        {(Object.keys(TYPE_META) as ContactType[]).map((t) => {
          const meta = TYPE_META[t];
          const counts = summary?.byType[t];
          return (
            <StatCard
              key={t}
              label={meta.label}
              value={counts ? String(counts.active) : loading ? "…" : "0"}
              sub={counts ? `${counts.total} total` : "active"}
              icon={meta.icon}
            />
          );
        })}
      </div>

      {/* Last run details */}
      {lastRun && (
        <div className="mb-8 bg-white rounded-xl border border-sand-200 p-6 shadow-card">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-charcoal-900">Last Sync</h2>
            <div className="flex items-center gap-3">
              <RunBadge status={lastRun.status} />
              <span className="text-xs text-charcoal-400">
                {fmtDateTime(lastRun.started_at)} · by {lastRun.triggered_by || "—"}
              </span>
            </div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
            <RunStat label="Created" value={lastRun.created_count} tone="green" />
            <RunStat label="Updated" value={lastRun.updated_count} tone="blue" />
            <RunStat label="Unchanged" value={lastRun.skipped_count} tone="gray" />
            <RunStat label="Failed" value={lastRun.failed_count} tone="red" />
            <RunStat label="Deactivated" value={lastRun.deactivated_count} tone="gray" />
            <RunStat
              label="With Phone"
              value={lastRun.with_phone}
              sub={`of ${lastRun.total_source}`}
              tone="gray"
            />
          </div>

          {lastRun.error_message && (
            <p className="mt-4 text-xs text-red-500">{lastRun.error_message}</p>
          )}
          {lastRun.details?.writeCapHit && (
            <p className="mt-3 text-xs text-amber-600">
              Write cap reached this run — remaining contacts will sync on the next run.
            </p>
          )}
          {lastRun.details?.withoutPhone ? (
            <p className="mt-2 text-xs text-charcoal-400">
              {lastRun.details.withoutPhone} AppFolio contact(s) had no usable phone number and
              were skipped.
            </p>
          ) : null}
          {lastRun.details?.sampleErrors && lastRun.details.sampleErrors.length > 0 && (
            <details className="mt-3">
              <summary className="text-xs text-charcoal-500 cursor-pointer">
                {lastRun.details.sampleErrors.length} sample error(s)
              </summary>
              <ul className="mt-2 space-y-1 text-xs text-red-500">
                {lastRun.details.sampleErrors.map((e, i) => (
                  <li key={i} className="font-mono">
                    {e}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}

      {/* Contacts table */}
      <div className="bg-white rounded-xl border border-sand-200 shadow-card overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 p-4 border-b border-sand-100">
          <div className="flex items-center gap-1">
            {(["all", "vendor", "owner", "tenant"] as const).map((t) => (
              <button
                key={t}
                onClick={() => {
                  setTypeFilter(t);
                  setOffset(0);
                }}
                className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                  typeFilter === t
                    ? "bg-terra-50 text-terra-600 border border-terra-200"
                    : "text-charcoal-500 hover:bg-sand-50"
                }`}
              >
                {t === "all" ? "All" : TYPE_META[t].label}
              </button>
            ))}
          </div>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-charcoal-300" />
            <input
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setOffset(0);
              }}
              placeholder="Search name, phone, email"
              className="pl-8 pr-3 py-1.5 text-xs rounded-xl border border-sand-200 bg-white shadow-card outline-none focus:border-terra-300 w-56"
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-charcoal-400 border-b border-sand-100">
                <th className="px-4 py-2 font-medium">Name</th>
                <th className="px-4 py-2 font-medium">Type</th>
                <th className="px-4 py-2 font-medium">Phone</th>
                <th className="px-4 py-2 font-medium">Email</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 font-medium">Last Synced</th>
              </tr>
            </thead>
            <tbody>
              {contacts.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-xs text-charcoal-400">
                    {loading ? "Loading…" : "No contacts yet. Run a sync to populate."}
                  </td>
                </tr>
              ) : (
                contacts.map((c) => (
                  <tr key={c.id} className="border-b border-sand-50 hover:bg-sand-50/50">
                    <td className="px-4 py-2.5 text-charcoal-900">
                      {c.name}
                      {c.last_error && (
                        <span title={c.last_error} className="ml-1 text-red-400">
                          ⚠
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-charcoal-500 capitalize">{c.contact_type}</td>
                    <td className="px-4 py-2.5 text-charcoal-600 font-mono text-xs">
                      {c.phone || "—"}
                    </td>
                    <td className="px-4 py-2.5 text-charcoal-500 text-xs">{c.email || "—"}</td>
                    <td className="px-4 py-2.5">
                      {c.active ? (
                        <span className="text-xs text-green-600">Active</span>
                      ) : (
                        <span className="text-xs text-charcoal-400">Inactive</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-charcoal-400">
                      {fmtDateTime(c.last_synced_at)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {contactsTotal > LIMIT && (
          <div className="flex items-center justify-between p-4 border-t border-sand-100">
            <span className="text-xs text-charcoal-400">
              {offset + 1}–{Math.min(offset + LIMIT, contactsTotal)} of {contactsTotal}
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setOffset(Math.max(0, offset - LIMIT))}
                disabled={offset === 0}
                className="px-3 py-1.5 text-xs rounded-lg border border-sand-200 disabled:opacity-40 hover:bg-sand-50"
              >
                Prev
              </button>
              <button
                onClick={() => setOffset(offset + LIMIT)}
                disabled={offset + LIMIT >= contactsTotal}
                className="px-3 py-1.5 text-xs rounded-lg border border-sand-200 disabled:opacity-40 hover:bg-sand-50"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function RunStat({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: number;
  sub?: string;
  tone: "green" | "blue" | "red" | "gray";
}) {
  const colorMap = {
    green: "text-green-600",
    blue: "text-blue-600",
    red: "text-red-500",
    gray: "text-charcoal-700",
  };
  return (
    <div>
      <p className={`text-xl font-bold ${colorMap[tone]} tracking-tight`}>{value}</p>
      <p className="text-xs text-charcoal-400">
        {label}
        {sub ? ` ${sub}` : ""}
      </p>
    </div>
  );
}
