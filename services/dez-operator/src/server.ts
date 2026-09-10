/**
 * hdpm-dez-operator — the AppFolio operator worker.
 *
 * A tiny signed HTTP service that Dez (hdpm-os on Vercel) calls to run
 * web-app-only AppFolio actions the v0 API can't do (form-merge). Stateless re:
 * our DB — it drives AppFolio and returns a result; Dez owns proposals, gating,
 * audit, and Slack. Deployed to Railway; never part of the Next/Vercel build.
 *
 * Kill switches honored here: OPERATOR_ENABLED=false → 503 (hard off at the
 * service). Dez also gates via agent_config + the global kill switch before it
 * ever calls this.
 */

import Fastify from 'fastify';
import { verifySignature } from './sign.js';
import { withPage, shutdown } from './appfolio-auth.js';
import { runDepositToHold, type MergeResult } from './flows/deposit-to-hold.js';

const app = Fastify({ logger: true, bodyLimit: 1_000_000 });
const SECRET = process.env.OPERATOR_SHARED_SECRET ?? '';
const ENABLED = process.env.OPERATOR_ENABLED !== 'false';

// Read the raw body so the HMAC covers the exact bytes.
app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
  done(null, body);
});

app.get('/healthz', async () => ({ ok: true, enabled: ENABLED }));

app.post('/operator/form-merge', async (request, reply) => {
  if (!ENABLED) return reply.code(503).send({ error: 'operator disabled' });

  const rawBody = typeof request.body === 'string' ? request.body : '';
  const ok = verifySignature({
    secret: SECRET,
    timestamp: request.headers['x-dez-timestamp'] as string | undefined,
    signature: request.headers['x-dez-signature'] as string | undefined,
    rawBody,
  });
  if (!ok) return reply.code(401).send({ error: 'invalid signature' });

  let payload: { template?: string; tenantQuery?: string; mode?: 'prepare' | 'send'; requestId?: string };
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return reply.code(400).send({ error: 'bad json' });
  }

  const { template, tenantQuery, mode = 'prepare' } = payload;
  if (!tenantQuery) return reply.code(400).send({ error: 'tenantQuery required' });
  if (template && template !== 'deposit-to-hold') {
    return reply.code(400).send({ error: `unknown template: ${template}` });
  }

  try {
    const result: MergeResult = await withPage((page) => runDepositToHold(page, { tenantQuery, mode }));
    const code = result.status === 'prepared' ? 200 : 422;
    return reply.code(code).send(result);
  } catch (err) {
    request.log.error(err);
    return reply.code(500).send({ status: 'error', error: err instanceof Error ? err.message : String(err) });
  }
});

const port = Number(process.env.PORT ?? 8080);
app.listen({ port, host: '0.0.0.0' }).then(() => {
  app.log.info(`dez-operator listening on ${port} (enabled=${ENABLED})`);
});

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, async () => {
    await shutdown();
    await app.close();
    process.exit(0);
  });
}
