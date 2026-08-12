import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { MOVE_OUT_TEMPLATE } from '../templates/move-out';
import { resolveDueRule, instantiateSteps, advanceStep } from '../engine';

const TRACKS = ['TENANT', 'OWNER', 'ADVERTISING', 'VACANCY', 'CLOSE OUT'];
// Roles the template may reference — all present on the HDPM roster seats.
const ROLES = new Set(['move_out', 'pm', 'listing', 'finance_closer']);

describe('MOVE_OUT_TEMPLATE — shape', () => {
  it('is the yellow move-out process, active, tenant-scoped', () => {
    expect(MOVE_OUT_TEMPLATE.key).toBe('move-out');
    expect(MOVE_OUT_TEMPLATE.color).toBe('yellow'); // process identity (A.0)
    expect(MOVE_OUT_TEMPLATE.org_id).toBe('hdpm');
    expect(MOVE_OUT_TEMPLATE.active).toBe(true);
  });

  it('covers all five parallel tracks (App A.1)', () => {
    const seen = new Set(MOVE_OUT_TEMPLATE.steps.map((s) => s.track));
    expect([...seen].sort()).toEqual([...TRACKS].sort());
  });

  it('every step has a non-empty label and a known seat_role', () => {
    for (const s of MOVE_OUT_TEMPLATE.steps) {
      expect(s.label.trim().length).toBeGreaterThan(0);
      expect(s.seat_role && ROLES.has(s.seat_role)).toBe(true);
    }
  });

  it('every due_rule parses (only the `created` anchor is wired today)', () => {
    const anchors = { created: new Date('2026-08-11T00:00:00Z') };
    for (const s of MOVE_OUT_TEMPLATE.steps) {
      if (s.due_rule) expect(resolveDueRule(s.due_rule, anchors)).not.toBeNull();
    }
  });

  it('is tap-driven in v1 (no external_match until PR-A8 verify-by-read)', () => {
    for (const s of MOVE_OUT_TEMPLATE.steps) {
      expect(s.requires ?? 'tap').toBe('tap');
      expect(s.external_match ?? null).toBeNull();
    }
  });
});

const seatFor = (role: string | null | undefined) => (role ? `seat-${role}` : null);
const instantiate = () =>
  instantiateSteps(MOVE_OUT_TEMPLATE, {
    jacketId: 'j-move-out',
    anchors: { created: new Date('2026-08-11T00:00:00Z') },
    resolveSeat: seatFor,
    newId: (o) => `step-${o}`,
  });

describe('MOVE_OUT_TEMPLATE — engine behavior', () => {
  it('activates exactly one step per track at once (5 parallel tracks)', () => {
    const steps = instantiate();
    const active = steps.filter((s) => s.state === 'active');
    expect(active).toHaveLength(TRACKS.length);
    // One active step per distinct track, each the lowest ordinal of its track.
    expect(new Set(active.map((s) => s.track))).toEqual(new Set(TRACKS));
    for (const a of active) {
      const first = steps.filter((s) => s.track === a.track).sort((x, y) => x.ordinal - y.ordinal)[0];
      expect(a.id).toBe(first.id);
    }
  });

  it('resolves seat_role → seat_id via the injected resolver', () => {
    const steps = instantiate();
    const tenantLead = steps.find((s) => s.track === 'TENANT' && s.state === 'active')!;
    expect(tenantLead.seat_id).toBe('seat-move_out');
  });

  it('advances a track independently (completing TENANT lead only touches TENANT)', () => {
    const steps = instantiate();
    const tenantLead = steps.find((s) => s.track === 'TENANT' && s.state === 'active')!;
    const r = advanceStep(steps, tenantLead.id, { actor: 'agent:move_out', at: '2026-08-11T10:00:00Z' });

    // The next TENANT step activated; the completed one is done.
    expect(r.steps.find((s) => s.id === tenantLead.id)!.state).toBe('done');
    const activated = r.steps.find((s) => s.id === r.activatedStepId)!;
    expect(activated.track).toBe('TENANT');

    // Every other track still has exactly its original single active step.
    for (const t of TRACKS.filter((t) => t !== 'TENANT')) {
      expect(r.steps.filter((s) => s.track === t && s.state === 'active')).toHaveLength(1);
    }
    expect(r.jacket_done).toBe(false);
  });
});

describe('MOVE_OUT_TEMPLATE — seed parity', () => {
  it('the committed SQL seed embeds exactly the constant steps (no drift)', () => {
    const seedPath = fileURLToPath(
      new URL('../../../../../supabase/seeds/habu_hdpm_move_out_template.sql', import.meta.url)
    );
    const sql = readFileSync(seedPath, 'utf8');
    const m = /'(\[[\s\S]*?\])'::jsonb/.exec(sql);
    expect(m).not.toBeNull();
    const seedSteps = JSON.parse(m![1]);
    // Round-trip the constant to drop `undefined` optionals, matching JSONB.
    expect(seedSteps).toEqual(JSON.parse(JSON.stringify(MOVE_OUT_TEMPLATE.steps)));
  });
});
