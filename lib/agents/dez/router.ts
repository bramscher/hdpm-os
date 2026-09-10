/**
 * Dez router (v0) — channel-of-arrival → subagent scope.
 *
 * Phase 1 is read-only Q&A: the "scope" today only labels the answer (the
 * visibility breadcrumb) and marks which lane asked. Scoped/live-data tools
 * per subagent are fast-follow — the router is the seam they'll hang off.
 *
 * The channel→scope map is env-configured so no code change is needed when a
 * channel id is created or moved:
 *   DEZ_CHANNEL_MAP='{"C0MAINT":"maintenance","C0LEASE":"leasing"}'
 * DMs (channel_type 'im') and any unmapped channel fall back to 'general'.
 */

export type DezScope = 'maintenance' | 'leasing' | 'accounting' | 'general';

const SCOPE_LABEL: Record<DezScope, string> = {
  maintenance: 'maintenance',
  leasing: 'leasing / front desk',
  accounting: 'accounting',
  general: 'general',
};

const VALID_SCOPES: ReadonlySet<string> = new Set<DezScope>([
  'maintenance',
  'leasing',
  'accounting',
  'general',
]);

/**
 * Parse DEZ_CHANNEL_MAP (a JSON object of channelId → scope). Malformed JSON
 * or unknown scope values are ignored (degrade to an empty map → 'general').
 * Pure given `raw`; the env read happens in the caller.
 */
export function parseChannelMap(raw: string | undefined): Record<string, DezScope> {
  if (!raw) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
  const out: Record<string, DezScope> = {};
  for (const [channelId, scope] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof scope === 'string' && VALID_SCOPES.has(scope)) {
      out[channelId] = scope as DezScope;
    }
  }
  return out;
}

/**
 * Route a message to a scope. DMs → 'general'; a mapped channel → its scope;
 * anything else → 'general'. `channelMap` defaults to the parsed env map.
 */
export function routeToScope(
  channelId: string | undefined,
  channelType: string | undefined,
  channelMap: Record<string, DezScope> = parseChannelMap(process.env.DEZ_CHANNEL_MAP)
): { scope: DezScope; label: string } {
  if (channelType === 'im' || !channelId) {
    return { scope: 'general', label: SCOPE_LABEL.general };
  }
  const scope = channelMap[channelId] ?? 'general';
  return { scope, label: SCOPE_LABEL[scope] };
}
