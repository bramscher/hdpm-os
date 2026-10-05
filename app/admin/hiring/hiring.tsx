"use client";

import { useCallback, useEffect, useState } from "react";
import { Briefcase, ExternalLink, FileText, Mail, Video } from "lucide-react";
import { toast } from "sonner";
import { PageContainer, PageHeader } from "@/components/ui/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";

// Mirrors hdpm-web /api/os/hiring
type FileInfo = { kind: "resume" | "video"; name: string; size: number };
interface Application {
  id: number;
  jobTitle: string;
  fullName: string;
  email: string;
  phone: string;
  availability: string;
  experience: string;
  technology: string;
  notificationStatus: "pending" | "sent" | "failed";
  createdAt: string;
  files: FileInfo[];
}
interface Job {
  id: number;
  title: string;
  status: "draft" | "open" | "closed";
  location?: string | null;
}
interface Settings {
  applicationRecipients: string;
  resendSince: string | null;
  lastResend: string | null;
}

const TABS = [
  { key: "applications", label: "Applications" },
  { key: "jobs", label: "Jobs" },
  { key: "settings", label: "Email settings" },
] as const;

const STATUS_TONE = { sent: "success", pending: "warning", failed: "danger" } as const;

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/admin/hiring/${path}`, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data as T;
}

const formatDate = (iso: string) =>
  new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });

export function Hiring({ websiteUrl }: { websiteUrl: string }) {
  const [tab, setTab] = useState<(typeof TABS)[number]["key"]>("applications");
  const [data, setData] = useState<{ applications: Application[]; jobs: Job[]; settings: Settings | null } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await call("overview"));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load hiring data");
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  return (
    <PageContainer>
      <PageHeader
        title="Hiring"
        description="Job applications from the website, which roles are open, and who gets application emails."
        actions={
          <Button variant="outline" size="sm" asChild>
            <a href={`${websiteUrl}/admin/collections/jobs`} target="_blank" rel="noreferrer">
              Edit job postings <ExternalLink className="ml-1.5 h-3.5 w-3.5" />
            </a>
          </Button>
        }
      />
      <div className="mb-5 flex gap-5 border-b border-sand-200">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`-mb-px border-b-2 pb-2 text-[13px] font-medium transition-colors ${
              tab === t.key ? "border-charcoal-950 text-charcoal-950" : "border-transparent text-charcoal-400 hover:text-charcoal-800"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {error ? (
        <p role="alert" className="rounded-lg bg-sand-100 p-4 text-sm text-charcoal-700">
          {error} <button className="underline" onClick={load}>Try again</button>
        </p>
      ) : !data ? (
        <p className="text-sm text-charcoal-500">Loading…</p>
      ) : tab === "applications" ? (
        <Applications applications={data.applications} onChange={load} />
      ) : tab === "jobs" ? (
        <Jobs jobs={data.jobs} websiteUrl={websiteUrl} onChange={load} />
      ) : (
        <EmailSettings settings={data.settings} onChange={load} />
      )}
    </PageContainer>
  );
}

