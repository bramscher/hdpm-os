"use client";

import React, { useState } from "react";
import { Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { HOLDER_LABELS, fmtDate } from "./shared";
import type { KeyType } from "@/types/keys";

const COPY_STATUS_STYLES: Record<string, string> = {
  issued: "bg-green-50 text-green-700",
  returned: "bg-sand-100 text-charcoal-500",
  lost: "bg-red-50 text-red-600",
  destroyed: "bg-charcoal-100 text-charcoal-400",
};

interface KeyCopiesEditorProps {
  slotId: string;
  keyTypes: KeyType[];
  tenantNames?: string[];
  editable: boolean;
  onChanged: () => void;
}

/** Per-type copy tables with inline issue / return / lost actions. */
export function KeyCopiesEditor({ slotId, keyTypes, tenantNames = [], editable, onChanged }: KeyCopiesEditorProps) {
  const [busy, setBusy] = useState(false);
  const [addingType, setAddingType] = useState(false);
  const [newTypeLabel, setNewTypeLabel] = useState("");
  const [editingCopyId, setEditingCopyId] = useState<string | null>(null);
  const [holderDraft, setHolderDraft] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function call(path: string, method: string, body?: unknown) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(path, {
        method,
        headers: { "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Request failed");
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
    } finally {
      setBusy(false);
    }
  }

  async function saveHolder(copyId: string, name: string, asTenant: boolean) {
    const holderName = name.trim();
    await call(`/api/keys/${slotId}/copies/${copyId}`, "PATCH", {
      holderName: holderName || null,
      // Naming a tenant as the holder also flips custody to 'tenant'.
      ...(asTenant && holderName ? { holderType: "tenant" } : {}),
    });
    setEditingCopyId(null);
  }

  async function addType() {
    const label = newTypeLabel.trim();
    if (!label) return;
    await call(`/api/keys/${slotId}/types`, "POST", { label, copies: [] });
    setNewTypeLabel("");
    setAddingType(false);
  }

  return (
    <div className="space-y-4">
      {error && <p className="text-xs text-red-600">{error}</p>}
      {keyTypes.map((t) => (
        <div key={t.id} className="rounded-lg border border-sand-200">
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-sand-100 bg-sand-50 rounded-t-lg">
            <p className="text-sm font-semibold text-charcoal-900">{t.label}</p>
            {editable && (
              <div className="flex items-center gap-2">
                <button
                  disabled={busy}
                  onClick={() =>
                    call(`/api/keys/${slotId}/copies`, "POST", {
                      keyTypeId: t.id,
                      holderType: "tenant",
                      charged: true,
                    })
                  }
                  className="text-xs font-medium text-terra-600 hover:underline inline-flex items-center gap-0.5"
                >
                  <Plus className="w-3 h-3" /> Issue copy
                </button>
                <button
                  disabled={busy}
                  onClick={() => {
                    if (confirm(`Remove key type "${t.label}"?`)) {
                      call(`/api/keys/${slotId}/types/${t.id}`, "DELETE");
                    }
                  }}
                  className="text-xs font-medium text-charcoal-400 hover:text-red-500"
                >
                  Remove
                </button>
              </div>
            )}
          </div>
          {t.copies.length === 0 ? (
            <p className="px-4 py-3 text-xs text-charcoal-400">No copies recorded.</p>
          ) : (
            <table className="w-full text-sm">
              <tbody>
                {t.copies.map((c) => (
                  <tr key={c.id} className="border-b border-sand-100 last:border-0">
                    <td className="px-4 py-2 text-charcoal-700 w-28">
                      {HOLDER_LABELS[c.holder_type]}
                    </td>
                    <td className="px-4 py-2 text-charcoal-500">
                      {editingCopyId === c.id ? (
                        <span className="flex flex-wrap items-center gap-1.5">
                          <input
                            value={holderDraft}
                            onChange={(e) => setHolderDraft(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") saveHolder(c.id, holderDraft, false);
                              if (e.key === "Escape") setEditingCopyId(null);
                            }}
                            placeholder="Holder name…"
                            autoFocus
                            className="w-32 px-2 py-1 rounded border border-sand-200 text-xs focus:outline-none focus:ring-2 focus:ring-terra-400"
                          />
                          {tenantNames.map((name) => (
                            <button
                              key={name}
                              disabled={busy}
                              onClick={() => saveHolder(c.id, name, true)}
                              title={`Set holder to ${name} (tenant)`}
                              className="px-2 py-0.5 rounded-full bg-terra-50 text-terra-700 text-[11px] font-medium hover:bg-terra-100 border border-terra-200"
                            >
                              {name}
                            </button>
                          ))}
                          <button
                            disabled={busy}
                            onClick={() => saveHolder(c.id, holderDraft, false)}
                            className="text-xs font-semibold text-terra-600 hover:underline"
                          >
                            Save
                          </button>
                          <button
                            onClick={() => setEditingCopyId(null)}
                            className="text-xs text-charcoal-400 hover:text-charcoal-700"
                          >
                            Cancel
                          </button>
                        </span>
                      ) : editable ? (
                        <button
                          onClick={() => {
                            setEditingCopyId(c.id);
                            setHolderDraft(c.holder_name ?? "");
                          }}
                          title="Edit holder"
                          className={cn(
                            "hover:underline decoration-dotted underline-offset-2 text-left",
                            c.holder_name ? "text-charcoal-500" : "text-charcoal-300"
                          )}
                        >
                          {c.holder_name || "Set holder"}
                        </button>
                      ) : (
                        c.holder_name || "—"
                      )}
                    </td>
                    <td className="px-4 py-2">
                      <span
                        className={cn(
                          "inline-block px-1.5 py-0.5 rounded text-[11px] font-semibold",
                          COPY_STATUS_STYLES[c.status]
                        )}
                      >
                        {c.status}
                        {c.charged && " · charged"}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-xs text-charcoal-400 whitespace-nowrap">
                      {c.status === "returned"
                        ? `returned ${fmtDate(c.returned_at)}`
                        : `issued ${fmtDate(c.issued_at)}`}
                    </td>
                    {editable && (
                      <td className="px-4 py-2 text-right whitespace-nowrap">
                        {c.status === "issued" ? (
                          <span className="inline-flex gap-2">
                            <button
                              disabled={busy}
                              onClick={() =>
                                call(`/api/keys/${slotId}/copies/${c.id}`, "PATCH", {
                                  status: "returned",
                                })
                              }
                              className="text-xs font-medium text-terra-600 hover:underline"
                            >
                              Return
                            </button>
                            <button
                              disabled={busy}
                              onClick={() =>
                                call(`/api/keys/${slotId}/copies/${c.id}`, "PATCH", {
                                  status: "lost",
                                })
                              }
                              className="text-xs font-medium text-charcoal-400 hover:text-red-500"
                            >
                              Lost
                            </button>
                          </span>
                        ) : (
                          <button
                            disabled={busy}
                            onClick={() =>
                              call(`/api/keys/${slotId}/copies/${c.id}`, "PATCH", {
                                status: "issued",
                              })
                            }
                            className="text-xs font-medium text-charcoal-400 hover:text-terra-600"
                          >
                            Re-issue
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      ))}

      {editable &&
        (addingType ? (
          <div className="flex items-center gap-2">
            <input
              value={newTypeLabel}
              onChange={(e) => setNewTypeLabel(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addType()}
              placeholder="Type name (Garage, Shed, Mailbox…)"
              autoFocus
              className="px-3 py-1.5 rounded-lg border border-sand-200 text-sm focus:outline-none focus:ring-2 focus:ring-terra-400"
            />
            <button onClick={addType} disabled={busy || !newTypeLabel.trim()} className="text-xs font-semibold text-terra-600 hover:underline">
              Add
            </button>
            <button onClick={() => setAddingType(false)} className="text-xs text-charcoal-400 hover:text-charcoal-700">
              Cancel
            </button>
          </div>
        ) : (
          <button
            onClick={() => setAddingType(true)}
            className="text-xs font-medium text-terra-600 hover:underline inline-flex items-center gap-1"
          >
            <Plus className="w-3 h-3" /> Add key type
          </button>
        ))}
    </div>
  );
}
