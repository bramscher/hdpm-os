#!/usr/bin/env node
/**
 * Mint a per-service token (Phase 0, Brief C).
 *
 * Usage: node scripts/mint-service-token.mjs <name> <scope[,scope...]>
 *   e.g. node scripts/mint-service-token.mjs hdpm-web intake
 *        node scripts/mint-service-token.mjs agent-service agents
 *
 * Prints the plaintext token ONCE (give it to the calling service) and the
 * INSERT statement to run in the Supabase SQL editor (stores only the hash).
 */

import { randomBytes, createHash } from 'crypto';

const [name, scopesArg] = process.argv.slice(2);
if (!name || !scopesArg) {
  console.error('Usage: node scripts/mint-service-token.mjs <name> <scope[,scope...]>');
  process.exit(1);
}
const VALID = ['agents', 'intake'];
const scopes = scopesArg.split(',').map((s) => s.trim());
const bad = scopes.filter((s) => !VALID.includes(s));
if (bad.length) {
  console.error(`Unknown scope(s): ${bad.join(', ')} (valid: ${VALID.join(', ')})`);
  process.exit(1);
}

const token = `hdpm_${name.replace(/[^a-z0-9]/gi, '')}_${randomBytes(24).toString('base64url')}`;
const hash = createHash('sha256').update(token).digest('hex');
const scopesSql = `'{${scopes.join(',')}}'`;

console.log(`\nToken for '${name}' (save now — not stored anywhere):\n\n  ${token}\n`);
console.log('Run in the Supabase SQL editor:\n');
console.log(
  `INSERT INTO service_token (name, token_hash, scopes) VALUES ('${name}', '${hash}', ${scopesSql})\n` +
  `  ON CONFLICT (name) DO UPDATE SET token_hash = EXCLUDED.token_hash, scopes = EXCLUDED.scopes, active = true;\n`
);
