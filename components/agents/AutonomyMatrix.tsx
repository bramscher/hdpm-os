"use client";

import { useEffect, useMemo, useState } from "react";
import type { AgentConfigRow } from "@/lib/agents/types";
import {
  TIERS,
  TIER_LABEL,
  TIER_COPY,
  levelToTier,
  tierToLevel,
  tierAllowed,
  type AutonomyTier,
} from "@/lib/agents/tiers";
import type { AgentWorkload } from "@/lib/agents/workload";

const LEVEL_LABELS = ["L0 observe", "L1 draft", "L2 act-on-tap", "L3 act+notify", "L4 silent"];
const rowKey = (r: { agent: string; action_type: string }) => `${r.agent}:${r.action_type}`;

/**
 * The Dez autonomy selector — plain-language 3-tier controls (Supervised /
 * Assisted / Autonomous) over each agent action's autonomy_level, grouped by
 * agent. Editing is admin-only; everyone else sees it read-only. Tiers clamp to
 * each action's ceiling, so owner/tenant rows can't leave "Assisted".
 */
export default function AutonomyMatrix({
  initialConfig,
  isAdmin,
  workload = {},
}: {
  initialConfig: AgentConfigRow[];
  isAdmin: boolean;
  workload?: Record<string, AgentWorkload>;
}) {
  const [rows, setRows] = useState<AgentConfigRow[]>(initialConfig);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const kill = rows.find((r) => r.agent === "*");
  const agentRows = rows.filter((r) => r.agent !== "*");

  const byAgent = useMemo(() => {
    const m = new Map<string, AgentConfigRow[]>();
    for (const r of agentRows) {
      if (!m.has(r.agent)) m.set(r.agent, []);
      m.get(r.agent)!.push(r);
    }
    return [...m.entries()];
  }, [agentRows]);

  async function patch(
    row: AgentConfigRow,
    body: { tier?: AutonomyTier; enabled?: boolean; slack_recipients?: string[] }
  ) {
    if (!isAdmin) return;
    const key = rowKey(row);
    setSavingKey(key);
    setError(null);
    // optimistic
    const optimistic: Partial<AgentConfigRow> = {};
    if (body.tier) optimistic.autonomy_level = tierToLevel(body.tier, row.ceiling_level);
    if (body.enabled !== undefined) optimistic.enabled = body.enabled;
    if (body.slack_recipients !== undefined) {
      optimistic.slack_recipients = body.slack_recipients.length > 0 ? body.slack_recipients : null;
    }
    setRows((prev) => prev.map((r) => (rowKey(r) === key ? { ...r, ...optimistic } : r)));
    try {
      const res = await fetch("/api/agents/config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agent: row.agent, action_type: row.action_type, ...body }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setRows((prev) => prev.map((r) => (rowKey(r) === key ? (data.row as AgentConfigRow) : r)));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
      // revert to server truth by reloading
      setRows((prev) => prev.map((r) => (rowKey(r) === key ? row : r)));
    } finally {
      setSavingKey(null);
    }
  }

  return (
    <div className="mb-8">
      {error && (
        <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {error}
        </div>
      )}

      {/* Global kill switch */}
      {kill && (
        <div className="mb-3 flex items-center justify-between rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
          <div>
            <p className="text-sm font-semibold text-charcoal-900">Global kill switch</p>
            <p className="text-xs text-charcoal-500">
              {kill.enabled ? "All agents may act (per their tiers below)." : "All agents halted — nothing acts."}
            </p>
          </div>
          <Toggle
            on={kill.enabled}
            disabled={!isAdmin || savingKey === rowKey(kill)}
            // NB: the kill-switch row is enabled=true when agents may run.
            onChange={(v) => patch(kill, { enabled: v })}
            labelOn="Agents live"
            labelOff="Halted"
          />
        </div>
      )}

      {!isAdmin && (
        <p className="mb-3 text-xs text-charcoal-400">
          Read-only — sign in as an admin to change autonomy.
        </p>
      )}

      <div className="grid gap-3">
        {byAgent.map(([agent, actions]) => (
          <div key={agent} className="rounded-xl border border-sand-200 bg-white shadow-card">
            <div className="flex items-start justify-between gap-3 border-b border-sand-100 px-4 py-2.5">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-charcoal-900">{agent}</p>
                <AgentWorkloadLine w={workload[agent]} />
              </div>
              <p className="shrink-0 text-xs text-charcoal-400">
                {actions.length} action{actions.length === 1 ? "" : "s"} · owner {actions[0]?.owner_role ?? "—"}
              </p>
            </div>
            <div className="divide-y divide-sand-100">
              {actions.map((row) => {
                const key = rowKey(row);
                const current = row.enabled ? levelToTier(row.autonomy_level) : null;
                const saving = savingKey === key;
                return (
                  <div key={key} className="px-4 py-3">
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                      <div className="min-w-[9rem] flex-1">
                        <p className="text-sm font-medium text-charcoal-800">{row.action_type}</p>
                        <p className="text-xs text-charcoal-400">
                          {row.enabled ? LEVEL_LABELS[row.autonomy_level] : "L0 observe (off)"} · ceiling{" "}
                          {LEVEL_LABELS[row.ceiling_level]}
                          {row.ceiling_level <= 2 && (
                            <span className="ml-1 text-charcoal-300">· owner/tenant wall</span>
                          )}
                        </p>
                      </div>

                      <TierControl
                        current={current}
                        ceiling={row.ceiling_level}
                        disabled={!isAdmin || !row.enabled || saving}
                        onPick={(tier) => patch(row, { tier })}
                      />

                      <Toggle
                        on={row.enabled}
                        disabled={!isAdmin || saving}
                        onChange={(v) => patch(row, { enabled: v })}
                        labelOn="On"
                        labelOff="Off"
                      />
                    </div>

                    <RecipientsEditor
                      value={row.slack_recipients}
                      disabled={!isAdmin || saving}
                      onSave={(names) => patch(row, { slack_recipients: names })}
                    />
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <p className="mt-3 text-xs text-charcoal-400">
        Tiers set an autonomy level, always clamped to each action&rsquo;s ceiling — owner- and
        tenant-facing actions stay capped at Assisted (L2) by policy, so &ldquo;Autonomous&rdquo;
        is locked for them.
      </p>
    </div>
  );
}

/** The two compact workload lines under an agent's name. */
function AgentWorkloadLine({ w }: { w?: AgentWorkload }) {
  if (!w) return null;
  const hasPool = w.poolCount != null;
  const hasPending = w.pending > 0;
  if (!hasPool && !hasPending) {
    return <p className="mt-0.5 text-[11px] text-charcoal-300">no backlog</p>;
  }
  return (
    <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px]">
      {hasPool && (
        <span className="text-charcoal-500">
          <span className="font-semibold text-charcoal-700">{w.poolCount}</span> {w.poolLabel}
          {w.poolAging ? <span className="text-charcoal-400"> · {w.poolAging}</span> : null}
        </span>
      )}
      {hasPending && (
        <span className="inline-flex items-center gap-1 text-amber-700">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-amber-500" />
          {w.pending} awaiting
          {w.oldestDays != null ? (
            <span className="text-amber-600"> · oldest {w.oldestDays}d</span>
          ) : null}
        </span>
      )}
    </div>
  );
}

/**
 * Per-action Slack-recipient editor. Comma-separated staff person names; [0] is
 * the interactive/primary recipient. Empty clears the override so the agent falls
 * back to its built-in default list.
 */
function RecipientsEditor({
  value,
  disabled,
  onSave,
}: {
  value: string[] | null;
  disabled: boolean;
  onSave: (names: string[]) => void;
}) {
  const serverText = (value ?? []).join(", ");
  const [text, setText] = useState(serverText);
  useEffect(() => {
    setText(serverText);
  }, [serverText]);

  const parsed = text
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const dirty = parsed.join(", ") !== serverText;

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <span
        className="text-[11px] font-medium uppercase tracking-wide text-charcoal-400"
        title="Who gets DM'd in Slack for this action. Comma-separated staff names; the first is the interactive recipient. Empty = default."
      >
        🔔 Slack
      </span>
      <input
        type="text"
        value={text}
        disabled={disabled}
        onChange={(e) => setText(e.target.value)}
        placeholder="default recipients"
        className="min-w-[14rem] flex-1 rounded-lg border border-sand-200 bg-white px-2 py-1 text-xs text-charcoal-800 placeholder:text-charcoal-300 disabled:opacity-50"
      />
      {dirty && !disabled ? (
        <>
          <button
            type="button"
            onClick={() => onSave(parsed)}
            className="rounded-lg bg-charcoal-900 px-2.5 py-1 text-xs font-medium text-white hover:bg-charcoal-800"
          >
            Save
          </button>
          <button
            type="button"
            onClick={() => setText(serverText)}
            className="rounded-lg px-2 py-1 text-xs text-charcoal-400 hover:text-charcoal-700"
          >
            Cancel
          </button>
        </>
      ) : !value ? (
        <span className="text-[11px] text-charcoal-300">using built-in default</span>
      ) : null}
    </div>
  );
}

function TierControl({
  current,
  ceiling,
  disabled,
  onPick,
}: {
  current: AutonomyTier | null;
  ceiling: number;
  disabled: boolean;
  onPick: (tier: AutonomyTier) => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      <div className="inline-flex items-center gap-1 rounded-xl border border-sand-200 bg-sand-50 p-1">
        {TIERS.map((tier) => {
          const allowed = tierAllowed(tier, ceiling);
          const active = current === tier;
          const clickable = !disabled && allowed;
          return (
            <button
              key={tier}
              type="button"
              disabled={!clickable}
              onClick={() => clickable && onPick(tier)}
              title={
                !allowed
                  ? `${TIER_LABEL[tier]} is above this action's ceiling (policy wall)`
                  : `${TIER_COPY[tier].see} ${TIER_COPY[tier].control}`
              }
              className={[
                "rounded-lg px-2.5 py-1 text-xs font-medium transition-colors",
                active
                  ? "bg-white text-charcoal-900 shadow-card"
                  : allowed
                    ? "text-charcoal-500 hover:text-charcoal-800"
                    : "cursor-not-allowed text-charcoal-300 line-through",
              ].join(" ")}
            >
              {TIER_LABEL[tier]}
            </button>
          );
        })}
      </div>
      {current ? (
        <p className="max-w-[16rem] text-[11px] leading-tight text-charcoal-400">
          {TIER_COPY[current].control}
        </p>
      ) : (
        <p className="max-w-[16rem] text-[11px] leading-tight text-charcoal-400">
          Off — <span className="font-medium">observes only (L0)</span>: watches and logs, but never
          drafts or acts. Turn on to pick a tier.
        </p>
      )}
    </div>
  );
}

function Toggle({
  on,
  disabled,
  onChange,
  labelOn,
  labelOff,
}: {
  on: boolean;
  disabled: boolean;
  onChange: (v: boolean) => void;
  labelOn: string;
  labelOff: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={[
        "inline-flex items-center gap-2 rounded-full border px-1 py-1 text-xs font-medium transition-colors disabled:opacity-50",
        on ? "border-green-200 bg-green-50 text-green-700" : "border-sand-200 bg-sand-50 text-charcoal-400",
      ].join(" ")}
    >
      <span
        className={[
          "inline-block h-4 w-4 rounded-full transition-transform",
          on ? "translate-x-0 bg-green-500" : "bg-charcoal-300",
        ].join(" ")}
      />
      <span className="pr-1.5">{on ? labelOn : labelOff}</span>
    </button>
  );
}
