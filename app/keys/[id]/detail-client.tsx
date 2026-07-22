"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, ChevronLeft, ChevronRight, KeyRound, AlertTriangle, Link2Off } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusBadge, SYNC_FLAG_LABELS, fmtDate } from "@/components/keys/shared";
import { AssignKeyModal } from "@/components/keys/AssignKeyModal";
import { MarkVacantModal } from "@/components/keys/MarkVacantModal";
import { ReissueModal } from "@/components/keys/ReissueModal";
import { ReleaseKeyModal } from "@/components/keys/ReleaseKeyModal";
import { KeyCopiesEditor } from "@/components/keys/KeyCopiesEditor";
import { KeyHistoryFeed } from "@/components/keys/KeyHistoryFeed";
import { UnitPicker } from "@/components/keys/UnitPicker";
import { ModalShell } from "@/components/keys/ModalShell";
import type { KeyDetail, KeyUnitOption } from "@/types/keys";

type OpenModal = "assign" | "vacant" | "reissue" | "release" | "link" | null;

export function KeyDetailClient({ slotId }: { slotId: string }) {
  const [detail, setDetail] = useState<KeyDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modal, setModal] = useState<OpenModal>(null);
  const [note, setNote] = useState("");
  const [savingNote, setSavingNote] = useState(false);
  const [linkUnit, setLinkUnit] = useState<KeyUnitOption | null>(null);
  const [linking, setLinking] = useState(false);
  const router = useRouter();

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/keys/${slotId}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load key");
      setDetail(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load key");
    } finally {
      setLoading(false);
    }
  }, [slotId]);

  useEffect(() => {
    load();
  }, [load]);

  // Arrow-key navigation between adjacent key numbers (inactive while typing
  // or while a modal is open).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (modal) return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      const nav = detail?.nav;
      if (e.key === "ArrowLeft" && nav?.prev) router.push(`/keys/${nav.prev.id}`);
      if (e.key === "ArrowRight" && nav?.next) router.push(`/keys/${nav.next.id}`);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [detail, modal, router]);

  async function transition(action: string) {
    const res = await fetch(`/api/keys/${slotId}/transition`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    const data = await res.json();
    if (!res.ok) {
      alert(data.error || "Action failed");
      return;
    }
    await load();
  }

  async function addNote() {
    const trimmed = note.trim();
    if (!trimmed) return;
    setSavingNote(true);
    try {
      const res = await fetch(`/api/keys/${slotId}/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note: trimmed }),
      });
      if (res.ok) {
        setNote("");
        await load();
      }
    } finally {
      setSavingNote(false);
    }
  }

  async function linkToUnit() {
    if (!linkUnit) return;
    setLinking(true);
    try {
      const res = await fetch(`/api/keys/${slotId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          assignment: {
            appfolio_unit_id: linkUnit.appfolio_unit_id,
            appfolio_property_id: linkUnit.appfolio_property_id,
            property_name: linkUnit.property_name,
            address_1: linkUnit.address,
            city: linkUnit.city,
          },
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to link");
      setModal(null);
      setLinkUnit(null);
      await load();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to link");
    } finally {
      setLinking(false);
    }
  }

  if (loading) {
    return <div className="p-8 text-center text-charcoal-400 text-sm">Loading key…</div>;
  }
  if (error || !detail) {
    return (
      <div className="p-8 text-center">
        <p className="text-sm text-red-600 mb-3">{error || "Key not found"}</p>
        <Link href="/keys" className="text-sm font-medium text-terra-600 hover:underline">
          ← Back to Key Manager
        </Link>
      </div>
    );
  }

  const { slot, active_assignment: assignment, key_types, past_assignments, events, af_checkouts } = detail;
  const address = assignment
    ? [assignment.address_1, assignment.address_2].filter(Boolean).join(" ") || assignment.raw_address
    : null;
  const unlinked = Boolean(assignment && !assignment.appfolio_unit_id);

  return (
    <div className="space-y-6">
      {/* Back + header */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <Link
            href="/keys"
            className="inline-flex items-center gap-1 text-xs font-medium text-charcoal-400 hover:text-charcoal-700"
          >
            <ArrowLeft className="w-3.5 h-3.5" /> Key Manager
          </Link>
          <div className="flex items-center gap-1">
            {detail.nav?.prev ? (
              <Link
                href={`/keys/${detail.nav.prev.id}`}
                title={`Key #${detail.nav.prev.key_number} (←)`}
                className="inline-flex items-center gap-0.5 px-2 py-1 rounded-lg text-xs font-medium text-charcoal-500 hover:text-charcoal-900 hover:bg-sand-100"
              >
                <ChevronLeft className="w-3.5 h-3.5" /> #{detail.nav.prev.key_number}
              </Link>
            ) : (
              <span className="px-2 py-1 text-xs text-charcoal-200">
                <ChevronLeft className="w-3.5 h-3.5 inline" />
              </span>
            )}
            {detail.nav?.next ? (
              <Link
                href={`/keys/${detail.nav.next.id}`}
                title={`Key #${detail.nav.next.key_number} (→)`}
                className="inline-flex items-center gap-0.5 px-2 py-1 rounded-lg text-xs font-medium text-charcoal-500 hover:text-charcoal-900 hover:bg-sand-100"
              >
                #{detail.nav.next.key_number} <ChevronRight className="w-3.5 h-3.5" />
              </Link>
            ) : (
              <span className="px-2 py-1 text-xs text-charcoal-200">
                <ChevronRight className="w-3.5 h-3.5 inline" />
              </span>
            )}
          </div>
        </div>

        <div className="bg-white rounded-xl border border-sand-200 shadow-card p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex items-start gap-4">
              <div className="w-14 h-14 rounded-xl bg-terra-50 flex items-center justify-center flex-shrink-0">
                <KeyRound className="w-7 h-7 text-terra-600" />
              </div>
              <div>
                <div className="flex items-center gap-3">
                  <h1 className="text-2xl font-bold text-charcoal-900 tracking-tight">
                    Key #{slot.key_number}
                  </h1>
                  <StatusBadge status={slot.status} />
                </div>
                {assignment ? (
                  <div className="mt-1 text-sm text-charcoal-600 space-y-0.5">
                    <p className="font-medium text-charcoal-900">{address}</p>
                    <p>
                      {[assignment.property_name, assignment.owner_name && `Owner: ${assignment.owner_name}`]
                        .filter(Boolean)
                        .join(" · ") || ""}
                    </p>
                    <p>
                      {assignment.tenant_names.length > 0
                        ? `Tenant(s): ${assignment.tenant_names.join(", ")}`
                        : slot.status === "vacant"
                          ? "No current tenant"
                          : ""}
                    </p>
                    <p className="text-xs text-charcoal-400">
                      Assigned {fmtDate(assignment.assigned_at)}
                      {assignment.last_synced_at &&
                        ` · synced ${fmtDate(assignment.last_synced_at)}`}
                    </p>
                  </div>
                ) : (
                  <p className="mt-1 text-sm text-charcoal-400">
                    {slot.status === "retired" ? "This number is retired." : "This number is unassigned."}
                  </p>
                )}
              </div>
            </div>

            {/* State-dependent actions */}
            <div className="flex flex-wrap gap-2">
              {slot.status === "open" && (
                <Button size="sm" onClick={() => setModal("assign")}>Assign to unit</Button>
              )}
              {slot.status === "assigned" && (
                <>
                  <Button size="sm" variant="outline" onClick={() => setModal("vacant")}>
                    Mark vacant
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setModal("release")}>
                    Release number
                  </Button>
                </>
              )}
              {slot.status === "vacant" && (
                <>
                  <Button size="sm" onClick={() => setModal("reissue")}>Reissue to tenant</Button>
                  <Button size="sm" variant="outline" onClick={() => setModal("release")}>
                    Release number
                  </Button>
                </>
              )}
              {slot.status !== "retired" ? (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => confirm(`Retire key #${slot.key_number}?`) && transition("retire")}
                >
                  Retire
                </Button>
              ) : (
                <Button size="sm" onClick={() => transition("reinstate")}>Reinstate</Button>
              )}
            </div>
          </div>

          {/* Banners */}
          {assignment?.sync_flag && (
            <div className="mt-4 rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0" />
              <p className="text-sm text-amber-700">{SYNC_FLAG_LABELS[assignment.sync_flag]}</p>
            </div>
          )}
          {unlinked && (
            <div className="mt-4 rounded-lg bg-sand-50 border border-sand-200 px-4 py-3 flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm text-charcoal-600 flex items-center gap-2">
                <Link2Off className="w-4 h-4 text-charcoal-400" />
                Not linked to AppFolio — imported address: “{assignment?.raw_address}”
              </p>
              <Button size="sm" variant="outline" onClick={() => setModal("link")}>
                Link to unit
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* Key types & copies */}
      {assignment && (
        <div className="bg-white rounded-xl border border-sand-200 shadow-card p-6">
          <h2 className="text-sm font-bold text-charcoal-900 mb-4">Key types &amp; copies</h2>
          <KeyCopiesEditor
            slotId={slotId}
            keyTypes={key_types}
            tenantNames={assignment.tenant_names ?? []}
            editable={slot.status === "assigned" || slot.status === "vacant"}
            onChanged={load}
          />
        </div>
      )}

      {/* AppFolio checkout snapshot for this unit */}
      {(af_checkouts?.length ?? 0) > 0 && (
        <div className="bg-white rounded-xl border border-sand-200 shadow-card p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-bold text-charcoal-900">AppFolio key checkouts</h2>
            <span className="text-[11px] text-charcoal-400">
              snapshot {fmtDate(af_checkouts[0].imported_at)}
            </span>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] font-semibold text-charcoal-400 uppercase tracking-wider border-b border-sand-200">
                <th className="py-1.5 pr-3">Key</th>
                <th className="py-1.5 pr-3">Checked out to</th>
                <th className="py-1.5 pr-3">Type</th>
                <th className="py-1.5 pr-3 text-right">#</th>
                <th className="py-1.5 text-right">Since</th>
              </tr>
            </thead>
            <tbody>
              {af_checkouts.map((c) => (
                <tr key={c.id} className="border-b border-sand-100 last:border-0">
                  <td className="py-2 pr-3 text-charcoal-600">{c.description || c.key_name || "—"}</td>
                  <td className="py-2 pr-3 font-medium text-charcoal-900">{c.assignee}</td>
                  <td className="py-2 pr-3 text-charcoal-500">{c.assignee_type || "—"}</td>
                  <td className="py-2 pr-3 text-right text-charcoal-600">{c.number_checked_out ?? "—"}</td>
                  <td className="py-2 text-right text-charcoal-500">
                    {c.checked_out_date ? fmtDate(c.checked_out_date) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Notes + history */}
      <div className="bg-white rounded-xl border border-sand-200 shadow-card p-6">
        <div className="flex gap-2 mb-5">
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addNote()}
            placeholder="Add a note to this key's history…"
            className="flex-1 px-3 py-2 rounded-lg border border-sand-200 text-sm focus:outline-none focus:ring-2 focus:ring-terra-400"
          />
          <Button size="sm" variant="outline" onClick={addNote} disabled={savingNote || !note.trim()}>
            Add note
          </Button>
        </div>
        <KeyHistoryFeed events={events} pastAssignments={past_assignments} />
      </div>

      {/* Modals */}
      {modal === "assign" && (
        <AssignKeyModal
          slotId={slotId}
          keyNumber={slot.key_number}
          onClose={() => setModal(null)}
          onSaved={load}
        />
      )}
      {modal === "vacant" && (
        <MarkVacantModal
          slotId={slotId}
          keyNumber={slot.key_number}
          keyTypes={key_types}
          onClose={() => setModal(null)}
          onSaved={load}
        />
      )}
      {modal === "reissue" && (
        <ReissueModal
          slotId={slotId}
          keyNumber={slot.key_number}
          keyTypes={key_types}
          onClose={() => setModal(null)}
          onSaved={load}
        />
      )}
      {modal === "release" && (
        <ReleaseKeyModal
          slotId={slotId}
          keyNumber={slot.key_number}
          address={address}
          onClose={() => setModal(null)}
          onSaved={load}
        />
      )}
      {modal === "link" && (
        <ModalShell
          title={`Link key #${slot.key_number} to an AppFolio unit`}
          onClose={() => setModal(null)}
          busy={linking}
          footer={
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setModal(null)} disabled={linking}>
                Cancel
              </Button>
              <Button size="sm" onClick={linkToUnit} disabled={!linkUnit || linking}>
                {linking ? "Linking…" : "Link unit"}
              </Button>
            </div>
          }
        >
          <UnitPicker selected={linkUnit} onSelect={setLinkUnit} />
        </ModalShell>
      )}
    </div>
  );
}
