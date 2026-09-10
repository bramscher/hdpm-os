/**
 * Agent-OS autonomy matrix — reads + guard logic over agent_config.
 *
 * The matrix is rows, not code: changing autonomy is a row update. The
 * ('*','*') row is the global kill switch (enabled=false halts everything).
 * Pure helpers below are the single place promotion/ceiling/quiet-hours
 * semantics live, so they unit-test without a database.
 */

import { getSupabaseAdmin } from '@/lib/supabase';
import { resolveStaffByPersonOrEmail } from './staff';
import type { AgentConfigRow, AutonomyLevel, StaffRow } from './types';

export async function getAgentConfig(
  agent: string,
  actionType: string
): Promise<AgentConfigRow | null> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('agent_config')
    .select('*')
    .eq('agent', agent)
    .eq('action_type', actionType)
    .maybeSingle();
  if (error) {
    console.error('[Agents] agent_config read failed:', error.message);
    return null;
  }
  return (data as AgentConfigRow) ?? null;
}

export async function listAgentConfig(): Promise<AgentConfigRow[]> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('agent_config')
    .select('*')
    .order('agent')
    .order('action_type');
  if (error) {
    console.error('[Agents] agent_config list failed:', error.message);
    return [];
  }
  return (data ?? []) as AgentConfigRow[];
}

/**
 * Resolve the Slack recipients for an agent action, in order. Uses the config
 * row's slack_recipients when set (non-empty), otherwise the caller's built-in
 * fallback list — so an unconfigured agent behaves exactly as before. Names are
 * resolved through the staff table and only those with a slack_user_id are
 * returned. Order is preserved: element [0] is the primary/interactive recipient
 * for cards that distinguish primary from read-only copies.
 */
export async function getNotifyRecipients(
  agent: string,
  actionType: string,
  fallbackNames: string[]
): Promise<StaffRow[]> {
  const row = await getAgentConfig(agent, actionType);
  const names =
    row?.slack_recipients && row.slack_recipients.length > 0 ? row.slack_recipients : fallbackNames;
  const resolved = await Promise.all(names.map((n) => resolveStaffByPersonOrEmail(n)));
  return resolved.filter((s): s is StaffRow => Boolean(s?.slack_user_id));
}

/** The global kill switch: row ('*','*') with enabled=false halts all agents. */
export async function isGloballyKilled(): Promise<boolean> {
  const row = await getAgentConfig('*', '*');
  return row ? !row.enabled : false;
}

// ============================================
// Pure guard logic (unit-tested)
// ============================================

/** Missing or disabled config → L0 (observe only, no action). */
export function effectiveLevel(row: AgentConfigRow | null): AutonomyLevel {
  if (!row || !row.enabled) return 0;
  return row.autonomy_level;
}

/** Promotion may never propose past the ceiling (Q2 decisions). */
export function maxPromotableLevel(row: AgentConfigRow): AutonomyLevel {
  return Math.min(row.autonomy_level + 1, row.ceiling_level) as AutonomyLevel;
}

/**
 * quiet_hours format: 'HH:MM-HH:MM' (24h, local server time). A range that
 * crosses midnight ('21:00-07:00') wraps. Null/unparseable → never quiet.
 */
export function isWithinQuietHours(row: AgentConfigRow, now: Date): boolean {
  if (!row.quiet_hours) return false;
  const m = row.quiet_hours.match(/^(\d{2}):(\d{2})-(\d{2}):(\d{2})/);
  if (!m) return false;
  const minutes = now.getHours() * 60 + now.getMinutes();
  const start = Number(m[1]) * 60 + Number(m[2]);
  const end = Number(m[3]) * 60 + Number(m[4]);
  if (start === end) return false;
  return start < end
    ? minutes >= start && minutes < end
    : minutes >= start || minutes < end;
}
