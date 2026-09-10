"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  allowedNext,
  turnStatusLabel,
  isExceptionState,
} from "@/lib/turn-estimator/turn-lifecycle";

interface StatusEvent {
  id: number;
  from_status: string | null;
  to_status: string;
  actor: string;
  reason: string | null;
  created_at: string;
}

const fmt = (iso: string) =>
  new Date(iso).toLocaleString("en-US", {
    timeZone: "America/Los_Angeles",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

export default function TurnLifecyclePanel({
  turnId,
  currentStatus,
  events,
}: {
  turnId: string;
  currentStatus: string;
  events: StatusEvent[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const nexts = allowedNext(currentStatus);
  const forward = nexts.filter((s) => !isExceptionState(s));
  const exceptions = nexts.filter((s) => isExceptionState(s));

  async function advance(to: string) {
    setError(null);
    let reason: string | null = null;
    if (isExceptionState(to) || to === "SCOPE_DRAFT") {
      reason = window.prompt(`Reason for → ${turnStatusLabel(to)} (optional)`, "") || null;
    }
    setBusy(to);
    try {
      const res = await fetch(`/api/turn-estimator/turns/${turnId}/advance`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to, reason }),
      });
      if (!res.ok) throw new Error((await res.json()).error || `HTTP ${res.status}`);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "advance failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      {error && (
        <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {error}
        </div>
      )}

      <div className="rounded-xl border border-sand-200 bg-white p-4 shadow-card">
        <div className="text-xs uppercase tracking-wide text-charcoal-400">Current status</div>
        <div className="mt-1 text-xl font-semibold text-charcoal-900">
          {turnStatusLabel(currentStatus)}
        </div>

        {forward.length > 0 && (
          <div className="mt-4">
            <div className="mb-1 text-xs font-medium text-charcoal-500">Advance to</div>
            <div className="flex flex-wrap gap-2">
              {forward.map((s) => (
                <button
                  key={s}
                  type="button"
                  disabled={busy != null}
                  onClick={() => advance(s)}
                  className="rounded-lg bg-charcoal-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-charcoal-800 disabled:opacity-50"
                >
                  {busy === s ? "…" : turnStatusLabel(s)}
                </button>
              ))}
            </div>
          </div>
        )}

        {exceptions.length > 0 && (
          <div className="mt-3">
            <div className="mb-1 text-xs font-medium text-charcoal-500">Exception</div>
            <div className="flex flex-wrap gap-2">
              {exceptions.map((s) => (
                <button
                  key={s}
                  type="button"
                  disabled={busy != null}
                  onClick={() => advance(s)}
                  className="rounded-lg border border-sand-200 px-3 py-1.5 text-xs font-medium text-charcoal-700 hover:bg-sand-50 disabled:opacity-50"
                >
                  {busy === s ? "…" : turnStatusLabel(s)}
                </button>
              ))}
            </div>
          </div>
        )}

        {nexts.length === 0 && (
          <p className="mt-3 text-xs text-charcoal-400">Terminal status — no further transitions.</p>
        )}
      </div>

      <div className="mt-6">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-charcoal-600">History</h2>
        <ol className="relative border-l border-sand-200 pl-4">
          {[...events].reverse().map((e) => (
            <li key={e.id} className="mb-4">
              <div className="absolute -left-1.5 mt-1 h-3 w-3 rounded-full bg-charcoal-300" />
              <div className="text-sm text-charcoal-800">
                {e.from_status ? `${turnStatusLabel(e.from_status)} → ` : ""}
                <span className="font-medium">{turnStatusLabel(e.to_status)}</span>
              </div>
              <div className="text-xs text-charcoal-400">
                {fmt(e.created_at)} · {e.actor}
                {e.reason ? ` · ${e.reason}` : ""}
              </div>
            </li>
          ))}
          {events.length === 0 && <li className="text-xs text-charcoal-400">No history yet.</li>}
        </ol>
      </div>
    </div>
  );
}
