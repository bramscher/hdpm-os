"use client";

import { useMemo, useState } from "react";
import { Link2, Unlink, Users } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { LinkSuggestion, LinkedRosterOwner } from "@/lib/knowledge-capture/links";

type Kind = "same" | "related" | "distinct";

async function send(method: "POST" | "DELETE", body: Record<string, unknown>) {
  const res = await fetch("/api/knowledge-capture/owner-links", {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
}

/**
 * Linked records for one owner profile: suggested duplicates/relatives,
 * merged duplicate records, related owners, and a picker to link any owner.
 */
export function OwnerLinks({
  owner,
  owners,
  suggestions,
  onSelect,
  onChanged,
}: {
  owner: LinkedRosterOwner;
  owners: LinkedRosterOwner[];
  suggestions: LinkSuggestion[];
  onSelect: (id: string) => void;
  onChanged: () => Promise<void> | void;
}) {
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<LinkedRosterOwner | null>(null);
  const [note, setNote] = useState("");

  const mine = suggestions.filter((s) => s.a.id === owner.id || s.b.id === owner.id);
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [];
    return owners
      .filter((o) => o.id !== owner.id && (o.name.toLowerCase().includes(q) || o.email?.toLowerCase().includes(q)))
      .slice(0, 8);
  }, [owners, owner.id, query]);

  async function run(label: string, fn: () => Promise<void>) {
    setBusy(true);
    try {
      await fn();
      toast.success(label);
      setPicked(null);
      setQuery("");
      setNote("");
      await onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
    }
    setBusy(false);
  }

  const link = (other: { id: string; name: string }, kind: Kind, linkNote?: string) => {
    if (
      kind === "same" &&
      !window.confirm(
        `Merge "${other.name}" into "${owner.name}"?\n\nUse this only when they are the same person or entity entered twice in AppFolio. Their recordings and properties join this profile. You can unlink later.`
      )
    )
      return;
    const done =
      kind === "same" ? `Merged ${other.name} into this profile.` : kind === "related" ? `Linked ${other.name} as related.` : "Got it — won't suggest that again.";
    void run(done, () => send("POST", { ownerId: owner.id, otherId: other.id, kind, note: linkNote }));
  };

  const unlink = (other: { id: string; name: string }) => {
    if (!window.confirm(`Unlink "${other.name}" from "${owner.name}"? Both profiles rebuild from their own recordings.`)) return;
    void run(`Unlinked ${other.name}.`, () => send("DELETE", { ownerId: owner.id, otherId: other.id }));
  };

  return (
    <section className="rounded-lg border border-sand-200 bg-white p-5">
      <div className="mb-1 flex items-center gap-2">
        <Users className="h-4 w-4 text-charcoal-500" />
        <h3 className="font-semibold text-charcoal-900">Linked records</h3>
      </div>
      <p className="mb-4 text-sm text-charcoal-500">
        <strong className="font-medium text-charcoal-700">Same person</strong> when AppFolio has this owner twice — the records merge
        into one profile. <strong className="font-medium text-charcoal-700">Related</strong> for a different person or entity that
        belongs with them (their trust or LLC, a spouse, a business partner) — each keeps its own profile. A group with a different
        partner needs no link: this person is already one profile across all their groups.
      </p>

      {mine.length > 0 && (
        <div className="mb-4 space-y-2">
          <p className="text-xs font-medium uppercase tracking-wide text-charcoal-500">Possible matches</p>
          {mine.map((s) => {
            const other = s.a.id === owner.id ? s.b : s.a;
            return (
              <div key={other.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-amber-50 px-3 py-2">
                <div className="text-sm">
                  <button onClick={() => onSelect(other.id)} className="font-medium text-charcoal-900 hover:underline">
                    {other.name}
                  </button>
                  <span className="text-charcoal-500">
                    {" "}
                    · {s.reason} · looks {s.kind === "same" ? "like the same person" : "related"}
                  </span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <Button size="sm" variant={s.kind === "same" ? "default" : "outline"} disabled={busy} onClick={() => link(other, "same")}>
                    Same person
                  </Button>
                  <Button size="sm" variant={s.kind === "related" ? "default" : "outline"} disabled={busy} onClick={() => link(other, "related")}>
                    Related
                  </Button>
                  <Button size="sm" variant="ghost" disabled={busy} onClick={() => link(other, "distinct")}>
                    Not the same
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {(owner.aliases.length > 0 || owner.related.length > 0) && (
        <ul className="mb-4 space-y-1.5">
          {owner.aliases.map((a) => (
            <li key={a.id} className="flex items-center justify-between gap-2 text-sm">
              <span>
                <Badge tone="info" variant="soft" className="mr-2">
                  Same person
                </Badge>
                {a.name}
                <span className="text-charcoal-400"> · merged AppFolio record</span>
              </span>
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => unlink(a)}>
                <Unlink className="mr-1.5 h-4 w-4" />
                Unlink
              </Button>
            </li>
          ))}
          {owner.related.map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-2 text-sm">
              <span>
                <Badge tone="neutral" variant="soft" className="mr-2">
                  Related
                </Badge>
                <button onClick={() => onSelect(r.id)} className="font-medium text-charcoal-900 hover:underline">
                  {r.name}
                </button>
                {r.note && <span className="text-charcoal-500"> · {r.note}</span>}
              </span>
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => unlink(r)}>
                <Unlink className="mr-1.5 h-4 w-4" />
                Unlink
              </Button>
            </li>
          ))}
        </ul>
      )}

      {picked ? (
        <div className="space-y-2 rounded-md border border-sand-200 p-3">
          <p className="text-sm text-charcoal-800">
            How is <strong>{picked.name}</strong> connected to {owner.name}?
          </p>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={200}
            placeholder="Optional note for Related, e.g. their family trust, spouse, LLC partner"
            className="w-full rounded-md border border-sand-300 px-3 py-2 text-base focus:border-terra-400 focus:outline-none sm:text-sm"
          />
          <div className="flex flex-wrap gap-2">
            <Button size="sm" disabled={busy} onClick={() => link(picked, "same")}>
              Same person — merge
            </Button>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => link(picked, "related", note)}>
              Related — keep separate
            </Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => setPicked(null)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="relative">
          <Link2 className="absolute left-2.5 top-2.5 h-4 w-4 text-charcoal-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Link another owner — search by name or email"
            className="w-full rounded-md border border-sand-300 py-2 pl-8 pr-3 text-base focus:border-terra-400 focus:outline-none sm:text-sm"
          />
          {matches.length > 0 && (
            <ul className="absolute z-10 mt-1 w-full overflow-hidden rounded-md border border-sand-200 bg-white shadow-md">
              {matches.map((o) => (
                <li key={o.id}>
                  <button onClick={() => setPicked(o)} className="block w-full px-3 py-2 text-left text-sm hover:bg-sand-50">
                    <span className="font-medium text-charcoal-900">{o.name}</span>
                    <span className="text-charcoal-500">
                      {" "}
                      · {o.properties.length} {o.properties.length === 1 ? "property" : "properties"}
                      {o.email ? ` · ${o.email}` : ""}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
