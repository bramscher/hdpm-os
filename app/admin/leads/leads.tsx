"use client";

import { useCallback, useEffect, useState } from "react";
import { ExternalLink, Search, Target, X } from "lucide-react";
import { toast } from "sonner";
import { PageContainer, PageHeader } from "@/components/ui/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";

// Mirrors hdpm-web /api/os/leads
type Person = { id: number; name: string };
interface LeadRow {
  id: number;
  name: string;
  email: string | null;
  phone: string | null;
  status: string;
  leadType: string | null;
  source: string | null;
  assignedTo: Person | null;
  nextFollowUpAt: string | null;
  createdAt: string;
  isDuplicateOfLeadId: number | null;
}
interface LeadDetail extends LeadRow {
  preferredLanguage: string | null;
  doNotContact: boolean;
  sourceDetail: string | null;
  stageReason: string | null;
  notesSummary: string | null;
  message: string | null;
  desiredMoveInDate: string | null;
  monthlyBudgetMin: number | null;
  monthlyBudgetMax: number | null;
  subjectProperty: { address?: string | null; town?: string | null; bedrooms?: number | null; bathrooms?: number | null; propertyType?: string | null } | null;
  rentAnalysisStatus: string | null;
  rentAnalysisShortUrl: string | null;
  lastContactedAt: string | null;
  allowedStatuses: string[];
}
interface Activity {
  id: number;
  type: string;
  direction: string | null;
  body: string;
  performedBy: string | null;
  createdAt: string;
}

