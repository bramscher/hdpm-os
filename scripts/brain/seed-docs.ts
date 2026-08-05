/**
 * Seed the company brain from the repo's own decision/knowledge corpus
 * (Phase 1, Brief 1A). Idempotent — re-runs skip unchanged chunks.
 *
 * Usage:
 *   npx tsx scripts/brain/seed-docs.ts --dry-run   # chunk + report, no writes
 *   npx tsx scripts/brain/seed-docs.ts             # embed + ingest
 *
 * Requires: 20260803_brain_core.sql applied; OPENAI_API_KEY +
 * SUPABASE env in .env.local. Corpus per phase1-briefs.md Brief 1A —
 * docs/soul-brain/konmashi-reference is deliberately excluded (reference IP).
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';
import { chunkMarkdown } from '@/lib/brain/chunk';
import { ingestChunk } from '@/lib/brain/ingest';
import type { ChunkKind } from '@/lib/brain/types';

const ROOT = process.cwd();
const DRY = process.argv.includes('--dry-run');

interface CorpusSpec {
  path: string;           // file or directory (md files, non-recursive dirs get *.md; dirs ending /** recurse)
  kind: ChunkKind;
  recurse?: boolean;
}

const CORPUS: CorpusSpec[] = [
  { path: 'docs/hdpm-os', kind: 'summary', recurse: true },
  { path: 'docs/agent-os/01-questions-and-answers.md', kind: 'fact' }, // decided answers
  { path: 'docs/agent-os', kind: 'summary' },
  { path: 'docs/maintenance-os', kind: 'summary' },
  { path: 'docs/soul-brain/00-README.md', kind: 'summary' },
];

function mdFiles(spec: CorpusSpec): string[] {
  const abs = join(ROOT, spec.path);
  const st = statSync(abs, { throwIfNoEntry: false });
  if (!st) return [];
  if (st.isFile()) return abs.endsWith('.md') ? [abs] : [];
  const out: string[] = [];
  for (const entry of readdirSync(abs, { withFileTypes: true })) {
    const p = join(abs, entry.name);
    if (entry.isDirectory()) {
      if (spec.recurse && !p.includes('konmashi-reference')) {
        out.push(...mdFiles({ ...spec, path: relative(ROOT, p) }));
      }
    } else if (entry.name.endsWith('.md')) {
      out.push(p);
    }
  }
  return out;
}

async function main() {
  const seen = new Set<string>();
  const stats = { files: 0, chunks: 0, add: 0, update: 0, skip: 0, error: 0 };

  for (const spec of CORPUS) {
    for (const file of mdFiles(spec)) {
      const rel = relative(ROOT, file);
      if (seen.has(rel)) continue; // first spec listing a file wins (kind precedence)
      seen.add(rel);
      stats.files++;

      const md = readFileSync(file, 'utf8');
      const title = md.match(/^#\s+(.*)$/m)?.[1]?.trim() ?? rel;
      const chunks = chunkMarkdown(md, title);
      stats.chunks += chunks.length;

      if (DRY) {
        console.log(`${rel}: ${chunks.length} chunks (${spec.kind})`);
        continue;
      }

      for (const c of chunks) {
        const action = await ingestChunk(
          {
            content: c.content,
            kind: spec.kind,
            sourceKey: `${rel}#${c.index}`,
            sourceUrl: rel,
            domain: 'company',
            sensitivity: 'internal',
            author: 'system',
          },
          'seed-docs'
        );
        stats[action]++;
      }
      console.log(`${rel}: ${chunks.length} chunks ingested`);
    }
  }

  console.log(`\n${DRY ? '[dry-run] ' : ''}files=${stats.files} chunks=${stats.chunks}` +
    (DRY ? '' : ` add=${stats.add} update=${stats.update} skip=${stats.skip} error=${stats.error}`));
  if (stats.error > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