function Applications({ applications, onChange }: { applications: Application[]; onChange: () => void }) {
  const [open, setOpen] = useState<number | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  if (!applications.length) return <EmptyState icon={Briefcase} title="No applications yet" hint="Applications submitted on the website careers page appear here." />;

  async function viewFile(app: Application, kind: FileInfo["kind"]) {
    // Open the tab now so the browser doesn't block it as a popup.
    const win = window.open("about:blank", "_blank");
    try {
      const { url } = await call<{ url: string }>(`applications/${app.id}?kind=${kind}`);
      if (win) win.location.href = url;
      else window.location.href = url;
    } catch (err) {
      win?.close();
      toast.error(err instanceof Error ? err.message : "Could not open file");
    }
  }

  async function resend(app: Application) {
    setBusy(app.id);
    try {
      const { notificationStatus } = await call<{ notificationStatus: string }>(`applications/${app.id}`, { method: "POST" });
      if (notificationStatus === "sent") toast.success(`Emailed ${app.fullName}'s application`);
      else toast.error("The email could not be sent. Check Email settings and try again.");
      onChange();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not resend");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="divide-y divide-sand-200 rounded-xl border border-sand-200 bg-white">
      {applications.map((app) => (
        <div key={app.id}>
          <button className="flex w-full flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-left hover:bg-sand-50" onClick={() => setOpen(open === app.id ? null : app.id)}>
            <span className="min-w-[10rem] flex-1 font-medium text-charcoal-900">{app.fullName}</span>
            <span className="flex-1 text-sm text-charcoal-600">{app.jobTitle}</span>
            <span className="flex gap-1.5 text-charcoal-400">
              {app.files.some((f) => f.kind === "resume") && <FileText className="h-4 w-4" aria-label="Résumé" />}
              {app.files.some((f) => f.kind === "video") && <Video className="h-4 w-4" aria-label="Video" />}
            </span>
            <span className="w-40 text-sm text-charcoal-500">{formatDate(app.createdAt)}</span>
            <Badge tone={STATUS_TONE[app.notificationStatus]}>{app.notificationStatus === "sent" ? "Emailed" : app.notificationStatus === "failed" ? "Email failed" : "Not emailed"}</Badge>
          </button>
          {open === app.id && (
            <div className="space-y-4 bg-sand-50 px-4 py-4 text-sm">
              <p className="text-charcoal-700">
                <a className="underline" href={`mailto:${app.email}`}>{app.email}</a> · <a className="underline" href={`tel:${app.phone}`}>{app.phone}</a>
              </p>
              {(
                [
                  ["Availability", app.availability],
                  ["Experience", app.experience],
                  ["Technology", app.technology],
                ] as const
              ).map(([label, value]) => (
                <div key={label}>
                  <p className="text-xs font-semibold uppercase tracking-wide text-charcoal-400">{label}</p>
                  <p className="mt-1 whitespace-pre-wrap text-charcoal-800">{value}</p>
                </div>
              ))}
              <div className="flex flex-wrap gap-2">
                {app.files.map((f) => (
                  <Button key={f.kind} size="sm" variant="outline" onClick={() => viewFile(app, f.kind)}>
                    {f.kind === "resume" ? <FileText className="mr-1.5 h-4 w-4" /> : <Video className="mr-1.5 h-4 w-4" />}
                    {f.kind === "resume" ? "Résumé" : "Video"} ({(f.size / 1024 / 1024).toFixed(1)} MB)
                  </Button>
                ))}
                <Button size="sm" variant="outline" disabled={busy === app.id} onClick={() => resend(app)}>
                  <Mail className="mr-1.5 h-4 w-4" /> {busy === app.id ? "Sending…" : "Email again"}
                </Button>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function Jobs({ jobs, websiteUrl, onChange }: { jobs: Job[]; websiteUrl: string; onChange: () => void }) {
  const [saving, setSaving] = useState<number | null>(null);
  if (!jobs.length) return <EmptyState icon={Briefcase} title="No jobs yet" hint="Create job postings in the website admin." />;

  async function setStatus(job: Job, status: Job["status"]) {
    setSaving(job.id);
    try {
      await call(`jobs/${job.id}`, { method: "PATCH", body: JSON.stringify({ status }) });
      toast.success(`${job.title} is now ${status === "open" ? "open and published" : status === "closed" ? "closed" : "a draft"}`);
      onChange();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not update job");
    } finally {
      setSaving(null);
    }
  }

  return (
    <div className="divide-y divide-sand-200 rounded-xl border border-sand-200 bg-white">
      {jobs.map((job) => (
        <div key={job.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
          <div className="min-w-[12rem] flex-1">
            <p className="font-medium text-charcoal-900">{job.title}</p>
            {job.location && <p className="text-sm text-charcoal-500">{job.location}</p>}
          </div>
          <select
            aria-label={`Availability for ${job.title}`}
            className="h-9 rounded-md border border-sand-300 bg-white px-2 text-sm"
            value={job.status}
            disabled={saving === job.id}
            onChange={(e) => setStatus(job, e.target.value as Job["status"])}
          >
            <option value="open">Open / Published</option>
            <option value="closed">Closed / Unpublished</option>
            <option value="draft">Draft / Unpublished</option>
          </select>
          <a className="text-sm text-charcoal-600 underline" href={`${websiteUrl}/admin/collections/jobs/${job.id}`} target="_blank" rel="noreferrer">
            Edit posting
          </a>
        </div>
      ))}
    </div>
  );
}

function EmailSettings({ settings, onChange }: { settings: Settings | null; onChange: () => void }) {
  const [recipients, setRecipients] = useState(settings?.applicationRecipients ?? "");
  const [since, setSince] = useState("");
  const [saving, setSaving] = useState<"recipients" | "resend" | null>(null);

  if (!settings)
    return (
      <p className="rounded-lg bg-sand-100 p-4 text-sm text-charcoal-700">
        Hiring Settings aren’t set up on the website database yet. Run scripts/sql/add-hiring-settings.sql in the Supabase SQL editor, then reload.
      </p>
    );

  async function save(body: Record<string, string>, which: "recipients" | "resend") {
    setSaving(which);
    try {
      const res = await call<{ settings: Settings }>("settings", { method: "PATCH", body: JSON.stringify(body) });
      toast.success(which === "recipients" ? "Recipients saved" : res.settings.lastResend || "Applications resent");
      setSince("");
      onChange();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save");
    } finally {
      setSaving(null);
    }
  }

  return (
    <div className="max-w-xl space-y-8">
      <section>
        <h2 className="text-heading text-charcoal-900">Application email recipients</h2>
        <p className="mt-1 text-sm text-charcoal-500">One address per line. Every new application is emailed here with the résumé and video attached.</p>
        <textarea
          className="mt-3 h-32 w-full rounded-md border border-sand-300 p-3 font-mono text-sm"
          value={recipients}
          onChange={(e) => setRecipients(e.target.value)}
        />
        <Button className="mt-2" size="sm" disabled={saving !== null || recipients === settings.applicationRecipients} onClick={() => save({ applicationRecipients: recipients }, "recipients")}>
          {saving === "recipients" ? "Saving…" : "Save recipients"}
        </Button>
      </section>
      <section>
        <h2 className="text-heading text-charcoal-900">Resend past applications</h2>
        <p className="mt-1 text-sm text-charcoal-500">Email every application received on or after a date to the recipients above. This can take a minute.</p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input type="date" className="h-9 rounded-md border border-sand-300 px-2 text-sm" value={since} onChange={(e) => setSince(e.target.value)} />
          <Button
            size="sm"
            variant="outline"
            disabled={!since || saving !== null}
            // Midnight on the chosen day in the viewer's (Pacific) time zone.
            onClick={() => save({ resendSince: new Date(`${since}T00:00:00`).toISOString() }, "resend")}
          >
            {saving === "resend" ? "Sending…" : "Send"}
          </Button>
        </div>
        {settings.lastResend && <p className="mt-2 text-sm text-charcoal-500">Last resend: {settings.lastResend}</p>}
      </section>
    </div>
  );
}
