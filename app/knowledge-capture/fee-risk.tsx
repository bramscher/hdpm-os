"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, ArrowRight } from "lucide-react";
import { RiskNotes } from "@/components/fee-management/RiskNotes";
import type { FeeRiskList, RiskOwner } from "@/lib/fee-management/risk-list";
import type { RiskNote } from "@/lib/fee-management/risk-notes";
import type { LinkedRosterOwner } from "@/lib/knowledge-capture/links";

export interface FeeRisk extends FeeRiskList {
  notes: RiskNote[];
  me: string;
  canWrite: boolean;
}

const SAVE_URL = "/api/knowledge-capture/fee-risk";

const usd = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const signed = (n: number) => `${n >= 0 ? "+" : "−"}${usd(Math.abs(n))}`;

/** The fee change risk list with notes; null until loaded (or if it can't load, e.g. offline). */
export function useFeeRisk() {
  const [risk, setRisk] = useState<FeeRisk | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    fetch(SAVE_URL)
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
        setRisk(body as FeeRisk);
      })
      .catch((err) => setError(err instanceof Error && err.message !== "Failed to fetch" ? err.message : "Needs signal."));
  }, []);
  const onSaved = useCallback((ownerSetKey: string, authorEmail: string, note: RiskNote | null) => {
    setRisk(
      (r) =>
        r && {
          ...r,
          notes: [...r.notes.filter((n) => !(n.ownerSetKey === ownerSetKey && n.authorEmail === authorEmail)), ...(note ? [note] : [])],
        }
    );
  }, []);
  return { risk, error, onSaved };
}

/** Every at-risk entry (large and top-10, de-duplicated) involving this Knowledge Capture owner. */
export function riskFor(risk: FeeRisk | null, owner: LinkedRosterOwner | undefined): RiskOwner[] {
  if (!risk || !owner) return [];
  const ids = new Set([owner.id, ...owner.aliases.map((a) => a.id)]);
  const seen = new Set<string>();
  return [...risk.large.owners, ...risk.mostAtRisk].filter((o) => {
    if (seen.has(o.key) || !o.ownerIds.some((id) => ids.has(id))) return false;
    seen.add(o.key);
    return true;
  });
}

/** The Knowledge Capture profile for an owner set (first owner with a profile, following merges). */
function profileFor(o: RiskOwner, owners: LinkedRosterOwner[]): LinkedRosterOwner | undefined {
  for (const id of o.ownerIds) {
    const hit = owners.find((p) => p.id === id || p.aliases.some((a) => a.id === id));
    if (hit) return hit;
  }
  return undefined;
}

function Numbers({ o, large }: { o: RiskOwner; large: boolean }) {
  return (
    <p className="text-[12px] text-charcoal-600">
      {o.doors} doors · fees {usd(o.currentYearly)} → {usd(o.proposedYearly)}/yr (+{o.increasePct.toFixed(0)}%) ·{" "}
      {(o.addedChurn * 100).toFixed(1)}% chance of leaving · expected loss {usd(o.expectedLoss)}/yr
      {large && <> · <span className="font-medium text-red-700">if they leave: −{usd(o.proposedYearly)}/yr</span></>}
    </p>
  );
}

