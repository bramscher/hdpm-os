import { describe, it, expect, beforeAll } from 'vitest';
import { encryptField, decryptField, last4, isEncrypted } from '../crypto';

// A fixed, non-secret 32-byte test key (base64). Set before importing usage.
const TEST_KEY = Buffer.alloc(32, 7).toString('base64');

beforeAll(() => {
  process.env.REFERRAL_FIELD_KEY = TEST_KEY;
});

describe('referral field crypto — AES-256-GCM round trip', () => {
  it('round-trips a tax id', () => {
    const tin = '123-45-6789';
    const ct = encryptField(tin);
    expect(ct).not.toContain(tin); // no cleartext leak
    expect(isEncrypted(ct)).toBe(true);
    expect(decryptField(ct)).toBe(tin);
  });

  it('produces a distinct ciphertext each call (random IV) but decrypts the same', () => {
    const a = encryptField('same-value');
    const b = encryptField('same-value');
    expect(a).not.toBe(b);
    expect(decryptField(a)).toBe('same-value');
    expect(decryptField(b)).toBe('same-value');
  });

  it('handles empty and unicode strings', () => {
    expect(decryptField(encryptField(''))).toBe('');
    expect(decryptField(encryptField('café ünïcode 🔐'))).toBe('café ünïcode 🔐');
  });

  it('rejects a tampered ciphertext (GCM auth failure)', () => {
    const ct = encryptField('secret');
    const parts = ct.split('.');
    // flip a byte in the ciphertext segment
    const flipped = Buffer.from(parts[3], 'base64');
    flipped[0] ^= 0xff;
    parts[3] = flipped.toString('base64');
    expect(() => decryptField(parts.join('.'))).toThrow();
  });

  it('rejects a malformed payload', () => {
    expect(() => decryptField('not-a-real-ciphertext')).toThrow(/Malformed/);
    expect(() => decryptField('v2.a.b.c')).toThrow(/Malformed/);
  });

  it('accepts a hex-encoded key of 32 bytes', () => {
    const prev = process.env.REFERRAL_FIELD_KEY;
    process.env.REFERRAL_FIELD_KEY = Buffer.alloc(32, 9).toString('hex');
    try {
      expect(decryptField(encryptField('hex-key-value'))).toBe('hex-key-value');
    } finally {
      process.env.REFERRAL_FIELD_KEY = prev;
    }
  });

  it('throws a clear error when the key is the wrong length', () => {
    const prev = process.env.REFERRAL_FIELD_KEY;
    process.env.REFERRAL_FIELD_KEY = Buffer.alloc(16, 1).toString('base64'); // 16 bytes
    try {
      expect(() => encryptField('x')).toThrow(/32 bytes/);
    } finally {
      process.env.REFERRAL_FIELD_KEY = prev;
    }
  });

  it('throws when the key env is missing', () => {
    const prev = process.env.REFERRAL_FIELD_KEY;
    delete process.env.REFERRAL_FIELD_KEY;
    try {
      expect(() => encryptField('x')).toThrow(/REFERRAL_FIELD_KEY is not set/);
    } finally {
      process.env.REFERRAL_FIELD_KEY = prev;
    }
  });
});

describe('last4', () => {
  it('keeps the last four digits of a formatted number', () => {
    expect(last4('123-45-6789')).toBe('6789');
    expect(last4('****1234')).toBe('1234');
  });
  it('falls back to raw tail when fewer than four digits', () => {
    expect(last4('ab')).toBe('ab');
  });
});
