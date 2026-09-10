/**
 * Dez autonomy tiers — the plain-language 3-tier control (Supervised / Assisted /
 * Autonomous) layered over the L0–L4 autonomy ladder (lib/agents/config.ts).
 *
 * The tiers are a friendly surface; the ladder + per-action `ceiling_level` are
 * the real policy. A tier maps to a TARGET level, always clamped to the action's
 * ceiling — so owner/tenant-facing actions (ceiling L2) can never leave
 * "Assisted" no matter what tier is picked. That hard wall is the restart plan's
 * permanent rule, enforced here and by the agent_config DB CHECK.
 */

import type { AutonomyLevel } from './types';

export type AutonomyTier = 'supervised' | 'assisted' | 'autonomous';

export const TIERS: AutonomyTier[] = ['supervised', 'assisted', 'autonomous'];

export const TIER_LABEL: Record<AutonomyTier, string> = {
  supervised: 'Supervised',
  assisted: 'Assisted',
  autonomous: 'Autonomous',
};

/** Target autonomy level for a tier, BEFORE clamping to the action's ceiling. */
const TIER_TARGET: Record<AutonomyTier, number> = {
  supervised: 1, // L1 draft — I never act on my own
  assisted: 2, // L2 act-on-tap — I act only when you approve
  autonomous: 4, // as high as the ceiling allows (L3 act+notify / L4 silent)
};

/** Plain-language explainers (the Alven "how you see me / control me" pattern). */
export const TIER_COPY: Record<AutonomyTier, { see: string; control: string }> = {
  supervised: {
    see: 'I draft everything and show it to you first.',
    control: 'Nothing goes out on its own — you review and send.',
  },
  assisted: {
    see: 'I queue routine work as one-tap actions and keep you copied.',
    control: 'I act only when you tap approve.',
  },
  autonomous: {
    see: 'I handle routine work and post what I did — you can undo.',
    control: 'Owner- and tenant-facing messages still wait for you; everything else runs.',
  },
};

export function clampLevel(target: number, ceiling: number): AutonomyLevel {
  return Math.max(0, Math.min(target, ceiling)) as AutonomyLevel;
}

/** The autonomy_level to persist for `tier` on an action with the given ceiling. */
export function tierToLevel(tier: AutonomyTier, ceiling: number): AutonomyLevel {
  return clampLevel(TIER_TARGET[tier], ceiling);
}

/** Derive the tier a stored level displays as (L0/L1→supervised, L2→assisted, L3/L4→autonomous). */
export function levelToTier(level: number): AutonomyTier {
  if (level <= 1) return 'supervised';
  if (level === 2) return 'assisted';
  return 'autonomous';
}

/**
 * Is `tier` reachable under this ceiling? Assisted needs the action to allow L2,
 * Autonomous needs L3+. This is what greys out "Autonomous" on owner/tenant rows
 * (ceiling L2) — the visible hard wall.
 */
export function tierAllowed(tier: AutonomyTier, ceiling: number): boolean {
  if (tier === 'assisted') return ceiling >= 2;
  if (tier === 'autonomous') return ceiling >= 3;
  return true; // supervised is always available
}
