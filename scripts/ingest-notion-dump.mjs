/**
 * Ingest a dump of Notion SOP pages into knowledge_chunks (source_type notion_sop).
 *
 * Used for the initial SOP load (pages exported via the Notion connector).
 * Ongoing weekly refresh is handled server-side by /api/sync/knowledge once
 * NOTION_API_KEY is configured — this script and that route write the same
 * shape, so they are interchangeable.
 *
 * Usage: node scripts/ingest-notion-dump.mjs <dump-dir>
 *   dump-dir contains one JSON file per page: { title, url, content }
 */

import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';
import fs from 'fs';
import path from 'path';
import { config } from 'dotenv';

config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const CHUNK_SIZE = 1000;
const CHUNK_OVERLAP = 200;

function chunkText(text) {
  const chunks = [];
  const clean = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  let start = 0;
  while (start < clean.length) {
    let end = start + CHUNK_SIZE;
    if (end < clean.length) {
      const p = clean.lastIndexOf('\n\n', end);
      if (p > start + CHUNK_SIZE / 2) end = p;
      else {
        const s = clean.lastIndexOf('. ', end);
        if (s > start + CHUNK_SIZE / 2) end = s + 1;
      }
    }
    const chunk = clean.slice(start, end).trim();
    if (chunk.length > 0) chunks.push(chunk);
    if (end >= clean.length) break;
    start = Math.max(end - CHUNK_OVERLAP, start + 1);
  }
  return chunks;
}

/** Strip Notion-export markup down to plain readable text. */
function cleanContent(raw) {
  return raw
    .replace(/<mention-page[^>]*>([\s\S]*?)<\/mention-page>/gi, '$1')
    .replace(/<mention-page[^>]*\/>/gi, '')
    .replace(/<page url="[^"]*">([\s\S]*?)<\/page>/gi, '$1')
    .replace(/<callout[^>]*>/gi, '\n> ')
    .replace(/<\/callout>/gi, '\n')
    .replace(/<table[^>]*>/gi, '\n')
    .replace(/<\/table>/gi, '\n')
    .replace(/<tr>/gi, '')
    .replace(/<\/tr>/gi, '\n')
    .replace(/<td>/gi, '')
    .replace(/<\/td>/gi, ' | ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\\\|/g, '|')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function embedBatch(texts) {
  const out = [];
  for (let i = 0; i < texts.length; i += 96) {
    const batch = texts.slice(i, i + 96).map((t) => (t.length > 8000 ? t.slice(0, 8000) : t));
    const res = await openai.embeddings.create({ model: 'text-embedding-3-small', input: batch });
    for (const d of res.data) out.push(d.embedding);
  }
  return out;
}

async function main() {
  const dir = process.argv[2];
  if (!dir || !fs.existsSync(dir)) {
    console.error('Usage: node scripts/ingest-notion-dump.mjs <dump-dir>');
    process.exit(1);
  }

  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
  console.log(`Ingesting ${files.length} Notion SOP pages...`);

  let pages = 0;
  let totalChunks = 0;
  let failed = 0;

  for (const file of files) {
    try {
      const { title, url, content } = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
      const text = cleanContent(content);
      if (!text || text.length < 40) {
        console.log(`  ⏭ ${title} — too short, skipped`);
        continue;
      }

      const chunks = chunkText(`${title}\n\n${text}`);
      const embeddings = await embedBatch(chunks);

      const { error: delErr } = await supabase
        .from('knowledge_chunks')
        .delete()
        .eq('source_type', 'notion_sop')
        .eq('source_url', url);
      if (delErr) throw new Error(delErr.message);

      const rows = chunks.map((c, i) => ({
        content: c,
        embedding: embeddings[i],
        source_type: 'notion_sop',
        source_title: title,
        source_url: url,
        source_section: chunks.length > 1 ? `part ${i + 1}/${chunks.length}` : null,
      }));
      const { error: insErr } = await supabase.from('knowledge_chunks').insert(rows);
      if (insErr) throw new Error(insErr.message);

      pages++;
      totalChunks += rows.length;
      console.log(`  ✓ ${title} (${rows.length} chunks)`);
    } catch (err) {
      failed++;
      console.error(`  ✗ ${file}:`, err.message);
    }
  }

  console.log(`\nDone: ${pages} pages, ${totalChunks} chunks, ${failed} failed.`);
}

main();
