"use client";

import { useCallback, useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import StaffPermissions from "../staff-permissions/staff-permissions";
import {
  APP_SECTIONS,
  ROLE_LABELS,
  codeRoleDefault,
  roleDefault,
  sectionAllowed,
  type AppSection,
  type RoleDefaultOverrides,
  type SectionOverrides,
} from "@/lib/access/sections";
import { ACCESS_ROLES } from "@/lib/roles";

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

interface RoleChange {
  id: number;
  person: string;
  actor: string;
  from_role: string | null;
  to_role: string;
  reason: string | null;
  created_at: string;
}
interface Payload {
  setupNeeded: boolean;
  rolesSetupNeeded: boolean;
  staff: StaffRow[];
  audit: AuditRow[];
  roleDefaults: Record<string, { overrides: SectionOverrides; version: number }>;
  roleChanges: RoleChange[];
}

const roleName = (r: string) => ROLE_LABELS[r as keyof typeof ROLE_LABELS] ?? r;
const toRoleOverrides = (p: Payload | null): RoleDefaultOverrides =>
  Object.fromEntries(Object.entries(p?.roleDefaults ?? {}).map(([r, v]) => [r, v.overrides]));

/** Shared loader for the Sections and Roles tabs. */
function useUserSettings() {
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/admin/user-settings", { cache: "no-store" });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      setData(d);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  return { data, loading, error, setError, load };
}

const GROUPS = ["main", "Maintenance", "Leasing", "Company", "Admin"] as const;
const GROUP_LABEL: Record<string, string> = { main: "General", Maintenance: "Maintenance", Leasing: "Leasing", Company: "Company", Admin: "Admin" };
const label = (key: string) => APP_SECTIONS.find((s) => s.key === key)?.label ?? key;

/** Admin → User settings: per-person section switches + the existing invoice/estimate abilities. */
export default function UserSettings() {
  const [tab, setTab] = useState<"sections" | "roles" | "abilities">("sections");
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("tab");
    if (t === "abilities" || t === "roles") setTab(t);
  }, []);

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <p className="mb-1 text-[11px] font-medium text-charcoal-400">Admin</p>
      <h1 className="text-xl font-semibold tracking-tight text-charcoal-950">User settings</h1>
      <p className="mt-1 text-sm text-charcoal-500">
        Give each person a role, set what each role can use, then fine-tune individuals. Invoice and estimate abilities live in their own tab.
      </p>
      <div className="mb-5 mt-5 flex gap-5 border-b border-sand-200">
        {(
          [
            ["sections", "People"],
            ["roles", "Roles"],
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
      {tab === "sections" ? <SectionsTab /> : tab === "roles" ? <RolesTab /> : <StaffPermissions />}
    </div>
  );
}

function SectionsTab() {
  const { data: session } = useSession();
  const { data, loading, error, setError, load } = useUserSettings();
  const staff = data?.staff ?? [];
  const audit = data?.audit ?? [];
  const setupNeeded = data?.setupNeeded ?? false;
  const roleOv = toRoleOverrides(data);
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState<SectionOverrides>({});
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [roleDraft, setRoleDraft] = useState("");

  const person = staff.find((s) => s.person === selected) ?? null;
  const isSelf = !!person?.email && person.email.toLowerCase() === session?.user?.email?.toLowerCase();
  const choose = (s: StaffRow) => {
    setSelected(s.person);
    setRoleDraft(s.access_role);
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

  const changeRole = async () => {
    if (!person || roleDraft === person.access_role) return;
    if (!window.confirm(`Change ${person.person}'s role from ${roleName(person.access_role)} to ${roleName(roleDraft)}? Their default sections and abilities change with it.`)) return;
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/admin/user-settings/role", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ person: person.person, access_role: roleDraft, reason }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || "Role change failed");
      setNotice(`${person.person} is now ${roleName(roleDraft)}. Takes effect within about a minute.`);
      await load();
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
              const off = s.denied.filter((k) => roleDefault(APP_SECTIONS.find((x) => x.key === k)!, s.access_role, roleOv)).length;
              return (
                <li key={s.person}>
                  <button onClick={() => choose(s)} className={`w-full px-3 py-2 text-left hover:bg-sand-50 ${selected === s.person ? "bg-sand-100" : ""}`}>
                    <p className="text-[13px] font-medium text-charcoal-900">{s.person}</p>
                    <p className="truncate text-[11px] text-charcoal-400">
                      {roleName(s.access_role)}
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
                  <p className="text-[12px] text-charcoal-500">{person.email}</p>
                  <div className="mt-2 flex items-center gap-2 text-[12.5px]">
                    <span className="text-charcoal-500">Role</span>
                    <select
                      value={roleDraft}
                      onChange={(e) => setRoleDraft(e.target.value)}
                      disabled={isSelf || busy}
                      className="rounded-lg border border-sand-200 bg-white px-2 py-1.5 disabled:opacity-60"
                      title={isSelf ? "Ask another admin to change your own role" : undefined}
                    >
                      {ACCESS_ROLES.map((r) => (
                        <option key={r} value={r}>{roleName(r)}</option>
                      ))}
                    </select>
                    {roleDraft !== person.access_role && (
                      <button onClick={changeRole} disabled={busy} className="rounded-lg bg-charcoal-900 px-3 py-1.5 font-medium text-white disabled:opacity-40">
                        Change role
                      </button>
                    )}
                    {isSelf && <span className="text-[11px] text-charcoal-400">You can&apos;t change your own role</span>}
                  </div>
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
                        <SectionRow key={s.key} section={s} role={person.access_role} draft={draft} setDraft={setDraft} roleOv={roleOv} />
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

      {/* Role changes */}
      {(data?.roleChanges ?? []).length > 0 && (
        <div className="mt-8">
          <p className="mb-2 text-[13px] font-semibold text-charcoal-800">Recent role changes</p>
          <ul className="divide-y divide-sand-100 rounded-xl border border-sand-200 text-[12px]">
            {data!.roleChanges.slice(0, 15).map((c) => (
              <li key={c.id} className="px-3 py-2">
                <b className="text-charcoal-900">{c.person}</b>: {roleName(c.from_role ?? "?")} → <b>{roleName(c.to_role)}</b>{" "}
                <span className="text-charcoal-500">by {c.actor} · {new Date(c.created_at).toLocaleString()}</span>
                {c.reason && <span className="ml-2 italic text-charcoal-500">“{c.reason}”</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

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

/** Roles tab: edit each role's default sections; overview grid of every role. */
function RolesTab() {
  const { data, loading, error, setError, load } = useUserSettings();
  const roles = ACCESS_ROLES.filter((r) => r !== "admin");
  const [role, setRole] = useState<string>("pm");
  const [draft, setDraft] = useState<SectionOverrides>({});
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const saved = data?.roleDefaults?.[role]?.overrides ?? {};
  const version = data?.roleDefaults?.[role]?.version ?? 0;
  const roleOv = toRoleOverrides(data);

  useEffect(() => {
    setDraft({ ...(data?.roleDefaults?.[role]?.overrides ?? {}) });
    setReason("");
  }, [role, data]);

  const norm = (o: SectionOverrides) => JSON.stringify(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)));
  const dirty = norm(draft) !== norm(saved);
  const nonAdmin = APP_SECTIONS.filter((s) => s.group !== "Admin" && !s.alwaysOn);
  const peopleInRole = (data?.staff ?? []).filter((s) => s.access_role === role);

  const setOn = (s: AppSection, on: boolean) => {
    const next = { ...draft };
    if (on === codeRoleDefault(s, role)) delete next[s.key]; // back to built-in
    else next[s.key] = on;
    setDraft(next);
  };

  const save = async () => {
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/admin/user-settings/roles", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role, overrides: draft, version, reason }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || "Save failed");
      setNotice(`Saved ${roleName(role)} defaults. Applies to everyone with that role (except their personal overrides) within about a minute.`);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (loading && !data) return <div className="h-64 animate-pulse rounded-xl bg-sand-50" />;

  return (
    <div>
      {data?.rolesSetupNeeded && (
        <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          Run <code>supabase/migrations/20260925b_role_section_defaults.sql</code> in the Supabase SQL editor to edit role defaults.
          Until then the built-in defaults below apply.
        </p>
      )}
      {error && <p className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {notice && <p className="mb-3 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">{notice}</p>}

      <div className="mb-4 flex flex-wrap gap-1.5">
        {roles.map((r) => (
          <button
            key={r}
            onClick={() => setRole(r)}
            className={`rounded-lg border px-3 py-1.5 text-[12.5px] font-medium ${role === r ? "border-charcoal-900 bg-charcoal-900 text-white" : "border-sand-200 bg-white text-charcoal-700 hover:bg-sand-50"}`}
          >
            {roleName(r)}
          </button>
        ))}
        <span className="ml-2 self-center text-[12px] text-charcoal-400">Admin always has every section.</span>
      </div>

      <div className="grid gap-5 lg:grid-cols-[1fr_400px]">
        <div className="rounded-xl border border-sand-200 p-4">
          <p className="mb-1 text-[15px] font-semibold text-charcoal-900">{roleName(role)} defaults</p>
          <p className="mb-3 text-[12px] text-charcoal-500">
            {peopleInRole.length ? `Applies to ${peopleInRole.map((p) => p.person).join(", ")}.` : "Nobody has this role yet."} Personal
            overrides on the People tab still win.
          </p>
          {GROUPS.filter((g) => g !== "Admin").map((g) => {
            const sections = nonAdmin.filter((s) => s.group === g);
            if (!sections.length) return null;
            return (
              <div key={g} className="mb-3">
                <p className="mb-1 border-b border-sand-200 pb-1 text-[11px] font-medium text-charcoal-400">{GROUP_LABEL[g]}</p>
                {sections.map((s) => {
                  const on = draft[s.key] ?? codeRoleDefault(s, role);
                  const changed = draft[s.key] !== undefined;
                  return (
                    <label key={s.key} className="flex cursor-pointer items-center justify-between gap-3 py-1.5">
                      <span>
                        <span className="text-[13px] font-medium text-charcoal-900">{s.label}</span>
                        {changed && <span className="ml-1.5 rounded bg-amber-100 px-1 text-[10px] font-semibold text-amber-800">edited</span>}
                        <span className="block text-[11.5px] text-charcoal-500">{s.description}</span>
                      </span>
                      <input type="checkbox" checked={on} onChange={(e) => setOn(s, e.target.checked)} className="h-4 w-4" />
                    </label>
                  );
                })}
              </div>
            );
          })}
          <p className="mb-3 text-[11.5px] text-charcoal-400">Dashboard is always on. Admin sections need the Admin role.</p>
          <div className="flex flex-wrap items-center gap-2 border-t border-sand-200 pt-3">
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Reason (optional, saved to history)"
              className="min-w-[220px] flex-1 rounded-lg border border-sand-200 px-3 py-2 text-sm"
            />
            <button onClick={() => setDraft({})} className="rounded-lg border border-sand-200 px-3 py-2 text-sm">
              Reset to built-in
            </button>
            <button onClick={save} disabled={!dirty || busy || data?.rolesSetupNeeded} className="rounded-lg bg-charcoal-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40">
              {busy ? "Saving…" : "Save role"}
            </button>
          </div>
        </div>

        {/* Overview grid */}
        <div className="overflow-x-auto rounded-xl border border-sand-200 p-3">
          <p className="mb-2 text-[12.5px] font-semibold text-charcoal-800">All roles at a glance</p>
          <table className="text-[11px]">
            <thead>
              <tr>
                <th />
                {ACCESS_ROLES.map((r) => (
                  <th key={r} className="px-0.5 pb-1 align-bottom font-medium text-charcoal-500">
                    <span className="inline-block max-w-[18px] [writing-mode:vertical-rl] rotate-180 whitespace-nowrap">{roleName(r)}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {APP_SECTIONS.map((s) => (
                <tr key={s.key} className="border-t border-sand-100">
                  <td className="whitespace-nowrap py-0.5 pr-2 text-charcoal-700">{s.label}</td>
                  {ACCESS_ROLES.map((r) => {
                    const on = sectionAllowed(s, r, {}, r === role ? { ...roleOv, [r]: draft } : roleOv);
                    return (
                      <td key={r} className="px-0.5 text-center">
                        <span className={on ? "text-green-700" : "text-charcoal-200"}>{on ? "●" : "·"}</span>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function SectionRow({
  section,
  role,
  draft,
  setDraft,
  roleOv,
}: {
  section: AppSection;
  role: string;
  draft: SectionOverrides;
  setDraft: (d: SectionOverrides) => void;
  roleOv: RoleDefaultOverrides;
}) {
  const def = roleDefault(section, role, roleOv);
  const effective = sectionAllowed(section, role, draft, roleOv);
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
            <option value="default">{roleName(role)} default ({def ? "On" : "Off"})</option>
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