const STATUS_LABELS: Record<string, string> = {
  new: "New",
  attempted_contact: "Attempted contact",
  engaged: "Engaged",
  tour_scheduled: "Tour scheduled",
  toured: "Toured",
  applied: "Applied",
  approved: "Approved",
  leased: "Leased",
  lost: "Lost",
  archived: "Archived",
};
const STATUS_TONE: Record<string, "neutral" | "terra" | "success" | "warning" | "danger" | "info"> = {
  new: "terra",
  attempted_contact: "warning",
  engaged: "info",
  tour_scheduled: "info",
  toured: "info",
  applied: "info",
  approved: "success",
  leased: "success",
  lost: "neutral",
  archived: "neutral",
};
const TYPE_LABELS: Record<string, string> = { tenant: "Tenant", owner: "Owner", vendor: "Vendor", other: "Other" };
const SOURCE_LABELS: Record<string, string> = {
  zillow: "Zillow",
  apartments_com: "Apartments.com",
  website: "Website",
  facebook: "Facebook",
  instagram: "Instagram",
  phone: "Phone",
  walk_in: "Walk-in",
  referral: "Referral",
  other: "Other",
};

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/admin/leads/${path}`, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data as T;
}

const formatDate = (iso: string | null, withTime = true) =>
  iso
    ? new Date(iso).toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        ...(withTime ? { hour: "numeric", minute: "2-digit" } : {}),
      })
    : "—";
const isOverdue = (iso: string | null) => !!iso && new Date(iso).getTime() < Date.now();

/** ISO → value for <input type="datetime-local"> in the viewer's time zone. */
function toLocalInput(iso: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

export function Leads({ websiteUrl }: { websiteUrl: string }) {
  const [view, setView] = useState("open");
  const [type, setType] = useState("");
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<{ leads: LeadRow[]; page: number; totalPages: number; totalDocs: number; users: Person[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<number | null>(null);

  const load = useCallback(async () => {
    const params = new URLSearchParams({ view, page: String(page) });
    if (type) params.set("type", type);
    if (search) params.set("q", search);
    try {
      setData(await call(`list?${params}`));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load leads");
    }
  }, [view, type, search, page]);
  useEffect(() => {
    load();
  }, [load]);

  return (
    <PageContainer width="full" className="max-w-[1500px] mx-auto">
      <PageHeader
        title="Leads"
        description="Website CRM leads. Update status, follow-ups and owner, and add notes; everything stays in sync with the website CRM."
        actions={
          <Button variant="outline" size="sm" asChild>
            <a href={`${websiteUrl}/admin/crm`} target="_blank" rel="noreferrer">
              Website CRM <ExternalLink className="ml-1.5 h-3.5 w-3.5" />
            </a>
          </Button>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <select aria-label="Status" className="h-9 rounded-md border border-sand-300 bg-white px-2 text-sm" value={view} onChange={(e) => { setView(e.target.value); setPage(1); }}>
          <option value="open">Open leads</option>
          <option value="all">All leads</option>
          {Object.entries(STATUS_LABELS).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
        <select aria-label="Lead type" className="h-9 rounded-md border border-sand-300 bg-white px-2 text-sm" value={type} onChange={(e) => { setType(e.target.value); setPage(1); }}>
          <option value="">All types</option>
          {Object.entries(TYPE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
        <form
          className="flex items-center gap-1"
          onSubmit={(e) => {
            e.preventDefault();
            setSearch(query.trim());
            setPage(1);
          }}
        >
          <input
            className="h-9 w-64 rounded-md border border-sand-300 px-3 text-sm"
            placeholder="Name, email or phone"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <Button type="submit" size="sm" variant="outline" aria-label="Search"><Search className="h-4 w-4" /></Button>
        </form>
        {data && <span className="ml-auto text-sm text-charcoal-500">{data.totalDocs} lead{data.totalDocs === 1 ? "" : "s"}</span>}
      </div>

      <div className={`grid gap-4 ${selected ? "lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]" : ""}`}>
        <div>
          {error ? (
            <p role="alert" className="rounded-lg bg-sand-100 p-4 text-sm text-charcoal-700">
              {error} <button className="underline" onClick={load}>Try again</button>
            </p>
          ) : !data ? (
            <p className="text-sm text-charcoal-500">Loading…</p>
          ) : !data.leads.length ? (
            <EmptyState icon={Target} title="No leads match" hint="Try Open leads or All leads, or clear the search." />
          ) : (
            <div className="divide-y divide-sand-200 rounded-xl border border-sand-200 bg-white">
              {data.leads.map((lead) => (
                <button
                  key={lead.id}
                  onClick={() => setSelected(lead.id)}
                  className={`flex w-full flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-left hover:bg-sand-50 ${selected === lead.id ? "bg-sand-50" : ""}`}
                >
                  <span className="min-w-[10rem] flex-1">
                    <span className="block font-medium text-charcoal-900">{lead.name}</span>
                    <span className="block text-xs text-charcoal-500">
                      {[lead.leadType && TYPE_LABELS[lead.leadType], lead.source && SOURCE_LABELS[lead.source]].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                  <span className="w-32 text-sm text-charcoal-600">{lead.assignedTo?.name ?? "Unassigned"}</span>
                  <span className={`w-36 text-sm ${isOverdue(lead.nextFollowUpAt) && !["leased", "lost", "archived"].includes(lead.status) ? "font-medium text-red-700" : "text-charcoal-500"}`}>
                    {lead.nextFollowUpAt ? `Follow up ${formatDate(lead.nextFollowUpAt, false)}` : "No follow-up"}
                  </span>
                  <Badge tone={STATUS_TONE[lead.status] ?? "neutral"}>{STATUS_LABELS[lead.status] ?? lead.status}</Badge>
                </button>
              ))}
            </div>
          )}
          {data && data.totalPages > 1 && (
            <div className="mt-3 flex items-center justify-between text-sm">
              <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button>
              <span className="text-charcoal-500">Page {data.page} of {data.totalPages}</span>
              <Button size="sm" variant="outline" disabled={page >= data.totalPages} onClick={() => setPage(page + 1)}>Next</Button>
            </div>
          )}
        </div>
        {selected && (
          <LeadPanel key={selected} id={selected} users={data?.users ?? []} websiteUrl={websiteUrl} onClose={() => setSelected(null)} onChange={load} />
        )}
      </div>
    </PageContainer>
  );
}

function LeadPanel({ id, users, websiteUrl, onClose, onChange }: { id: number; users: Person[]; websiteUrl: string; onClose: () => void; onChange: () => void }) {
  const [lead, setLead] = useState<LeadDetail | null>(null);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState("");
  const [followUp, setFollowUp] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await call<{ lead: LeadDetail; activities: Activity[] }>(String(id));
      setLead(res.lead);
      setActivities(res.activities);
      setFollowUp(toLocalInput(res.lead.nextFollowUpAt));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load lead");
    }
  }, [id]);
  useEffect(() => {
    load();
  }, [load]);

  async function update(body: Record<string, unknown>, message: string) {
    setSaving(true);
    try {
      await call(String(id), { method: "PATCH", body: JSON.stringify(body) });
      toast.success(message);
      await load();
      onChange();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not update lead");
    } finally {
      setSaving(false);
    }
  }

  async function addNote() {
    setSaving(true);
    try {
      await call(`${id}/notes`, { method: "POST", body: JSON.stringify({ body: note }) });
      setNote("");
      toast.success("Note added");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not add note");
    } finally {
      setSaving(false);
    }
  }

  return (
    <aside className="rounded-xl border border-sand-200 bg-white p-5 lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-heading text-charcoal-900">{lead?.name ?? "Lead"}</h2>
          {lead && (
            <p className="mt-0.5 text-sm text-charcoal-500">
              {[lead.leadType && TYPE_LABELS[lead.leadType], lead.source && SOURCE_LABELS[lead.source], lead.sourceDetail].filter(Boolean).join(" · ")} · added {formatDate(lead.createdAt)}
            </p>
          )}
        </div>
        <button onClick={onClose} aria-label="Close" className="rounded p-1 text-charcoal-400 hover:bg-sand-100 hover:text-charcoal-700"><X className="h-4 w-4" /></button>
      </div>

      {error ? (
        <p role="alert" className="text-sm text-charcoal-700">{error}</p>
      ) : !lead ? (
        <p className="text-sm text-charcoal-500">Loading…</p>
      ) : (
        <div className="space-y-5 text-sm">
          {lead.doNotContact && <p className="rounded-md bg-red-50 px-3 py-2 font-medium text-red-800">Do not contact</p>}
          {lead.isDuplicateOfLeadId && <p className="rounded-md bg-sand-100 px-3 py-2 text-charcoal-700">Possible duplicate of lead #{lead.isDuplicateOfLeadId}</p>}

          <p className="text-charcoal-700">
            {lead.email && <a className="underline" href={`mailto:${lead.email}`}>{lead.email}</a>}
            {lead.email && lead.phone && " · "}
            {lead.phone && <a className="underline" href={`tel:${lead.phone}`}>{lead.phone}</a>}
            {lead.preferredLanguage === "es" && " · Prefers Spanish"}
          </p>

          <div className="grid gap-3 sm:grid-cols-3">
            <label className="block">
              <span className="text-xs font-semibold uppercase tracking-wide text-charcoal-400">Status</span>
              <select
                className="mt-1 h-9 w-full rounded-md border border-sand-300 bg-white px-2"
                value={lead.status}
                disabled={saving}
                onChange={(e) => update({ status: e.target.value }, `Status set to ${STATUS_LABELS[e.target.value]}`)}
              >
                <option value={lead.status}>{STATUS_LABELS[lead.status] ?? lead.status}</option>
                {lead.allowedStatuses.map((s) => (
                  <option key={s} value={s}>{STATUS_LABELS[s] ?? s}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-xs font-semibold uppercase tracking-wide text-charcoal-400">Owner</span>
              <select
                className="mt-1 h-9 w-full rounded-md border border-sand-300 bg-white px-2"
                value={lead.assignedTo?.id ?? ""}
                disabled={saving}
                onChange={(e) => update({ assignedTo: e.target.value ? Number(e.target.value) : null }, "Owner updated")}
              >
                <option value="">Unassigned</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>{u.name}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-xs font-semibold uppercase tracking-wide text-charcoal-400">Next follow-up</span>
              <input
                type="datetime-local"
                className="mt-1 h-9 w-full rounded-md border border-sand-300 px-2"
                value={followUp}
                disabled={saving}
                onChange={(e) => setFollowUp(e.target.value)}
                onBlur={() => {
                  if (followUp === toLocalInput(lead.nextFollowUpAt)) return;
                  update({ nextFollowUpAt: followUp ? new Date(followUp).toISOString() : null }, followUp ? "Follow-up scheduled" : "Follow-up cleared");
                }}
              />
            </label>
          </div>

          <Details lead={lead} />

          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-charcoal-400">Add a note</h3>
            <textarea
              className="mt-1 h-20 w-full rounded-md border border-sand-300 p-2"
              placeholder="Called, left voicemail…"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
            <Button size="sm" className="mt-1" disabled={saving || !note.trim()} onClick={addNote}>Add note</Button>
          </section>

          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-charcoal-400">History</h3>
            {!activities.length ? (
              <p className="mt-1 text-charcoal-500">No activity yet.</p>
            ) : (
              <ol className="mt-2 space-y-3 border-l border-sand-200 pl-4">
                {activities.map((a) => (
                  <li key={a.id}>
                    <p className="text-xs text-charcoal-400">
                      {formatDate(a.createdAt)} · {a.type.replace(/_/g, " ")}{a.performedBy ? ` · ${a.performedBy}` : ""}
                    </p>
                    <p className="mt-0.5 whitespace-pre-wrap text-charcoal-800">{a.body}</p>
                  </li>
                ))}
              </ol>
            )}
          </section>

          <a className="inline-flex items-center text-charcoal-600 underline" href={`${websiteUrl}/admin/collections/leads/${lead.id}`} target="_blank" rel="noreferrer">
            Open full record on the website <ExternalLink className="ml-1 h-3.5 w-3.5" />
          </a>
        </div>
      )}
    </aside>
  );
}

function Details({ lead }: { lead: LeadDetail }) {
  const property = lead.subjectProperty;
  const budget =
    lead.monthlyBudgetMin || lead.monthlyBudgetMax
      ? [lead.monthlyBudgetMin, lead.monthlyBudgetMax].filter(Boolean).map((n) => `$${n!.toLocaleString()}`).join("–") + "/mo"
      : null;
  const rows: [string, React.ReactNode][] = [
    ["Message", lead.message],
    ["Notes", lead.notesSummary],
    ["Stage reason", lead.stageReason],
    ["Move-in", lead.desiredMoveInDate ? formatDate(lead.desiredMoveInDate, false) : null],
    ["Budget", budget],
    [
      "Property",
      property?.address
        ? [property.address, property.town, property.bedrooms != null && `${property.bedrooms} bd`, property.bathrooms != null && `${property.bathrooms} ba`, property.propertyType].filter(Boolean).join(" · ")
        : null,
    ],
    [
      "Rent analysis",
      lead.rentAnalysisStatus && lead.rentAnalysisStatus !== "none" ? (
        <>
          {lead.rentAnalysisStatus.replace(/_/g, " ")}
          {lead.rentAnalysisShortUrl && (
            <> · <a className="underline" href={lead.rentAnalysisShortUrl} target="_blank" rel="noreferrer">view</a></>
          )}
        </>
      ) : null,
    ],
    ["Last contacted", lead.lastContactedAt ? formatDate(lead.lastContactedAt) : null],
  ];
  const shown = rows.filter(([, value]) => value);
  if (!shown.length) return null;
  return (
    <dl className="space-y-3">
      {shown.map(([label, value]) => (
        <div key={label}>
          <dt className="text-xs font-semibold uppercase tracking-wide text-charcoal-400">{label}</dt>
          <dd className="mt-0.5 whitespace-pre-wrap text-charcoal-800">{value}</dd>
        </div>
      ))}
    </dl>
  );
}
