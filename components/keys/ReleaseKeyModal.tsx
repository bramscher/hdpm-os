"use client";

import React, { useState } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ModalShell } from "./ModalShell";
import { HOLDER_LABELS } from "./shared";

interface ReleaseKeyModalProps {
  slotId: string;
  keyNumber: number;
  address: string | null;
  onClose: () => void;
  onSaved: () => void;
}

/**
 * Release the number back to open (closes the assignment tenure). Blocked
 * with an explicit override when non-office copies are still out.
 */
export function ReleaseKeyModal({ slotId, keyNumber, address, onClose, onSaved }: ReleaseKeyModalProps) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outstanding, setOutstanding] = useState<
    Array<{ id: string; holder_type: string; holder_name: string | null }>
  >([]);
  const [acknowledge, setAcknowledge] = useState(false);

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/keys/${slotId}/transition`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "release", acknowledgeOutstanding: acknowledge }),
      });
      const data = await res.json();
      if (res.status === 409 && data.code === "outstanding_copies") {
        setOutstanding(data.outstanding ?? []);
        setError(data.error);
        setSaving(false);
        return;
      }
      if (!res.ok) throw new Error(data.error || "Failed to release key");
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to release key");
      setSaving(false);
    }
  }

  return (
    <ModalShell
      title={`Release key #${keyNumber}`}
      onClose={onClose}
      busy={saving}
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={handleSave}
            disabled={saving || (outstanding.length > 0 && !acknowledge)}
          >
            {saving ? "Releasing…" : "Release number"}
          </Button>
        </div>
      }
    >
      <div className="space-y-3">
        <p className="text-sm text-charcoal-700">
          This frees key number <span className="font-bold">#{keyNumber}</span> from{" "}
          <span className="font-medium">{address || "its current record"}</span> so it can be
          assigned to a different property. The full history is kept.
        </p>
        {error && (
          <div className="rounded-lg bg-amber-50 border border-amber-200 p-3">
            <p className="text-sm font-medium text-amber-700 flex items-center gap-1.5">
              <AlertTriangle className="w-4 h-4" /> {error}
            </p>
            {outstanding.length > 0 && (
              <>
                <ul className="mt-2 text-xs text-charcoal-600 list-disc pl-5 space-y-0.5">
                  {outstanding.map((c) => (
                    <li key={c.id}>
                      {HOLDER_LABELS[c.holder_type] ?? c.holder_type}
                      {c.holder_name ? ` — ${c.holder_name}` : ""}
                    </li>
                  ))}
                </ul>
                <label className="mt-3 flex items-center gap-2 text-xs font-medium text-charcoal-700">
                  <input
                    type="checkbox"
                    checked={acknowledge}
                    onChange={(e) => setAcknowledge(e.target.checked)}
                    className="accent-terra-500"
                  />
                  Release anyway — I understand copies are still out
                </label>
              </>
            )}
          </div>
        )}
      </div>
    </ModalShell>
  );
}
