/**
 * Field-level encryption for referral partner PII (Batch 0).
 *
 * The referral portal is the FIRST place this codebase stores sensitive
 * external-party data at rest (tax IDs, payout details). AES-256-GCM with a
 * single symmetric key from env `REFERRAL_FIELD_KEY`.
 *
 * Rules (plan §2):
 * - Only *_encrypted columns hold ciphertext; cleartext is limited to *_last4.
 * - Decrypt happens ONLY on the admin service-role path — never a referrer
 *   route. Prefer minimization: full payout details live in QuickBooks, not
 *   here; store last4 when the full value isn't needed.
 *
 * Wire format: `v1.<iv_b64>.<tag_b64>.<ciphertext_b64>` (GCM: 12-byte IV,
 * 16-byte auth tag). Tampering fails the GCM auth check → decrypt throws.
 *
 * Key: `REFERRAL_FIELD_KEY` must decode to exactly 32 bytes — accepts base64
 * (44 chars) or hex (64 chars). Generate one with:
 *   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const VERSION = 'v1';
const IV_BYTES = 12;
const KEY_BYTES = 32;

/** Read + validate the 32-byte key from env. Lazy so tests can set it. */
function getKey(): Buffer {
  const raw = process.env.REFERRAL_FIELD_KEY;
  if (!raw) {
    throw new Error(
      'REFERRAL_FIELD_KEY is not set. Referral PII encryption requires a 32-byte key ' +
        '(base64 or hex). Generate: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"'
    );
  }
  // hex (64 chars, hex alphabet) else base64.
  const buf =
    /^[0-9a-fA-F]{64}$/.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64');
  if (buf.length !== KEY_BYTES) {
    throw new Error(
      `REFERRAL_FIELD_KEY must decode to ${KEY_BYTES} bytes, got ${buf.length}. ` +
        'Provide a base64 or hex encoding of exactly 32 random bytes.'
    );
  }
  return buf;
}

/** Encrypt a cleartext string → `v1.<iv>.<tag>.<ct>`. */
export function encryptField(plaintext: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', getKey(), iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${VERSION}.${iv.toString('base64')}.${tag.toString('base64')}.${ct.toString('base64')}`;
}

/** Decrypt a `v1.<iv>.<tag>.<ct>` payload. Throws on tamper or malformed input. */
export function decryptField(payload: string): string {
  const parts = payload.split('.');
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new Error('Malformed ciphertext: expected v1.<iv>.<tag>.<ct>');
  }
  const [, ivB64, tagB64, ctB64] = parts;
  const decipher = createDecipheriv('aes-256-gcm', getKey(), Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(ctB64, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

/** Last 4 chars of a value (digits kept as-is), for the *_last4 columns. */
export function last4(value: string): string {
  const digits = value.replace(/\D/g, '');
  const src = digits.length >= 4 ? digits : value;
  return src.slice(-4);
}

/** True if a value looks like our ciphertext (vs accidental cleartext). */
export function isEncrypted(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.startsWith(`${VERSION}.`);
}
