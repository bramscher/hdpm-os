"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/** Button: drive the turn's lifecycle from its work orders' AppFolio stages. */
export default function TurnDispatchSync({ turnId }: { turnId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function sync() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/turn-estimator/turns/${turnId}/dispatch`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setMsg(data.target ? `→ ${data.target}` : "no change from work orders");
      router.refresh();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "sync failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={sync}
        disabled={busy}
        className="rounded-lg border border-sand-200 px-2.5 py-1 text-xs font-medium text-charcoal-700 hover:bg-sand-50 disabled:opacity-50"
      >
        {busy ? "Syncing…" : "Sync from work orders"}
      </button>
      {msg && <span className="text-xs text-charcoal-400">{msg}</span>}
    </div>
  );
}
