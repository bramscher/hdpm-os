/**
 * Brain golden-question eval (Brief 1D — the Phase 1 acceptance gate).
 *
 * 10 questions the brain MUST answer with the expected citation, plus 3
 * known-unknown gap probes that MUST produce a "What I don't know" section
 * (the anti-hallucination check). Results are written to
 * docs/eval/brain-golden.md.
 *
 * Run: npx tsx --env-file=.env.local scripts/brain/golden-questions.ts
 */
import { writeFileSync, mkdirSync } from 'fs';
import { think } from '../../lib/brain/think';

interface Golden {
  q: string;
  /** PASS if any cited source path contains ANY of these substrings. */
  cite: string[];
}

const GOLDEN: Golden[] = [
  {
    q: 'Why did we decide not to adopt GBrain as our company brain?',
    cite: ['04-gbrain'],
  },
  {
    q: 'What is the monthly cost of the AppFolio Write API and what did we decide about buying it?',
    cite: ['agent-os', 'appfolio'],
  },
  {
    q: 'What are the autonomy ceilings for owner-facing and tenant-facing sends by agents?',
    cite: ['questions-and-answers', '08-security', 'master-plan'],
  },
  {
    q: 'What did we decide about Ringer — can we embed it in our product, and why or why not?',
    cite: ['05-ringer'],
  },
  {
    q: 'Which system is the system of record for financial and transactional property records?',
    cite: ['02-product-vision', '01-current-repository', 'master-plan'],
  },
  {
    q: 'What is the phase order of the HDPM-OS implementation roadmap?',
    cite: ['10-implementation-roadmap', '00-README', '11-executive'],
  },
  {
    q: 'What are the Maintenance OS tripwires and what do they watch for?',
    cite: ['maintenance-os'],
  },
  {
    q: 'Where does the company brain live architecturally — which database and what kind of tables?',
    cite: ['04-gbrain', 'soul-brain'],
  },
  {
    q: 'Who receives the Morning Action Card and what does it contain?',
    cite: ['master-plan', 'agent-os'],
  },
  {
    q: 'Are agents ever allowed to write to the AppFolio ledger?',
    cite: ['questions-and-answers', '08-security', 'master-plan'],
  },
];

/** Questions the corpus cannot answer — the gap section MUST appear. */
const GAP_PROBES: string[] = [
  'Which bank does HDPM use for its trust accounts?',
  "What is HDPM's employee PTO accrual policy?",
  'How much did HDPM spend on marketing in Q2 2026?',
];

const GAP_RE = /what i don'?t know/i;

async function main() {
  const rows: string[] = [];
  let citePass = 0;
  let gapPass = 0;

  console.log('=== Golden questions (10) ===');
  for (const g of GOLDEN) {
    const r = await think(g.q, { limit: 10, maxTokens: 800 });
    const cited = r.sources.map((s) => s.url);
    const hit = cited.find((u) => g.cite.some((c) => u.includes(c)));
    const pass = Boolean(hit);
    if (pass) citePass++;
    const status = pass ? '✅' : '❌';
    console.log(`${status} ${g.q}`);
    rows.push(
      `| ${status} | ${g.q} | ${hit ? hit.split('/').slice(-1)[0] : `none of: ${g.cite.join(', ')}`} | ${r.matches.length} |`
    );
  }

  console.log('\n=== Gap probes (3) ===');
  const gapRows: string[] = [];
  for (const q of GAP_PROBES) {
    const r = await think(q, { limit: 8, maxTokens: 500 });
    const pass = GAP_RE.test(r.answer);
    if (pass) gapPass++;
    const status = pass ? '✅' : '❌';
    console.log(`${status} ${q}`);
    gapRows.push(`| ${status} | ${q} | ${pass ? 'gap section present' : 'NO gap section'} |`);
  }

  const stamp = new Date().toISOString().slice(0, 10);
  const md = `# Brain golden-question eval

_Phase 1 acceptance gate (Brief 1D). Generated ${stamp} by
\`scripts/brain/golden-questions.ts\` against the live brain corpus._

**Result: ${citePass}/10 citation checks · ${gapPass}/3 gap probes**

## Citation checks

A question passes when the synthesized answer cites at least one source from
the document(s) where the decision is actually recorded.

| Pass | Question | Matched citation | Matches |
|---|---|---|---|
${rows.join('\n')}

## Known-unknown gap probes

A probe passes when the brain admits ignorance (a "What I don't know"
section) instead of fabricating an answer.

| Pass | Question | Behavior |
|---|---|---|
${gapRows.join('\n')}

## Re-running

\`\`\`sh
npx tsx --env-file=.env.local scripts/brain/golden-questions.ts
\`\`\`

Update the expected citations in the script when the corpus moves.
`;

  mkdirSync('docs/eval', { recursive: true });
  writeFileSync('docs/eval/brain-golden.md', md);
  console.log(`\nTotals: ${citePass}/10 citations, ${gapPass}/3 gaps → docs/eval/brain-golden.md`);
}

main().catch((e) => {
  console.error('EVAL FAILED:', e);
  process.exit(1);
});
