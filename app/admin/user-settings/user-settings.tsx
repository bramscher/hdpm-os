"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import StaffPermissions from "../staff-permissions/staff-permissions";
import { APP_SECTIONS, roleDefault, sectionAllowed, type AppSection, type SectionOverrides } from "@/lib/access/sections";

interface StaffRow {
  person: string;
  email: string | null;
  jobTitle: string | null;
  access_role: string;
  overrides: SectionOverrides;
  version: number;
  denied: string[];
}
interface AuditRow {
  id: number;
  person: string;
  actor: string;
  reason: string | null;
  created_at: string;
  before_overrides: SectionOverrides;
  after_overrides: SectionOverrides;
}

const GROUPS = ["main", "Maintenance", "Leasing", "Company", "Admin"] as const;
const GROUP_LABEL: Record<string, string> = { main: "General", Maintenance: "Maintenance", Leasing: "Leasing", Company: "Company", Admin: "Admin" };
const label = (key: string) => APP_SECTIONS.find((s) => s.key === key)?.label ?? key;

/** Admin → User settings: per-person section switches + the existing invoice/estimate abilities. */
export default function UserSettings() {
  const [tab, setTab] = useState<"sections" | "abilities">("sections");
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("tab") === "abilities") setTab("abilities");
  }, []);

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <p className="mb-1 text-[11px] font-medium text-charcoal-400">Admin</p>
      <h1 className="text-xl font-semibold tracking-tight text-charcoal-950">User settings</h1>
      <p className="mt-1 text-sm text-charcoal-500">Turn app sections on or off for each person, and manage invoice and estimate abilities.</p>
      <div className="mb-5 mt-5 flex gap-5 border-b border-sand-200">
        {(
          [
            ["sections", "Sections"],
            ["abilities", "Invoice & estimate abilities"],
          ] as const
        ).map(([k, l]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={`-mb-px border-b-2 pb-2 text-[13px] font-medium ${tab === k ? "border-charcoal-950 text-charcoal-950" : "border-transparent text-charcoal-400 hover:text-charcoal-800"}`}
          >
            {l}
          </button>
        ))}
      </div>
      {tab === "sections" ? <SectionsTab /> : <StaffPermissions />}
    </div>
  );
}

