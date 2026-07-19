/**
 * Shared inbound-webhook signature verification (Agent-OS Brief B).
 *
 * - AppFolio: detached-payload JWS (PS256) against their remote JWKS —
 *   extracted from the previously-duplicated implementations in
 *   app/api/webhooks/appfolio/route.ts and appfolio-leads/route.ts.
 * - Slack: v0 HMAC-SHA256 request signing with a replay window (wired by the
 *   Brief C Slack interaction route).
 * - Zoom: x-zm-signature HMAC + the endpoint.url_validation handshake (wired
 *   by the Brief for SMS day-close).
 *
 * All verifiers take the RAW request body — read it with
 * Buffer.from(await request.arrayBuffer()) BEFORE any JSON parsing, or the
 * signature will never match.
 */

import * as jose from 'jose';
import { createHmac, timingSafeEqual } from 'node:crypto';

// ============================================
// AppFolio — detached JWS (PS256)
// ============================================

const APPFOLIO_JWKS = jose.createRemoteJWKSet(
  new URL('https://api.appfolio.com/.well-known/jwks.json')
);

/**
 * Verify AppFolio's X-JWS-Signature (detached payload format:
 * BASE64URL(header)..BASE64URL(signature)). The full compact JWS is
 * reconstructed by base64url-encoding the raw body between the two parts.
 * `keySet` is injectable for tests; defaults to AppFolio's remote JWKS.
 */
export async function verifyAppfolioSignature(
  rawBody: Buffer | Uint8Array,
  jwsSignature: string,
  keySet: jose.CompactVerifyGetKey = APPFOLIO_JWKS
): Promise<boolean> {
  try {
    const [encodedHeader, encodedSignature] = jwsSignature.split('..');
    if (!encodedHeader || !encodedSignature) {
      console.error('[Webhook] Malformed X-JWS-Signature header');
      return false;
    }

    // Base64url-encode the raw body (unpadded, per RFC 4648)
    const encodedPayload = Buffer.from(rawBody).toString('base64url').replaceAll('=', '');
    const message = `${encodedHeader}.${encodedPayload}.${encodedSignature}`;

    await jose.compactVerify(message, keySet);
    return true;
  } catch (error) {
    console.error('[Webhook] Signature verification failed:', error);
    return false;
  }
}

// ============================================
// Slack — v0 request signing
// ============================================

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

/**
 * Slack request verification: signature = 'v0=' + HMAC_SHA256(secret,
 * 'v0:<timestamp>:<rawBody>'), rejected outside the replay window.
 * Pure given `now` (ms since epoch).
 */
export function verifySlackSignature(input: {
  signingSecret: string;
  timestamp: string | null;
  signature: string | null;
  rawBody: string;
  now?: number;
  toleranceSec?: number;
}): boolean {
  const { signingSecret, timestamp, signature, rawBody } = input;
  if (!signingSecret || !timestamp || !signature) return false;

  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return false;
  const nowSec = (input.now ?? Date.now()) / 1000;
  if (Math.abs(nowSec - ts) > (input.toleranceSec ?? 300)) return false;

  const expected =
    'v0=' + createHmac('sha256', signingSecret).update(`v0:${timestamp}:${rawBody}`).digest('hex');
  return safeEqual(expected, signature);
}

// ============================================
// Zoom — x-zm-signature + URL validation handshake
// ============================================

/**
 * Zoom webhook verification: x-zm-signature = 'v0=' + HMAC_SHA256(secretToken,
 * 'v0:<x-zm-request-timestamp>:<rawBody>').
 */
export function verifyZoomWebhook(input: {
  secretToken: string;
  timestamp: string | null;
  signature: string | null;
  rawBody: string;
}): boolean {
  const { secretToken, timestamp, signature, rawBody } = input;
  if (!secretToken || !timestamp || !signature) return false;
  const expected =
    'v0=' + createHmac('sha256', secretToken).update(`v0:${timestamp}:${rawBody}`).digest('hex');
  return safeEqual(expected, signature);
}

/**
 * Zoom's endpoint.url_validation challenge: respond with the plainToken and
 * its HMAC under the secret token.
 */
export function zoomUrlValidationResponse(
  secretToken: string,
  plainToken: string
): { plainToken: string; encryptedToken: string } {
  return {
    plainToken,
    encryptedToken: createHmac('sha256', secretToken).update(plainToken).digest('hex'),
  };
}
