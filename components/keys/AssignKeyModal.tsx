"use client";

import React, { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ModalShell } from "./ModalShell";
import { UnitPicker } from "./UnitPicker";
import { HOLDER_LABELS } from "./shared";
import type { KeyCopyHolderType, KeyTypeTemplateEntry, KeyUnitOption } from "@/types/keys";

function todayInput(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

const DEFAULT_TEMPLATE: KeyTypeTemplateEntry[] = [
  {
    label: "Main",
    copies: [
      { holder_type: "tenant" },
      { holder_type: "tenant" },
      { holder_type: "office" },
      { holder_type: "vendor" },
    ],
  },
];

const HOLDER_TYPES: KeyCopyHolderType[] = ["tenant", "office", "vendor", "staff", "other"];

interface AssignKeyModalProps {
  slotId: string;
  keyNumber: number;
  onClose: () => void;
  onSaved: () => void;
}

export function AssignKeyModal({ slotId, keyNumber, onClose, onSaved }: AssignKeyModalProps) {
  const [unit, setUnit] = useState<KeyUnitOption | null>(null);
  const [tenantNames, setTenantNames] = useState("");
  const [assignedAt, setAssignedAt] = useState(todayInput());
  const [template, setTemplate] = useState<KeyTypeTemplateEntry[]>(
    JSON.parse(JSON.stringify(DEFAULT_TEMPLATE))
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsConfirm, setNeedsConfirm] = useState(false);

  function updateTypeLabel(i: number, label: string) {
    setTemplate((t) => t.map((entry, idx) => (idx === i ? { ...entry, label } : entry)));
  }

  function addType() {
    setTemplate((t) => [...t, { label: "", copies: [{ holder_type: "tenant" }] }]);
  }

  function removeType(i: number) {
    setTemplate((t) => t.filter((_, idx) => idx !== i));
  }

  function addCopy(i: number) {
    setTemplate((t) =>
      t.map((entry, idx) =>
        idx === i ? { ...entry, copies: [...entry.copies, { holder_type: "tenant" }] } : entry
      )
    );
  }

  function setCopyHolder(i: number, j: number, holder: KeyCopyHolderType) {
    setTemplate((t) =>
      t.map((entry, idx) =>
        idx === i
          ? {
              ...entry,
              copies: entry.copies.map((c, cIdx) =>
                cIdx === j ? { ...c, holder_type: holder } : c
              ),
            }
          : entry
      )
    );
  }

  function removeCopy(i: number, j: number) {
    setTemplate((t) =>
      t.map((entry, idx) =>
        idx === i ? { ...entry, copies: entry.copies.filter((_, cIdx) => cIdx !== j) } : entry
      )
    );
  }

  const canSave =
    !saving && unit !== null && template.every((t) => t.label.trim().length > 0);

  async function handleSave(confirmDuplicate: boolean) {
    if (!unit) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/keys/${slotId}/transition`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "assign",
          appfolioUnitId: unit.appfolio_unit_id,
          appfolioPropertyId: unit.appfolio_property_id,
          propertyName: unit.property_name,
          address1: unit.address,
          city: unit.city,
          tenantNames: tenantNames
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
          assignedAt,
          template,
          confirmDuplicateUnit: confirmDuplicate,
        }),
      });
      const data = await res.json();
      if (res.status === 409 && data.code === "unit_has_active_key") {
        setNeedsConfirm(true);
        setError(
          `This unit already has active key #${(data.key_numbers ?? []).join(", #")}. Assign #${keyNumber} as an additional key?`
        );
        setSaving(false);
        return;
      }
      if (!res.ok) throw new Error(data.error || "Failed to assign key");
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to assign key");
      setSaving(false);
    }
  }

  return (
    <ModalShell
      title={`Assign key #${keyNumber}`}
      onClose={onClose}
      busy={saving}
      wide
      footer={
        <div className="flex items-center justify-end gap-2">
          {error && <p className="text-xs text-red-600 flex-1">{error}</p>}
          <Button variant="ghost" size="sm" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={() => handleSave(needsConfirm)}
            disabled={!canSave}
          >
            {saving ? "Assigning…" : needsConfirm ? "Assign anyway" : "Assign key"}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <div>
          <label className="block text-xs font-semibold text-charcoal-500 mb-1.5">Unit</label>
          <UnitPicker selected={unit} onSelect={(u) => { setUnit(u); setNeedsConfirm(false); setError(null); }} />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-semibold text-charcoal-500 mb-1.5">
              Tenant name(s) <span className="font-normal text-charcoal-300">(comma-separated)</span>
            </label>
            <input
              value={tenantNames}
              onChange={(e) => setTenantNames(e.target.value)}
              placeholder="e.g. Jane Smith, John Smith"
              className="w-full px-3 py-2 rounded-lg border border-sand-200 text-sm focus:outline-none focus:ring-2 focus:ring-terra-400"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-charcoal-500 mb-1.5">Assigned date</label>
            <input
              type="date"
              value={assignedAt}
              onChange={(e) => setAssignedAt(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-sand-200 text-sm focus:outline-none focus:ring-2 focus:ring-terra-400"
            />
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-xs font-semibold text-charcoal-500">
              Key types &amp; copies to issue
            </label>
            <button onClick={addType} className="text-xs font-medium text-terra-600 hover:underline inline-flex items-center gap-1">
              <Plus className="w-3 h-3" /> Add key type
            </button>
          </div>
          <div className="space-y-3">
            {template.map((t, i) => (
              <div key={i} className="rounded-lg border border-sand-200 p-3">
                <div className="flex items-center gap-2 mb-2">
                  <input
                    value={t.label}
                    onChange={(e) => updateTypeLabel(i, e.target.value)}
                    placeholder="Type (Main, Garage, Shed, Mailbox…)"
                    className="flex-1 px-2.5 py-1.5 rounded-lg border border-sand-200 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-terra-400"
                  />
                  {template.length > 1 && (
                    <button onClick={() => removeType(i)} className="text-charcoal-300 hover:text-red-500">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {t.copies.map((c, j) => (
                    <span key={j} className="inline-flex items-center gap-1 rounded-lg bg-sand-100 pl-2 pr-1 py-1">
                      <select
                        value={c.holder_type}
                        onChange={(e) => setCopyHolder(i, j, e.target.value as KeyCopyHolderType)}
                        className="bg-transparent text-xs font-medium text-charcoal-700 focus:outline-none"
                      >
                        {HOLDER_TYPES.map((h) => (
                          <option key={h} value={h}>{HOLDER_LABELS[h]}</option>
                        ))}
                      </select>
                      <button onClick={() => removeCopy(i, j)} className="text-charcoal-300 hover:text-red-500 px-0.5">
                        ×
                      </button>
                    </span>
                  ))}
                  <button onClick={() => addCopy(i)} className="text-xs font-medium text-terra-600 hover:underline inline-flex items-center gap-0.5">
                    <Plus className="w-3 h-3" /> copy
                  </button>
                </div>
              </div>
            ))}
          </div>
          <p className="mt-1.5 text-[11px] text-charcoal-400">
            Default: 4 main copies — 2 to tenant, 1 office, 1 vendor. Adjust per unit (extra locks, garages, sheds…).
          </p>
        </div>
      </div>
    </ModalShell>
  );
}
