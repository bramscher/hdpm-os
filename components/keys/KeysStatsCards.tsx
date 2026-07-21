"use client";

import React from "react";
import { KeyRound, CheckCircle2, DoorOpen, CircleDashed, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { KeyStats } from "@/types/keys";

interface KeysStatsCardsProps {
  stats: KeyStats | null;
  activeFilter: string | null;
  onFilter: (status: string | null) => void;
}

interface CardDef {
  key: string | null;
  label: string;
  value: (s: KeyStats) => number;
  icon: React.ReactNode;
  highlight?: boolean;
}

const CARDS: CardDef[] = [
  { key: null, label: "Total Keys", value: (s) => s.total, icon: <KeyRound className="w-5 h-5" /> },
  { key: "assigned", label: "Assigned", value: (s) => s.assigned, icon: <CheckCircle2 className="w-5 h-5" /> },
  { key: "vacant", label: "Vacant", value: (s) => s.vacant, icon: <DoorOpen className="w-5 h-5" /> },
  { key: "open", label: "Open #s", value: (s) => s.open, icon: <CircleDashed className="w-5 h-5" /> },
  { key: "flagged", label: "Flagged", value: (s) => s.flagged, icon: <AlertTriangle className="w-5 h-5" />, highlight: true },
];

export function KeysStatsCards({ stats, activeFilter, onFilter }: KeysStatsCardsProps) {
  if (!stats) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        {CARDS.map((c) => (
          <div key={c.label} className="bg-white rounded-xl border border-sand-200 p-5 animate-pulse">
            <div className="h-3 w-16 bg-sand-200 rounded mb-2" />
            <div className="h-7 w-12 bg-sand-200 rounded" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
      {CARDS.map((c) => {
        const isActive = activeFilter === c.key;
        return (
          <button
            key={c.label}
            onClick={() => onFilter(isActive ? null : c.key)}
            className={cn(
              "bg-white rounded-xl border p-5 shadow-card text-left transition-all hover:shadow-card-hover",
              isActive ? "border-terra-400 ring-1 ring-terra-400" : "border-sand-200"
            )}
          >
            <div className="flex items-start gap-3">
              <div
                className={cn(
                  "w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0",
                  c.highlight && c.value(stats) > 0 ? "bg-amber-50 text-amber-600" : "bg-sand-100 text-charcoal-500"
                )}
              >
                {c.icon}
              </div>
              <div className="min-w-0">
                <p className="text-[11px] font-semibold text-charcoal-400 uppercase tracking-wider mb-0.5">
                  {c.label}
                </p>
                <p className="text-2xl font-bold text-charcoal-900 tracking-tight">
                  {c.value(stats)}
                </p>
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}
