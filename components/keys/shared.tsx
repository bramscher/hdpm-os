"use client";

import React from "react";
import { AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { KeySlotStatus, KeySyncFlag } from "@/types/keys";

export const STATUS_STYLES: Record<KeySlotStatus, string> = {
  open: "bg-sand-100 text-charcoal-500 border-sand-200",
  assigned: "bg-green-50 text-green-700 border-green-200",
  vacant: "bg-amber-50 text-amber-700 border-amber-200",
  retired: "bg-charcoal-100 text-charcoal-400 border-charcoal-200",
};

export const STATUS_LABELS: Record<KeySlotStatus, string> = {
  open: "Open",
  assigned: "Assigned",
  vacant: "Vacant",
  retired: "Retired",
};

export function StatusBadge({ status }: { status: KeySlotStatus }) {
  return (
    <span
      className={cn(
        "inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold border",
        STATUS_STYLES[status]
      )}
    >
      {STATUS_LABELS[status]}
    </span>
  );
}

export const SYNC_FLAG_LABELS: Record<KeySyncFlag, string> = {
  appfolio_occupied_but_key_vacant: "AppFolio shows this unit occupied, but the key is marked vacant",
  appfolio_vacant_but_key_assigned: "AppFolio shows this unit vacant, but the key is marked assigned",
  unit_missing: "This unit no longer exists in AppFolio",
};

export function SyncFlagIcon({ flag }: { flag: KeySyncFlag | null }) {
  if (!flag) return null;
  return (
    <span title={SYNC_FLAG_LABELS[flag]} className="inline-flex">
      <AlertTriangle className="w-4 h-4 text-amber-500" />
    </span>
  );
}

export function fmtDate(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value.length === 10 ? `${value}T00:00:00` : value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export const HOLDER_LABELS: Record<string, string> = {
  tenant: "Tenant",
  office: "Office",
  vendor: "Vendor",
  staff: "Staff",
  other: "Other",
};
