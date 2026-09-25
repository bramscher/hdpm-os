"use client";

import { useState } from "react";
import { ManagementFeeIndex } from "@/components/dashboard/ManagementFeeIndex";
import { OwnerFeeOpportunity } from "@/components/fee-management/OwnerFeeOpportunity";
import { FeeSchedule } from "@/components/fee-management/FeeSchedule";

const TABS = [
  { key: "opportunity", label: "Owner Fee Opportunity" },
  { key: "index", label: "Fee Index" },
  { key: "schedule", label: "Fee Schedule" },
] as const;

export function FeeManagement() {
  const [tab, setTab] = useState<(typeof TABS)[number]["key"]>("opportunity");
  return (
    <div className="mx-auto max-w-[1500px] px-6 py-8">
      <p className="mb-1 text-[11px] font-medium text-charcoal-400">Admin</p>
      <h1 className="text-xl font-semibold tracking-tight text-charcoal-950">Fee Management</h1>
      <p className="mt-1 text-sm text-charcoal-500">
        Management fee levels across the portfolio, the owner-by-owner fee increase campaign, and our standard fee schedule.
      </p>

      <div className="mt-5 mb-5 flex gap-5 border-b border-sand-200">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`-mb-px border-b-2 pb-2 text-[13px] font-medium transition-colors ${
              tab === t.key ? "border-charcoal-950 text-charcoal-950" : "border-transparent text-charcoal-400 hover:text-charcoal-800"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "opportunity" ? <OwnerFeeOpportunity /> : tab === "index" ? <ManagementFeeIndex /> : <FeeSchedule />}
    </div>
  );
}