function SectionsTab() {
  const [staff, setStaff] = useState<StaffRow[]>([]);
  const [audit, setAudit] = useState<AuditRow[]>([]);
  const [setupNeeded, setSetupNeeded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState<SectionOverrides>({});
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/admin/user-settings", { cache: "no-store" });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      setStaff(d.staff);
      setAudit(d.audit);
      setSetupNeeded(d.setupNeeded);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const person = staff.find((s) => s.person === selected) ?? null;
  const choose = (s: StaffRow) => {
    setSelected(s.person);
    setDraft({ ...s.overrides });
    setReason("");
    setError("");
    setNotice("");
  };
  const dirty = person ? JSON.stringify(sortKeys(draft)) !== JSON.stringify(sortKeys(person.overrides)) : false;

  const save = async () => {
    if (!person) return;
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/admin/user-settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ person: person.person, overrides: draft, version: person.version, reason }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || "Save failed");
      setNotice(`Saved ${person.person}. Takes effect within about a minute (or on their next page load).`);
      await load();
      setReason("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const visible = staff.filter((s) => `${s.person} ${s.email} ${s.jobTitle}`.toLowerCase().includes(search.toLowerCase()));

  if (loading && !staff.length) return <div className="h-64 animate-pulse rounded-xl bg-sand-50" />;

  return (
    <div>
      {setupNeeded && (
        <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          The user settings table isn&apos;t set up yet. Run <code>supabase/migrations/20260925_staff_section_access.sql</code> in the
          Supabase SQL editor; until then everyone gets their role&apos;s defaults.
        </p>
      )}
      {error && <p className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {notice && <p className="mb-3 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">{notice}</p>}

      <div className="grid gap-5 lg:grid-cols-[280px_1fr]">
        {/* People */}
        <div>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search people" className="mb-2 w-full rounded-lg border border-sand-200 px-3 py-2 text-sm" />
          <ul className="max-h-[70vh] divide-y divide-sand-100 overflow-y-auto rounded-xl border border-sand-200">
            {visible.map((s) => {
              const off = s.denied.filter((k) => roleDefault(APP_SECTIONS.find((x) => x.key === k)!, s.access_role)).length;
              return (
                <li key={s.person}>
                  <button onClick={() => choose(s)} className={`w-full px-3 py-2 text-left hover:bg-sand-50 ${selected === s.person ? "bg-sand-100" : ""}`}>
                    <p className="text-[13px] font-medium text-charcoal-900">{s.person}</p>
                    <p className="truncate text-[11px] text-charcoal-400">
                      {s.access_role}
                      {s.jobTitle ? ` · ${s.jobTitle}` : ""}
                    </p>
                    {off > 0 && <p className="text-[11px] font-medium text-red-600">{off} section{off === 1 ? "" : "s"} switched off</p>}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>

        {/* Sections for the selected person */}
        <div>
          {!person ? (
            <p className="rounded-xl border border-dashed border-sand-300 p-8 text-center text-sm text-charcoal-400">Choose a person to see and change what they can use.</p>
          ) : (
            <div className="rounded-xl border border-sand-200 p-4">
              <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
                <div>
                  <p className="text-[15px] font-semibold text-charcoal-900">{person.person}</p>
                  <p className="text-[12px] text-charcoal-500">
                    {person.email} · role <b>{person.access_role}</b>
                  </p>
                </div>
                <button onClick={() => setDraft({})} className="text-[12px] font-medium text-charcoal-600 hover:text-charcoal-900">
                  Reset all to role defaults
                </button>
              </div>

              {GROUPS.map((g) => {
                const sections = APP_SECTIONS.filter((s) => s.group === g);
                if (!sections.length) return null;
                return (
                  <div key={g} className="mb-4">
                    <p className="mb-1 border-b border-sand-200 pb-1 text-[11px] font-medium text-charcoal-400">{GROUP_LABEL[g]}</p>
                    <div className="divide-y divide-sand-100">
                      {sections.map((s) => (
                        <SectionRow key={s.key} section={s} role={person.access_role} draft={draft} setDraft={setDraft} />
                      ))}
                    </div>
                  </div>
                );
              })}

              <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-sand-200 pt-3">
                <input
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Reason (optional, saved to history)"
                  className="min-w-[240px] flex-1 rounded-lg border border-sand-200 px-3 py-2 text-sm"
                />
                <button onClick={() => setDraft({ ...person.overrides })} disabled={!dirty} className="rounded-lg border border-sand-200 px-3 py-2 text-sm disabled:opacity-40">
                  Undo changes
                </button>
                <button onClick={save} disabled={!dirty || busy || setupNeeded} className="rounded-lg bg-charcoal-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40">
                  {busy ? "Saving…" : "Save"}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* History */}
      {audit.length > 0 && (
        <div className="mt-8">
          <p className="mb-2 text-[13px] font-semibold text-charcoal-800">Recent changes</p>
          <ul className="divide-y divide-sand-100 rounded-xl border border-sand-200 text-[12px]">
            {audit.slice(0, 25).map((a) => (
              <li key={a.id} className="px-3 py-2">
                <b className="text-charcoal-900">{a.person}</b> <span className="text-charcoal-500">by {a.actor} · {new Date(a.created_at).toLocaleString()}</span>
                <span className="ml-2 text-charcoal-700">{describeChange(a.before_overrides, a.after_overrides)}</span>
                {a.reason && <span className="ml-2 italic text-charcoal-500">“{a.reason}”</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function SectionRow({
  section,
  role,
  draft,
  setDraft,
}: {
  section: AppSection;
  role: string;
  draft: SectionOverrides;
  setDraft: (d: SectionOverrides) => void;
}) {
  const def = roleDefault(section, role);
  const effective = sectionAllowed(section, role, draft);
  const adminOnlyForNonAdmin = section.group === "Admin" && role !== "admin";
  const locked = section.alwaysOn || (section.adminLocked && role === "admin") || adminOnlyForNonAdmin;
  const lockNote = section.alwaysOn
    ? "Always on"
    : section.adminLocked && role === "admin"
      ? "Always on for admins"
      : adminOnlyForNonAdmin
        ? "Admins only. Change their role to grant"
        : null;
  const value = draft[section.key] === undefined ? "default" : draft[section.key] ? "on" : "off";

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 py-2">
      <div className="min-w-0 max-w-xl">
        <p className="text-[13px] font-medium text-charcoal-900">
          {section.label}
          {section.ownerOnly && <span className="ml-1.5 text-[11px] font-normal text-charcoal-400">(Craig only)</span>}
        </p>
        <p className="text-[11.5px] text-charcoal-500">{section.description}</p>
      </div>
      <div className="flex items-center gap-3">
        {locked ? (
          <span className="text-[11.5px] text-charcoal-400">{lockNote}</span>
        ) : (
          <select
            value={value}
            onChange={(e) => {
              const next = { ...draft };
              if (e.target.value === "default") delete next[section.key];
              else next[section.key] = e.target.value === "on";
              setDraft(next);
            }}
            className="rounded-lg border border-sand-200 bg-white px-2 py-1.5 text-[12.5px]"
          >
            <option value="default">Role default ({def ? "On" : "Off"})</option>
            <option value="on">On</option>
            <option value="off">Off</option>
          </select>
        )}
        <span
          className={`inline-block w-10 rounded-full px-2 py-0.5 text-center text-[11px] font-semibold ${
            effective ? "bg-green-50 text-green-700" : "bg-red-50 text-red-600"
          }`}
        >
          {effective ? "On" : "Off"}
        </span>
      </div>
    </div>
  );
}

function sortKeys(o: SectionOverrides): SectionOverrides {
  return Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)));
}

function describeChange(before: SectionOverrides, after: SectionOverrides): string {
  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
  const parts: string[] = [];
  const word = (v: boolean | undefined) => (v === undefined ? "default" : v ? "on" : "off");
  for (const k of keys) if (before?.[k] !== after?.[k]) parts.push(`${label(k)}: ${word(before?.[k])} → ${word(after?.[k])}`);
  return parts.join(", ") || "no change";
}
