import { describe, it, expect } from 'vitest';
import { tierToLevel, levelToTier, tierAllowed, clampLevel } from '../tiers';

describe('autonomy tiers', () => {
  it('maps tiers to their target levels under a permissive ceiling', () => {
    expect(tierToLevel('supervised', 4)).toBe(1); // L1 draft
    expect(tierToLevel('assisted', 4)).toBe(2); // L2 act-on-tap
    expect(tierToLevel('autonomous', 4)).toBe(4); // as high as allowed
  });

  it('clamps every tier to the action ceiling — the hard wall', () => {
    // Owner/tenant-facing actions cap at L2: Autonomous cannot exceed Assisted.
    expect(tierToLevel('autonomous', 2)).toBe(2);
    expect(tierToLevel('assisted', 2)).toBe(2);
    expect(tierToLevel('supervised', 2)).toBe(1);
    // Vendor actions cap at L3: Autonomous lands on L3 (act+notify), not L4.
    expect(tierToLevel('autonomous', 3)).toBe(3);
  });

  it('greys out tiers above the ceiling', () => {
    // ceiling 2 (owner/tenant): supervised + assisted allowed, autonomous not.
    expect(tierAllowed('supervised', 2)).toBe(true);
    expect(tierAllowed('assisted', 2)).toBe(true);
    expect(tierAllowed('autonomous', 2)).toBe(false);
    // ceiling 3 (vendor): autonomous becomes reachable.
    expect(tierAllowed('autonomous', 3)).toBe(true);
    // ceiling 1: only supervised.
    expect(tierAllowed('assisted', 1)).toBe(false);
    expect(tierAllowed('supervised', 1)).toBe(true);
  });

  it('derives the displayed tier from a stored level', () => {
    expect(levelToTier(0)).toBe('supervised');
    expect(levelToTier(1)).toBe('supervised');
    expect(levelToTier(2)).toBe('assisted');
    expect(levelToTier(3)).toBe('autonomous');
    expect(levelToTier(4)).toBe('autonomous');
  });

  it('clampLevel never goes below 0 or above ceiling', () => {
    expect(clampLevel(4, 2)).toBe(2);
    expect(clampLevel(-1, 4)).toBe(0);
    expect(clampLevel(2, 4)).toBe(2);
  });
});
