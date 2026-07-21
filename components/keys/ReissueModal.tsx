"use client";

import React, { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ModalShell } from "./ModalShell";
import { HOLDER_LABELS } from "./shared";
import type { KeyType } from "@/types/keys";

interface PendingCopy {
  keyTypeId: string;
  holderType: string;
  holderName: string;
  charged: boolean;
}

interface ReissueModalProps {
  slotId: string;
  keyNumber: number;
  keyTypes: KeyType[];
  onClose: () => void;
  onSaved: () => void;
}

/** New-tenant flow on a vacant key: name the tenant(s), issue fresh copies. */
export function ReissueModal({ slotId, keyNumber, keyTypes, onClose, onSaved }: ReissueModalProps) {
  const [tenantNames, setTenantNames] = useState("");
  const mainType = keyTypes[0];
  const [copies, setCopies] = useState<PendingCopy[]>(
    mainType
      ? [
          { keyTypeId: mainType.id, holderType: "tenant", holderName: "", charged: false },
          { keyTypeId: mainType.id, holderType: "tenant", holderName: "", charged: false },
        ]
      : []
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function addCopy() {
    if (!mainType) return;
    // Beyond the standard 2 tenant copies, extras default to charged.
    setCopies((c) => [
      ...c,
      { keyTypeId: mainType.id, holderType: "tenant", holderName: "", charged: c.length >= 2 },
    ]);
  }

  function updateCopy(i: number, patch: Partial<PendingCopy>) {
    setCopies((c) => c.map((entry, idx) => (idx === i ? { ...entry, ...patch } : entry)));
  }

  function removeCopy(i: number) {
    setCopies((c) => c.filter((_, idx) => idx !== i));
  }

  const canSave = !saving && tenantNames.trim().length > 0;

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/keys/${slotId}/transition`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "reissue",
          tenantNames: tenantNames
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
          copies: copies.map((c) => ({
            keyTypeId: c.keyTypeId,
            holderType: c.holderType,
            holderName: c.holderName.trim() || null,
            charged: c.charged,
          })),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to reissue key");
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to reissue key");
      setSaving(false);
    }
  }

  return (
    <ModalShell
      title={`Reissue key #${keyNumber} to new tenant`}
      onClose={onClose}
      busy={saving}
      footer={
        <div className="flex items-center justify-end gap-2">
          {error && <p className="text-xs text-red-600 flex-1">{error}</p>}
          <Button variant="ghost" size="sm" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button size="sm" onClick={handleSave} disabled={!canSave}>
            {saving ? "Saving…" : "Reissue key"}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <div>
          <label className="block text-xs font-semibold text-charcoal-500 mb-1.5">
            New tenant name(s) <span className="font-normal text-charcoal-300">(comma-separated)</span>
          </label>
          <input
            value={tenantNames}
            onChange={(e) => setTenantNames(e.target.value)}
            placeholder="e.g. Jane Smith, John Smith"
            autoFocus
            className="w-full px-3 py-2 rounded-lg border border-sand-200 text-sm focus:outline-none focus:ring-2 focus:ring-terra-400"
          />
        </div>

        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-xs font-semibold text-charcoal-500">Copies to issue</label>
            <button
              onClick={addCopy}
              className="text-xs font-medium text-terra-600 hover:underline inline-flex items-center gap-1"
            >
              <Plus className="w-3 h-3" /> Add copy
            </button>
          </div>
          <div className="space-y-2">
            {copies.map((c, i) => {
              const type = keyTypes.find((t) => t.id === c.keyTypeId);
              return (
                <div key={i} className="flex items-center gap-2 rounded-lg border border-sand-200 px-3 py-2">
                  <select
                    value={c.keyTypeId}
                    onChange={(e) => updateCopy(i, { keyTypeId: e.target.value })}
                    className="text-xs font-medium text-charcoal-700 bg-sand-100 rounded-lg px-2 py-1.5 focus:outline-none"
                  >
                    {keyTypes.map((t) => (
                      <option key={t.id} value={t.id}>{t.label}</option>
                    ))}
                  </select>
                  <select
                    value={c.holderType}
                    onChange={(e) => updateCopy(i, { holderType: e.target.value })}
                    className="text-xs font-medium text-charcoal-700 bg-sand-100 rounded-lg px-2 py-1.5 focus:outline-none"
                  >
                    {Object.entries(HOLDER_LABELS).map(([value, label]) => (
                      <option key={value} value={value}>{label}</option>
                    ))}
                  </select>
                  <label className="flex items-center gap-1 text-xs text-charcoal-500 ml-auto">
                    <input
                      type="checkbox"
                      checked={c.charged}
                      onChange={(e) => updateCopy(i, { charged: e.target.checked })}
                      className="accent-terra-500"
                    />
                    Charged
                  </label>
                  <button onClick={() => removeCopy(i)} className="text-charcoal-300 hover:text-red-500 text-sm px-1">
                    ×
                  </button>
                  {type && <span className="sr-only">{type.label}</span>}
                </div>
              );
            })}
            {copies.length === 0 && (
              <p className="text-xs text-charcoal-400">No copies will be issued (record only the tenant change).</p>
            )}
          </div>
          <p className="mt-1.5 text-[11px] text-charcoal-400">
            Standard: 2 tenant copies. Extra copies for additional tenants are charged.
          </p>
        </div>
      </div>
    </ModalShell>
  );
}
