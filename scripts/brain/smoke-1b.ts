/**
 * Brief 1B live smoke — chat path (askRAG with brain merge) + standalone think().
 * Run: npx tsx --env-file=.env.local scripts/brain/smoke-1b.ts
 */
import { askRAG } from '../../lib/rag';
import { think } from '../../lib/brain/think';

async function main() {
  console.log('=== 1B smoke 1/2: chat path (askRAG, brain merged) ===');
  const q1 = 'Why did we decide not to adopt GBrain as our company brain?';
  const r1 = await askRAG(q1);
  console.log('\nANSWER:\n', r1.answer);
  console.log('\nSOURCES:');
  for (const s of r1.sources) {
    console.log(` ${s.icon ?? ''} [${s.type}] ${s.title} — ${s.url}`);
  }
  const brainCount = r1.sources.filter((s) => s.type === 'brain').length;
  console.log(`\nbrain sources: ${brainCount}/${r1.sources.length}`);

  console.log('\n=== 1B smoke 2/2: standalone think() gap probe ===');
  const q2 =
    'What did we decide about our QuickBooks integration, and what is the monthly cost of the AppFolio Write API?';
  const r2 = await think(q2);
  console.log('\nANSWER:\n', r2.answer);
  console.log(`\nmatches: ${r2.matches.length}, sources: ${r2.sources.length}`);
  console.log('has gap section:', r2.answer.includes("What I don't know"));
}

main().catch((e) => {
  console.error('SMOKE FAILED:', e);
  process.exit(1);
});
