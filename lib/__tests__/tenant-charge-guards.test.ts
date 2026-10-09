import { describe, it, expect } from 'vitest';
import { chargeProblems, isPlaceholderName, ledgerProblems, ownerCostSignals } from '@/lib/invoice-charge';

describe('placeholder tenant names', () => {
  it('rejects names typed just to get past the required field', () => {
    for (const n of ['na', 'NA', 'n/a', 'N.A.', 'none', 'TBD', 'unknown', '?', '-', 'x', 'tenant']) {
      expect(isPlaceholderName(n)).toBe(true);
    }
  });

  it('accepts real names', () => {
    for (const n of ['Nancy Adams', 'Na Li', 'Tina Bd', 'Jo']) expect(isPlaceholderName(n)).toBe(false);
  });

  it('blocks generating and posting a tenant charge with a placeholder name', () => {
    const inv = { charge_to: 'tenant', tenant_name: 'na', tenant_unit: 'Roda 220', tenant_charge_note: 'x', tenant_charge_reason: 'other' };
    expect(chargeProblems(inv, { finalizing: true }).join(' ')).toMatch(/isn’t a tenant’s name/);
    expect(ledgerProblems(inv).join(' ')).toMatch(/isn’t a tenant’s name/);
    // Drafts may stay incomplete.
    expect(chargeProblems(inv, { finalizing: false })).toEqual([]);
    // Owner charges never care.
    expect(chargeProblems({ ...inv, charge_to: 'owner' }, { finalizing: true })).toEqual([]);
  });
});

describe('owner-cost signals in a tenant-charge note', () => {
  it('flags HDMS-INV-000479 (new tenant reporting old damage)', () => {
    expect(ownerCostSignals('new tenant was following up on old damage before she settles in the place')).toEqual(
      expect.arrayContaining(['pre-existing damage', 'a new tenant', 'move-in'])
    );
  });

  it('flags previous tenants, move-in and wear and tear', () => {
    expect(ownerCostSignals('Damage left by the previous tenant')).toContain('a previous tenant');
    expect(ownerCostSignals('Found at move-in inspection')).toContain('move-in');
    expect(ownerCostSignals('Normal wear and tear on carpet')).toContain('normal wear and tear');
    expect(ownerCostSignals('Blinds were already broken when they moved in')).toContain('damage that was already there');
  });

  it('stays quiet for real tenant damage', () => {
    expect(ownerCostSignals('Tenant punched a hole in the bedroom door; photos on WO')).toEqual([]);
    expect(ownerCostSignals('Tenant lost the keys, lockout fee per lease')).toEqual([]);
    expect(ownerCostSignals('')).toEqual([]);
  });
});
