"use client";

import React from "react";
import { fmtDate } from "./shared";
import type { KeyAssignment, KeyEvent } from "@/types/keys";

const EVENT_LABELS: Record<string, string> = {
  assigned: "Assigned",
  released: "Number released",
  marked_vacant: "Marked vacant",
  reissued: "Reissued to new tenant",
  retired: "Retired",
  reinstated: "Reinstated",
  copy_issued: "Copy issued",
  copy_returned: "Copy returned",
  copy_lost: "Copy lost",
  type_added: "Key type added",
  type_removed: "Key type removed",
  note: "Note",
  imported: "Imported from spreadsheet",
  sync_flag: "Sync flag",
  edited: "Edited",
};

function eventSummary(e: KeyEvent): string {
  const p = e.payload as Record<string, unknown>;
  switch (e.event_type) {
    case "assigned":
      return [p.address, (p.tenant_names as string[])?.join(", ")].filter(Boolean).join(" — ");
    case "released":
      return (p.address as string) || "";
    case "marked_vacant": {
      const prev = (p.previous_tenants as string[]) ?? [];
      return prev.length > 0 ? `Previous tenant(s): ${prev.join(", ")}` : "";
    }
    case "reissued":
      return `Tenant(s): ${((p.tenant_names as string[]) ?? []).join(", ")}`;
    case "note":
      return (p.note as string) || "";
    case "sync_flag":
      return p.flag ? `Flag: ${p.flag}` : "Flag cleared";
    case "type_added":
    case "type_removed":
      return (p.label as string) || "";
    case "imported": {
      const raw = p.raw_row as Record<string, unknown> | undefined;
      return raw ? `${raw.address ?? ""}${raw.owner ? ` (${raw.owner})` : ""}` : "";
    }
    default:
      return "";
  }
}

interface KeyHistoryFeedProps {
  events: KeyEvent[];
  pastAssignments: KeyAssignment[];
}

export function KeyHistoryFeed({ events, pastAssignments }: KeyHistoryFeedProps) {
  return (
    <div className="space-y-5">
      {pastAssignments.length > 0 && (
        <div>
          <p className="text-[11px] font-semibold text-charcoal-400 uppercase tracking-wider mb-2">
            Past assignments
          </p>
          <div className="space-y-1.5">
            {pastAssignments.map((a) => (
              <div key={a.id} className="rounded-lg bg-sand-50 border border-sand-200 px-3 py-2 text-sm">
                <span className="font-medium text-charcoal-700">
                  {[a.address_1, a.address_2].filter(Boolean).join(" ") || a.raw_address || "Unknown address"}
                </span>
                <span className="text-charcoal-400">
                  {" "}
                  · {a.owner_name || "unknown owner"} · {fmtDate(a.assigned_at)} → {fmtDate(a.released_at)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div>
        <p className="text-[11px] font-semibold text-charcoal-400 uppercase tracking-wider mb-2">
          History
        </p>
        {events.length === 0 ? (
          <p className="text-xs text-charcoal-400">No events yet.</p>
        ) : (
          <div className="space-y-0">
            {events.map((e) => (
              <div key={e.id} className="flex gap-3 py-2 border-b border-sand-100 last:border-0">
                <div className="w-1.5 h-1.5 rounded-full bg-terra-400 mt-1.5 flex-shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-charcoal-900">
                    <span className="font-semibold">{EVENT_LABELS[e.event_type] ?? e.event_type}</span>
                    {eventSummary(e) && (
                      <span className="text-charcoal-500"> — {eventSummary(e)}</span>
                    )}
                  </p>
                  <p className="text-[11px] text-charcoal-400">
                    {new Date(e.created_at).toLocaleString("en-US", {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                    })}{" "}
                    · {e.actor}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
