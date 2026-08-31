/**
 * Shared HMAC contract between Dez (hdpm-os) and this worker.
 *
 * Signature = 'v1=' + HMAC_SHA256(secret, `${timestamp}.${rawBody}`), rejected
 * outside a 300s replay window. Mirrors the Slack-style verification in
 * hdpm-os `lib/webhook-verify.ts`. The worker verifies; the Dez client signs
 * the same way (`lib/agents/dez/operator.ts`). Keep the two in lockstep.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

const TOLERANCE_SEC = 300;

export function signBody(secret: string, timestamp: string, rawBody: string): string {
  return 'v1=' + createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
}

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

/** Verify a signed request. Pure given `now` (ms). */
export function verifySignature(input: {
  secret: string;
  timestamp: string | null | undefined;
  signature: string | null | undefined;
  rawBody: string;
  now?: number;
}): boolean {
  const { secret, timestamp, signature, rawBody } = input;
  if (!secret || !timestamp || !signature) return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return false;
  const nowSec = (input.now ?? Date.now()) / 1000;
  if (Math.abs(nowSec - ts) > TOLERANCE_SEC) return false;
  return safeEqual(signBody(secret, timestamp, rawBody), signature);
}
