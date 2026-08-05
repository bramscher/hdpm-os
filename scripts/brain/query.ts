/**
 * Query the company brain from the CLI (hybrid retrieval smoke tool).
 *
 * Usage: npx tsx scripts/brain/query.ts "your question" [limit]
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { searchBrain } from '@/lib/brain/retrieve';

async function main() {
  const question = process.argv[2];
  const limit = Number(process.argv[3] ?? 5);
  if (!question) {
    console.error('Usage: npx tsx scripts/brain/query.ts "your question" [limit]');
    process.exit(1);
  }
  const hits = await searchBrain(question, { limit });
  if (!hits.length) {
    console.log('(no matches)');
    return;
  }
  for (const h of hits) {
    console.log(`\n[${h.kind}] ${h.source_url ?? '(no source)'}  score=${h.score.toFixed(4)}`);
    console.log(h.content.slice(0, 220).replace(/\s+/g, ' '));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
