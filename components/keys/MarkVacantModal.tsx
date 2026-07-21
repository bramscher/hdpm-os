"use client";

import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { ModalShell } from "./ModalShell";
import { HOLDER_LABELS } from "./shared";
import type { KeyType } from "@/types/keys";

interface MarkVacantModalProps {
  slotId: string;
  keyNumber: number;
  keyTypes: KeyType[];
  onClose: () => void;
  onSaved: () => void;
}

/**
 * Move-out flow: record what happened to each issued non-office copy
 * (returned to office or lost), then the key record goes vacant.
 */
export function MarkVacantModal({ slotId, keyNumber, keyTypes, onClose, onSaved }: MarkVacantModalProps) {
  const issuedCopies = keyTypes.flatMap((t) =>
    t.copies
      .filter((c) => c.status === "issued" && c.holder_type !== "office")
      .map((c) => ({ ...c, typeLabel: t.label }))
  );

  const [outcomes, setOutcomes] = useState<Record<string, "returned" | "lost">>(
    Object.fromEntries(issuedCopies.map((c) => [c.id, "returned" as const]))
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/keys/${slotId}/transition`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "mark_vacant",
          copyOutcomes: Object.entries(outcomes).map(([copyId, outcome]) => ({ copyId, outcome })),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to mark vacant");
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to mark vacant");
      setSaving(false);
    }
  }

  return (
    <ModalShell
      title={`Mark key #${keyNumber} vacant`}
      onClose={onClose}
      busy={saving}
      footer={
        <div className="flex items-center justify-end gap-2">
          {error && <p className="text-xs text-red-600 flex-1">{error}</p>}
          <Button variant="ghost" size="sm" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button size="sm" onClick={handleSave} disabled={saving}>
            {saving ? "Saving…" : "Mark vacant"}
          </Button>
        </div>
      }
    >
      {issuedCopies.length === 0 ? (
        <p className="text-sm text-charcoal-500">
          No tenant/vendor copies are out — the record will simply move to vacant.
        </p>
      ) : (
        <div className="space-y-2">
          <p className="text-sm text-charcoal-500 mb-3">
            Record each copy that was out with the tenant:
          </p>
          {issuedCopies.map((c) => (
            <div
              key={c.id}
              className="flex items-center justify-between rounded-lg border border-sand-200 px-3 py-2.5"
            >
              <div>
                <p className="text-sm font-medium text-charcoal-900">
                  {c.typeLabel} — {HOLDER_LABELS[c.holder_type]}
                  {c.holder_name ? ` (${c.holder_name})` : ""}
                </p>
              </div>
              <div className="flex gap-1">
                {(["returned", "lost"] as const).map((o) => (
                  <button
                    key={o}
                    onClick={() => setOutcomes((prev) => ({ ...prev, [c.id]: o }))}
                    className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${
                      outcomes[c.id] === o
                        ? o === "returned"
                          ? "bg-green-100 text-green-700"
                          : "bg-red-100 text-red-700"
                        : "bg-sand-100 text-charcoal-400 hover:bg-sand-200"
                    }`}
                  >
                    {o === "returned" ? "Returned" : "Lost"}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </ModalShell>
  );
}
