"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronUp, ChevronDown, Link2Off } from "lucide-react";
import { cn } from "@/lib/utils";
import { StatusBadge, SyncFlagIcon, fmtDate } from "./shared";
import type { KeyListRow } from "@/types/keys";

type SortKey = "key_number" | "address" | "assigned_at";

interface KeysTableProps {
  rows: KeyListRow[];
  loading: boolean;
}

export function KeysTable({ rows, loading }: KeysTableProps) {
  const router = useRouter();
  const [sortKey, setSortKey] = useState<SortKey>("key_number");
  const [sortAsc, setSortAsc] = useState(true);

  const sorted = [...rows].sort((a, b) => {
    let cmp = 0;
    if (sortKey === "key_number") cmp = a.key_number - b.key_number;
    else if (sortKey === "address") cmp = (a.address || "").localeCompare(b.address || "");
    else cmp = (a.assigned_at || "").localeCompare(b.assigned_at || "");
    return sortAsc ? cmp : -cmp;
  });

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortAsc(!sortAsc);
    else {
      setSortKey(key);
      setSortAsc(true);
    }
  }

  function SortHeader({ label, k, className }: { label: string; k: SortKey; className?: string }) {
    return (
      <th
        className={cn("px-4 py-3 text-left cursor-pointer select-none hover:text-charcoal-700", className)}
        onClick={() => toggleSort(k)}
      >
        <span className="inline-flex items-center gap-1">
          {label}
          {sortKey === k &&
            (sortAsc ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)}
        </span>
      </th>
    );
  }

  if (loading) {
    return (
      <div className="bg-white rounded-xl border border-sand-200 shadow-card p-8 text-center text-charcoal-400 text-sm">
        Loading keys…
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-sand-200 shadow-card p-8 text-center text-charcoal-400 text-sm">
        No keys match this view.
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-sand-200 shadow-card overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-sand-200 text-[11px] font-semibold text-charcoal-400 uppercase tracking-wider">
            <SortHeader label="Key #" k="key_number" className="w-20" />
            <SortHeader label="Address" k="address" />
            <th className="px-4 py-3 text-left">Property</th>
            <th className="px-4 py-3 text-left">Owner</th>
            <th className="px-4 py-3 text-left">Tenant(s)</th>
            <th className="px-4 py-3 text-left">Copies</th>
            <th className="px-4 py-3 text-left">Status</th>
            <SortHeader label="Assigned" k="assigned_at" />
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => (
            <tr
              key={row.id}
              onClick={() => router.push(`/keys/${row.id}`)}
              className="border-b border-sand-100 last:border-0 hover:bg-sand-50 cursor-pointer transition-colors"
            >
              <td className="px-4 py-3 font-bold text-charcoal-900">
                <span className="inline-flex items-center gap-1.5">
                  {row.key_number}
                  <SyncFlagIcon flag={row.sync_flag} />
                  {row.unlinked && (
                    <span title="Not linked to an AppFolio unit">
                      <Link2Off className="w-3.5 h-3.5 text-charcoal-300" />
                    </span>
                  )}
                </span>
              </td>
              <td className="px-4 py-3 text-charcoal-700">{row.address || "—"}</td>
              <td className="px-4 py-3 text-charcoal-500">{row.property_name || "—"}</td>
              <td className="px-4 py-3 text-charcoal-500">{row.owner_name || "—"}</td>
              <td className="px-4 py-3 text-charcoal-700">
                {row.tenant_names.length > 0 ? row.tenant_names.join(", ") : "—"}
              </td>
              <td className="px-4 py-3 text-charcoal-500 whitespace-nowrap">
                {row.copies_total > 0 ? `${row.copies_out} of ${row.copies_total} out` : "—"}
              </td>
              <td className="px-4 py-3">
                <StatusBadge status={row.status} />
              </td>
              <td className="px-4 py-3 text-charcoal-500 whitespace-nowrap">
                {fmtDate(row.assigned_at)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