function RiskCard({
  o,
  large,
  risk,
  owners,
  onSaved,
  onOpen,
}: {
  o: RiskOwner;
  large: boolean;
  risk: FeeRisk;
  owners: LinkedRosterOwner[];
  onSaved: (ownerSetKey: string, authorEmail: string, note: RiskNote | null) => void;
  onOpen: (ownerId: string) => void;
}) {
  const profile = profileFor(o, owners);
  return (
    <li className={`rounded-lg border bg-white p-3 ${large ? "border-red-200" : "border-sand-200"}`}>
      <div className="mb-1 flex flex-wrap items-start justify-between gap-2">
        <p className="font-medium text-charcoal-900">{o.name}</p>
        {profile && (
          <button onClick={() => onOpen(profile.id)} className="inline-flex items-center gap-1 text-[12px] font-medium text-terra-700 hover:underline">
            Record about them <ArrowRight className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      <Numbers o={o} large={large} />
      <div className="mt-2">
        <RiskNotes ownerSetKey={o.key} ownerName={o.name} notes={risk.notes} me={risk.canWrite ? risk.me : null} saveUrl={SAVE_URL} onSaved={onSaved} />
      </div>
    </li>
  );
}

/**
 * "Fee change risk": the owners the proposed fee change puts most at risk
 * (from Fee Management → Fee Schedule), with a notes field each for Matt and
 * Penny. Notes stay with the fee campaign; they don't go to the brain.
 */
export function FeeRiskPanel({
  risk,
  error,
  owners,
  onSaved,
  onOpen,
}: {
  risk: FeeRisk | null;
  error: string | null;
  owners: LinkedRosterOwner[];
  onSaved: (ownerSetKey: string, authorEmail: string, note: RiskNote | null) => void;
  onOpen: (ownerId: string) => void;
}) {
  if (!risk) {
    return (
      <p className="rounded-lg border border-sand-200 bg-white p-4 text-sm text-charcoal-500">
        {error ? `Couldn't load the fee change risk list. ${error}` : "Loading the fee change risk list…"}
      </p>
    );
  }
  const largeKeys = new Set(risk.large.owners.map((o) => o.key));
  const others = risk.mostAtRisk.filter((o) => !largeKeys.has(o.key));
  const card = (o: RiskOwner, large: boolean) => (
    <RiskCard key={o.key} o={o} large={large} risk={risk} owners={owners} onSaved={onSaved} onOpen={onOpen} />
  );

  return (
    <div className="space-y-6">
      <p className="max-w-3xl text-sm text-charcoal-600">
        The owners the proposed fee change is most likely to cost us, from Fee Management&apos;s fee fatigue model. Add what you know:
        how they&apos;ll take it, who to talk to, how to frame it. These notes stay with the fee campaign and don&apos;t go to the brain.
      </p>

      {risk.large.owners.length > 0 && (
        <section>
          <div className="mb-2 flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
            <div>
              <h2 className="font-semibold text-charcoal-900">Large-owner exposure ({risk.threshold}+ doors)</h2>
              <p className="text-[12px] text-charcoal-500">
                Losing one of these owners means losing every door they have: {usd(risk.large.feesAtStake)}/yr and{" "}
                {risk.large.doorsAtStake} doors at stake
                {risk.large.netIfAllLeave != null && <> · net {signed(risk.large.netIfAllLeave)}/yr if all of them leave</>}.
              </p>
            </div>
          </div>
          <ul className="space-y-3">{risk.large.owners.map((o) => card(o, true))}</ul>
        </section>
      )}

      <section>
        <h2 className="font-semibold text-charcoal-900">Most at risk: call these before the change lands</h2>
        <p className="mb-2 text-[12px] text-charcoal-500">
          Top {risk.mostAtRisk.length} by expected loss{largeKeys.size ? "; large owners already listed above are left out here" : ""}.
        </p>
        {others.length ? (
          <ul className="space-y-3">{others.map((o) => card(o, false))}</ul>
        ) : (
          <p className="text-sm text-charcoal-500">All of them are in the large-owner list above.</p>
        )}
      </section>
    </div>
  );
}

/** On an owner's capture page: their fee change risk, with notes. */
export function OwnerFeeRisk({
  entries,
  risk,
  onSaved,
}: {
  entries: RiskOwner[];
  risk: FeeRisk;
  onSaved: (ownerSetKey: string, authorEmail: string, note: RiskNote | null) => void;
}) {
  const largeKeys = new Set(risk.large.owners.map((o) => o.key));
  return (
    <section className="rounded-lg border border-red-200 bg-red-50/30 p-5">
      <h3 className="mb-1 flex items-center gap-2 font-semibold text-charcoal-900">
        <AlertTriangle className="h-4 w-4 text-red-600" />
        Fee change risk
      </h3>
      <p className="mb-3 text-[12px] text-charcoal-500">
        {entries.some((o) => largeKeys.has(o.key)) ? `A large owner (${risk.threshold}+ doors) the fee change could cost us. ` : "On the most-at-risk list for the fee change. "}
        Notes here stay with the fee campaign; record a take above for anything the brain should know.
      </p>
      <ul className="space-y-4">
        {entries.map((o) => (
          <li key={o.key}>
            {entries.length > 1 && <p className="text-sm font-medium text-charcoal-900">{o.name}</p>}
            <Numbers o={o} large={largeKeys.has(o.key)} />
            <div className="mt-2">
              <RiskNotes ownerSetKey={o.key} ownerName={o.name} notes={risk.notes} me={risk.canWrite ? risk.me : null} saveUrl={SAVE_URL} onSaved={onSaved} />
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
