"use client";

import { useState } from "react";
import { toast } from "sonner";
import { RISK_NOTE_AUTHORS, MAX_RISK_NOTE_CHARS, type RiskNote } from "@/lib/fee-management/risk-notes";

const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

/**
 * Matt's and Penny's notes on one at-risk owner. Each person sees everyone's
 * note and edits only their own. Used in Fee Management and Knowledge Capture
 * (`saveUrl` is that section's PUT route).
 */
export function RiskNotes({
  ownerSetKey,
  ownerName,
  notes,
  me,
  saveUrl,
  onSaved,
}: {
  ownerSetKey: string;
  ownerName: string;
  /** All notes; this filters to the owner. */
  notes: RiskNote[];
  me: string | null;
  saveUrl: string;
  onSaved: (ownerSetKey: string, authorEmail: string, note: RiskNote | null) => void;
}) {
  const mine = (me ?? "").toLowerCase();
  const forOwner = notes.filter((n) => n.ownerSetKey === ownerSetKey);
  // Matt and Penny always; anyone else (Craig) once they've written or when it's them.
  const authors = RISK_NOTE_AUTHORS.filter((a) => a.primary || a.email === mine || forOwner.some((n) => n.authorEmail === a.email));

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {authors.map((a) => {
        const note = forOwner.find((n) => n.authorEmail === a.email) ?? null;
        return a.email === mine ? (
          <MyNote key={a.email} name={a.name} note={note} ownerSetKey={ownerSetKey} ownerName={ownerName} saveUrl={saveUrl} onSaved={onSaved} me={mine} />
        ) : (
          <div key={a.email} className="rounded-md bg-sand-50 p-2.5">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-charcoal-500">{a.name}&apos;s notes</p>
            {note ? (
              <>
                <p className="mt-1 whitespace-pre-wrap text-[13px] text-charcoal-800">{note.note}</p>
                <p className="mt-1 text-[11px] text-charcoal-400">{formatDate(note.updatedAt)}</p>
              </>
            ) : (
              <p className="mt-1 text-[12px] text-charcoal-400">No notes yet.</p>
            )}
          </div>
        );
      })}
    </div>
  );
}

function MyNote({
  name,
  note,
  ownerSetKey,
  ownerName,
  saveUrl,
  onSaved,
  me,
}: {
  name: string;
  note: RiskNote | null;
  ownerSetKey: string;
  ownerName: string;
  saveUrl: string;
  onSaved: (ownerSetKey: string, authorEmail: string, note: RiskNote | null) => void;
  me: string;
}) {
  const [draft, setDraft] = useState(note?.note ?? "");
  const [saving, setSaving] = useState(false);
  const dirty = draft.trim() !== (note?.note ?? "");

  async function save() {
    setSaving(true);
    try {
      const res = await fetch(saveUrl, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ownerSetKey, ownerName, note: draft }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Save failed (${res.status})`);
      onSaved(ownerSetKey, me, body.note ?? null);
      setDraft(body.note?.note ?? "");
      toast.success(body.note ? "Note saved." : "Note cleared.");
    } catch (err) {
      toast.error(err instanceof Error && err.message !== "Failed to fetch" ? err.message : "No signal — try again when you're back online.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-md border border-terra-200 bg-white p-2.5">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-charcoal-500">{name}&apos;s notes (yours)</p>
      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        maxLength={MAX_RISK_NOTE_CHARS}
        rows={3}
        placeholder="How will they take the increase? Who to call, what they care about, how to frame it…"
        className="mt-1 w-full rounded-md border border-sand-300 px-2 py-1.5 text-base focus:border-terra-400 focus:outline-none sm:text-[13px]"
      />
      <div className="mt-1 flex items-center justify-between gap-2">
        <span className="text-[11px] text-charcoal-400">{note ? `Saved ${formatDate(note.updatedAt)}` : "Only you edit this."}</span>
        <button
          onClick={save}
          disabled={!dirty || saving}
          className="h-7 rounded-md bg-charcoal-900 px-3 text-[12px] font-medium text-white hover:bg-charcoal-800 disabled:opacity-40"
        >
          {saving ? "Saving…" : "Save note"}
        </button>
      </div>
    </div>
  );
}
