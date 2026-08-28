import { describe, it, expect } from 'vitest';
import { slugFromName, randomSuffix, makeReferralCode, isValidReferralCode } from '../codes';

describe('referral codes', () => {
  it('slugs a name to up to 6 uppercase letters', () => {
    expect(slugFromName('Jane Smith')).toBe('JANESM');
    expect(slugFromName('Al')).toBe('AL');
  });

  it('falls back to REF when a name has no letters', () => {
    expect(slugFromName('123 456')).toBe('REF');
    expect(slugFromName('')).toBe('REF');
  });

  it('builds a valid code shape', () => {
    const code = makeReferralCode('Jane Smith', () => 0.5);
    expect(code.startsWith('JANESM-')).toBe(true);
    expect(isValidReferralCode(code)).toBe(true);
  });

  it('suffix avoids look-alike characters (no I, O, 0, 1, L, U)', () => {
    // sweep the alphabet deterministically
    for (let i = 0; i < 30; i++) {
      const s = randomSuffix(() => i / 30);
      expect(s).not.toMatch(/[IOLU01]/);
      expect(s).toHaveLength(4);
    }
  });

  it('validates code format', () => {
    expect(isValidReferralCode('JANESM-2K3Q')).toBe(true);
    expect(isValidReferralCode('jane-2k3q')).toBe(false); // lowercase
    expect(isValidReferralCode('JANE-2K3')).toBe(false); // short suffix
    expect(isValidReferralCode('JANE_2K3Q')).toBe(false); // wrong sep
  });
});
