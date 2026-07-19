import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import * as jose from 'jose';
import {
  verifyAppfolioSignature,
  verifySlackSignature,
  verifyZoomWebhook,
  zoomUrlValidationResponse,
} from '../webhook-verify';

// ── Slack v0 signing ──

const SLACK_SECRET = 'test-signing-secret';
const NOW_MS = 1_800_000_000_000; // fixed clock
const TS = String(Math.floor(NOW_MS / 1000));

function slackSig(secret: string, ts: string, body: string): string {
  return 'v0=' + createHmac('sha256', secret).update(`v0:${ts}:${body}`).digest('hex');
}

describe('verifySlackSignature', () => {
  const body = 'payload=%7B%22type%22%3A%22block_actions%22%7D';

  it('accepts a valid signature inside the window', () => {
    expect(
      verifySlackSignature({
        signingSecret: SLACK_SECRET,
        timestamp: TS,
        signature: slackSig(SLACK_SECRET, TS, body),
        rawBody: body,
        now: NOW_MS,
      })
    ).toBe(true);
  });

  it('rejects a wrong secret', () => {
    expect(
      verifySlackSignature({
        signingSecret: SLACK_SECRET,
        timestamp: TS,
        signature: slackSig('other-secret', TS, body),
        rawBody: body,
        now: NOW_MS,
      })
    ).toBe(false);
  });

  it('rejects a stale timestamp (replay window)', () => {
    const staleTs = String(Math.floor(NOW_MS / 1000) - 301);
    expect(
      verifySlackSignature({
        signingSecret: SLACK_SECRET,
        timestamp: staleTs,
        signature: slackSig(SLACK_SECRET, staleTs, body),
        rawBody: body,
        now: NOW_MS,
      })
    ).toBe(false);
  });

  it('rejects missing headers and garbage without throwing', () => {
    expect(
      verifySlackSignature({ signingSecret: SLACK_SECRET, timestamp: null, signature: 'v0=x', rawBody: body, now: NOW_MS })
    ).toBe(false);
    expect(
      verifySlackSignature({ signingSecret: SLACK_SECRET, timestamp: TS, signature: null, rawBody: body, now: NOW_MS })
    ).toBe(false);
    expect(
      verifySlackSignature({ signingSecret: SLACK_SECRET, timestamp: 'not-a-number', signature: 'v0=zz', rawBody: body, now: NOW_MS })
    ).toBe(false);
    expect(
      verifySlackSignature({ signingSecret: SLACK_SECRET, timestamp: TS, signature: 'garbage', rawBody: body, now: NOW_MS })
    ).toBe(false);
  });
});

// ── Zoom ──

describe('verifyZoomWebhook', () => {
  const secret = 'zoom-secret-token';
  const ts = '1800000000';
  const body = '{"event":"phone.sms_received"}';
  const sig = 'v0=' + createHmac('sha256', secret).update(`v0:${ts}:${body}`).digest('hex');

  it('accepts a valid signature', () => {
    expect(verifyZoomWebhook({ secretToken: secret, timestamp: ts, signature: sig, rawBody: body })).toBe(true);
  });

  it('rejects tampered body or wrong secret', () => {
    expect(verifyZoomWebhook({ secretToken: secret, timestamp: ts, signature: sig, rawBody: body + 'x' })).toBe(false);
    expect(verifyZoomWebhook({ secretToken: 'wrong', timestamp: ts, signature: sig, rawBody: body })).toBe(false);
  });

  it('url validation handshake returns the HMAC of plainToken', () => {
    const out = zoomUrlValidationResponse(secret, 'abc123');
    expect(out.plainToken).toBe('abc123');
    expect(out.encryptedToken).toBe(createHmac('sha256', secret).update('abc123').digest('hex'));
  });
});

// ── AppFolio detached JWS ──

describe('verifyAppfolioSignature', () => {
  async function makeSigned(body: string) {
    const { publicKey, privateKey } = await jose.generateKeyPair('PS256');
    const jws = await new jose.CompactSign(new TextEncoder().encode(body))
      .setProtectedHeader({ alg: 'PS256' })
      .sign(privateKey);
    const [header, , signature] = jws.split('.');
    const keySet: jose.CompactVerifyGetKey = async () => publicKey;
    return { detached: `${header}..${signature}`, keySet };
  }

  it('accepts a valid detached JWS', async () => {
    const body = '{"topic":"work_orders","resource_id":"123"}';
    const { detached, keySet } = await makeSigned(body);
    expect(await verifyAppfolioSignature(Buffer.from(body), detached, keySet)).toBe(true);
  });

  it('rejects a tampered body', async () => {
    const body = '{"topic":"work_orders","resource_id":"123"}';
    const { detached, keySet } = await makeSigned(body);
    expect(await verifyAppfolioSignature(Buffer.from(body + ' '), detached, keySet)).toBe(false);
  });

  it('rejects a malformed header (no ".." separator)', async () => {
    const body = '{}';
    const { keySet } = await makeSigned(body);
    expect(await verifyAppfolioSignature(Buffer.from(body), 'onlyonepart', keySet)).toBe(false);
  });
});
