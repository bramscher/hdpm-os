"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { KeyRound, RefreshCw, Upload, Search, FileKey2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { KeysStatsCards } from "./KeysStatsCards";
import { KeysTable } from "./KeysTable";
import { ReconcileAppfolioModal } from "./ReconcileAppfolioModal";
import type { KeyListRow, KeyReconcileMeta, KeyStats } from "@/types/keys";

const TABS: Array<{ key: string | null; label: string }> = [
  { key: null, label: "All" },
  { key: "assigned", label: "Assigned" },
  { key: "vacant", label: "Vacant" },
  { key: "open", label: "Open" },
  { key: "retired", label: "Retired" },
  { key: "flagged", label: "Flagged" },
  { key: "unlinked", label: "Unlinked" },
];

export function KeysDashboard() {
  const [rows, setRows] = useState<KeyListRow[]>([]);
  const [stats, setStats] = useState<KeyStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [reconcileOpen, setReconcileOpen] = useState(false);
  const [reconcileMeta, setReconcileMeta] = useState<KeyReconcileMeta | null>(null);

  const loadReconcileMeta = useCallback(async () => {
    try {
      const res = await fetch("/api/keys/reconcile");
      if (res.ok) setReconcileMeta(await res.json());
    } catch {
      // meta is cosmetic — ignore
    }
  }, []);

  useEffect(() => {
    loadReconcileMeta();
  }, [loadReconcileMeta]);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (debouncedSearch) params.set("q", debouncedSearch);
      if (statusFilter) params.set("status", statusFilter);
      const [listRes, statsRes] = await Promise.all([
        fetch(`/api/keys?${params.toString()}`),
        fetch("/api/keys/stats"),
      ]);
      const listData = await listRes.json();
      const statsData = await statsRes.json();
      if (listRes.ok) setRows(listData.keys ?? []);
      if (statsRes.ok) setStats(statsData);
    } catch (err) {
      console.error("Failed to load keys:", err);
    } finally {
      setLoading(false);
    }
  }, [debouncedSearch, statusFilter]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleSync() {
    setSyncing(true);
    setSyncMessage(null);
    try {
      const res = await fetch("/api/sync/keys", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Sync failed");
      setSyncMessage(`Synced ${data.updated} of ${data.scanned} · ${data.flagged} flagged`);
      await load();
    } catch (err) {
      setSyncMessage(err instanceof Error ? err.message : "Sync failed");
    } finally {
      setSyncing(false);
    }
  }

  const showImportProminently = stats !== null && stats.assigned === 0 && stats.vacant === 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-terra-50 flex items-center justify-center">
            <KeyRound className="w-5 h-5 text-terra-600" />
          </div>
          <div>
            <h1 className="text-display text-charcoal-900">Key Manager</h1>
            <p className="text-xs text-charcoal-400">
              Physical key registry — assignments, copies, and history
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {syncMessage && <span className="text-xs text-charcoal-400">{syncMessage}</span>}
          <Button variant="outline" size="sm" onClick={handleSync} disabled={syncing}>
            <RefreshCw className={cn("w-4 h-4 mr-1.5", syncing && "animate-spin")} />
            {syncing ? "Syncing…" : "Sync now"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setReconcileOpen(true)}
            title={
              reconcileMeta?.last_imported_at
                ? `AppFolio checkout snapshot: ${reconcileMeta.row_count} rows, last reconciled ${new Date(reconcileMeta.last_imported_at).toLocaleDateString()}`
                : "Import who has each key checked out (and since when) from AppFolio's Keys Detail report"
            }
          >
            <FileKey2 className="w-4 h-4 mr-1.5" />
            Reconcile AppFolio
          </Button>
          <Link href="/keys/import">
            <Button variant={showImportProminently ? "default" : "outline"} size="sm">
              <Upload className="w-4 h-4 mr-1.5" />
              Import
            </Button>
          </Link>
        </div>
      </div>

      {showImportProminently && (
        <div className="bg-terra-50 border border-terra-200 rounded-xl p-4 text-sm text-charcoal-700">
          No key assignments yet — start by{" "}
          <Link href="/keys/import" className="font-semibold text-terra-600 hover:underline">
            importing the master key list spreadsheet
          </Link>
          .
        </div>
      )}

      <KeysStatsCards stats={stats} activeFilter={statusFilter} onFilter={setStatusFilter} />

      {/* Filter tabs + search */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1">
          {TABS.map((tab) => (
            <button
              key={tab.label}
              onClick={() => setStatusFilter(tab.key)}
              className={cn(
                "px-3 py-1.5 rounded-lg text-[13px] font-medium transition-colors",
                statusFilter === tab.key
                  ? "bg-charcoal-900 text-white"
                  : "text-charcoal-500 hover:bg-sand-100"
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <div className="relative">
          <Search className="w-4 h-4 text-charcoal-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search key #, address, tenant, owner…"
            className="pl-9 pr-3 py-2 w-72 rounded-xl border border-sand-200 bg-white shadow-card text-sm text-charcoal-900 placeholder:text-charcoal-300 focus:outline-none focus:ring-2 focus:ring-terra-400"
          />
        </div>
      </div>

      <KeysTable rows={rows} loading={loading} />

      {reconcileOpen && (
        <ReconcileAppfolioModal
          onClose={() => setReconcileOpen(false)}
          onCommitted={() => {
            loadReconcileMeta();
          }}
        />
      )}
    </div>
  );
}
