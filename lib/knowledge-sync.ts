/**
 * Knowledge-base sync for the HDPM Knowledge Chat.
 *
 * Two corpora live in knowledge_chunks:
 *   - ors_90     : Oregon ORS Chapter 90, fetched from oregon.public.law
 *   - notion_sop : every SOP under the Notion "Process Documentation Hub"
 *
 * Both refresh weekly via /api/sync/knowledge. Refresh is replace-per-source:
 * a section/page's chunks are deleted and reinserted only after its fresh
 * content was fetched successfully, so a failed fetch never loses data.
 * Notion sync requires NOTION_API_KEY (internal integration with the
 * Knowledge Base page shared to it); without it that step reports skipped.
 */

import OpenAI from 'openai';
import { getSupabaseAdmin } from '@/lib/supabase';

const EMBEDDING_MODEL = 'text-embedding-3-small';
const CHUNK_SIZE = 1000;
const CHUNK_OVERLAP = 200;

function getOpenAI(): OpenAI {
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

// ── Shared helpers ──

export function chunkText(text: string, chunkSize = CHUNK_SIZE, overlap = CHUNK_OVERLAP): string[] {
  const chunks: string[] = [];
  const clean = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  let start = 0;
  while (start < clean.length) {
    let end = start + chunkSize;
    if (end < clean.length) {
      const paragraphBreak = clean.lastIndexOf('\n\n', end);
      if (paragraphBreak > start + chunkSize / 2) {
        end = paragraphBreak;
      } else {
        const sentenceBreak = clean.lastIndexOf('. ', end);
        if (sentenceBreak > start + chunkSize / 2) end = sentenceBreak + 1;
      }
    }
    const chunk = clean.slice(start, end).trim();
    if (chunk.length > 0) chunks.push(chunk);
    if (end >= clean.length) break;
    start = Math.max(end - overlap, start + 1);
  }
  return chunks;
}

/** Embed many texts in batches (the API takes arrays — far faster than 1-by-1). */
export async function embedBatch(texts: string[]): Promise<number[][]> {
  const openai = getOpenAI();
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += 96) {
    const batch = texts.slice(i, i + 96).map((t) => (t.length > 8000 ? t.slice(0, 8000) : t));
    const res = await openai.embeddings.create({ model: EMBEDDING_MODEL, input: batch });
    for (const d of res.data) out.push(d.embedding);
  }
  return out;
}

// ============================================
// ORS 90 refresh
// ============================================

/** Complete ORS Chapter 90 section list (mirrors scripts/fetch-ors90-complete.mjs). */
export const ALL_ORS_90_SECTIONS = [
  '90.100', '90.105', '90.110', '90.112', '90.113', '90.115', '90.120',
  '90.125', '90.130', '90.135', '90.140', '90.145', '90.147', '90.148',
  '90.150', '90.155', '90.160',
  '90.220', '90.222', '90.228', '90.230', '90.243', '90.245', '90.250',
  '90.255', '90.260', '90.262', '90.263', '90.265', '90.275',
  '90.295', '90.297', '90.300', '90.302',
  '90.303', '90.304', '90.305', '90.306', '90.308', '90.310', '90.315',
  '90.316', '90.317', '90.318', '90.320', '90.321', '90.322', '90.323', '90.324',
  '90.325', '90.340',
  '90.355', '90.358', '90.360', '90.365', '90.367', '90.368', '90.370',
  '90.372', '90.375', '90.380', '90.385', '90.388', '90.390',
  '90.391', '90.392', '90.394', '90.395', '90.396', '90.398', '90.401',
  '90.403', '90.405', '90.410', '90.412', '90.414', '90.417', '90.420',
  '90.425', '90.427', '90.429', '90.430', '90.435', '90.440',
  '90.445', '90.449', '90.453', '90.456', '90.459',
  '90.460', '90.462', '90.465', '90.472', '90.475', '90.485', '90.490', '90.493',
  '90.505', '90.510', '90.512', '90.514', '90.516', '90.518', '90.525',
  '90.527', '90.528', '90.530', '90.545', '90.550', '90.555',
  '90.560', '90.562', '90.564', '90.566', '90.568', '90.570', '90.572',
  '90.574', '90.576', '90.578', '90.580', '90.582', '90.584',
  '90.600', '90.605', '90.610', '90.620', '90.630', '90.632', '90.634', '90.640',
  '90.643', '90.645', '90.650', '90.655', '90.660', '90.671',
  '90.675', '90.680',
  '90.710', '90.720',
  '90.725', '90.727', '90.729', '90.730', '90.732', '90.734', '90.736', '90.738',
  '90.740', '90.750', '90.755', '90.765',
  '90.767', '90.769', '90.771', '90.775',
  '90.800', '90.840', '90.842', '90.844', '90.846', '90.848', '90.849', '90.850',
  '90.860', '90.865', '90.870', '90.875',
];

interface OrsSection {
  section: string;
  title: string;
  content: string;
  url: string;
}

async function fetchOrsSection(sectionNumber: string): Promise<OrsSection | null> {
  const url = `https://oregon.public.law/statutes/ors_${sectionNumber}`;
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const html = await response.text();

    const nameMatch = html.match(/<span[^>]*id=['"]name['"][^>]*>([\s\S]*?)<\/span>/i);
    const titleTagMatch = html.match(/<title>ORS\s*[\d.]+\s*[-–—]\s*([^<]+)<\/title>/i);
    let title = nameMatch ? nameMatch[1].trim() : titleTagMatch ? titleTagMatch[1].trim() : `Section ${sectionNumber}`;
    title = title.replace(/<[^>]+>/g, '').trim();

    const articleMatch = html.match(/<article[^>]*>([\s\S]*?)<\/article>/i);
    if (!articleMatch) return { section: sectionNumber, title, content: '', url };

    let content = articleMatch[1]
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '')
      .replace(/<aside[^>]*>[\s\S]*?<\/aside>/gi, '')
      .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '')
      .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, '')
      .replace(/Text\s+Annotations[\s\S]*/gi, '')
      .replace(/Notes\s+of\s+Decisions[\s\S]*/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&ldquo;/g, '"')
      .replace(/&rdquo;/g, '"')
      .replace(/&lsquo;/g, "'")
      .replace(/&rsquo;/g, "'")
      .replace(/&mdash;/g, '—')
      .replace(/&ndash;/g, '–')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&#\d+;/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    content = content.replace(new RegExp(`^ORS\\s*${sectionNumber.replace('.', '\\.')}\\s*[-–—]?\\s*`, 'i'), '');
    return { section: sectionNumber, title, content, url };
  } catch (err) {
    console.error(`[knowledge-sync] ORS ${sectionNumber} fetch failed:`, err instanceof Error ? err.message : err);
    return null;
  }
}

export interface CorpusSyncResult {
  updated: number;
  failed: number;
  skipped: number;
  chunks: number;
}

export async function syncOrs90(): Promise<CorpusSyncResult> {
  const supabase = getSupabaseAdmin();
  const result: CorpusSyncResult = { updated: 0, failed: 0, skipped: 0, chunks: 0 };

  // Fetch with modest concurrency — oregon.public.law is a public service.
  const CONCURRENCY = 6;
  const sections: (OrsSection | null)[] = [];
  for (let i = 0; i < ALL_ORS_90_SECTIONS.length; i += CONCURRENCY) {
    const batch = ALL_ORS_90_SECTIONS.slice(i, i + CONCURRENCY);
    const fetched = await Promise.all(batch.map(fetchOrsSection));
    sections.push(...fetched);
  }

  const good = sections.filter((s): s is OrsSection => Boolean(s && s.content && s.content.length >= 20));
  result.failed = sections.filter((s) => s === null).length;
  result.skipped = sections.length - good.length - result.failed;

  // One chunk per section (sections comfortably fit one embedding), matching
  // the original ingestion shape so section_lookup keeps working.
  const texts = good.map((s) => {
    const full = `ORS ${s.section} - ${s.title}\n\n${s.content}`;
    return full.length > 8000 ? `${full.slice(0, 8000)}...` : full;
  });
  const embeddings = await embedBatch(texts);

  for (let i = 0; i < good.length; i++) {
    const s = good[i];
    const { error: delErr } = await supabase
      .from('knowledge_chunks')
      .delete()
      .eq('source_type', 'ors_90')
      .eq('source_section', s.section);
    if (delErr) {
      console.error(`[knowledge-sync] ORS ${s.section} delete failed:`, delErr.message);
      result.failed++;
      continue;
    }
    const { error: insErr } = await supabase.from('knowledge_chunks').insert({
      content: texts[i],
      embedding: embeddings[i],
      source_type: 'ors_90',
      source_title: `ORS ${s.section} - ${s.title}`,
      source_url: s.url,
      source_section: s.section,
    });
    if (insErr) {
      console.error(`[knowledge-sync] ORS ${s.section} insert failed:`, insErr.message);
      result.failed++;
    } else {
      result.updated++;
      result.chunks++;
    }
  }

  return result;
}

// ============================================
// ORS 90 new-section watch
// ============================================

/**
 * The knowledge base scans a FIXED list (ALL_ORS_90_SECTIONS). Amendments to
 * those sections are caught weekly, but a brand-new section number the
 * legislature adds is invisible until someone extends the list. This generates
 * plausible not-yet-known section numbers to probe: the next few numbers after
 * each known section (inserted sections) and a window past the current maximum
 * (appended sections). Pure.
 */
export function candidateNewOrsSections(
  known: string[] = ALL_ORS_90_SECTIONS,
  opts: { gapAhead?: number; tail?: number } = {}
): string[] {
  // Politeness vs. reach: +1 after each section catches an inserted number (a
  // multi-section insertion is caught over successive monthly runs as each new
  // number joins the list); tail 24 catches appended sections in one pass.
  const gapAhead = opts.gapAhead ?? 1;
  const tail = opts.tail ?? 24;
  const toKey = (s: string) => Math.round(parseFloat(s) * 1000); // '90.300' -> 90300
  const fmt = (n: number) => (n / 1000).toFixed(3); // 90300 -> '90.300'
  const set = new Set(known);
  const nums = known.map(toKey);
  const max = Math.max(...nums);
  const cands = new Set<string>();
  for (const n of nums) {
    for (let d = 1; d <= gapAhead; d++) cands.add(fmt(n + d));
  }
  for (let d = 1; d <= tail; d++) cands.add(fmt(max + d));
  for (const k of set) cands.delete(k); // never re-probe a known section
  return [...cands].sort();
}

export interface OrsWatchResult {
  probed: number;
  found: { section: string; title: string; url: string }[];
}

/**
 * Probe candidate section numbers on oregon.public.law; a real page (article
 * with substantive text, not a "not found") that isn't in our list is a
 * possible new statute the knowledge base is missing. Best-effort net — a
 * false positive just prompts a human to check.
 */
export async function detectNewOrsSections(
  opts: { gapAhead?: number; tail?: number } = {}
): Promise<OrsWatchResult> {
  const candidates = candidateNewOrsSections(ALL_ORS_90_SECTIONS, opts);
  const found: { section: string; title: string; url: string }[] = [];
  const CONCURRENCY = 6;
  for (let i = 0; i < candidates.length; i += CONCURRENCY) {
    const batch = candidates.slice(i, i + CONCURRENCY);
    const fetched = await Promise.all(batch.map(fetchOrsSection));
    for (const s of fetched) {
      if (s && s.content.length >= 40 && !/not found/i.test(s.title)) {
        found.push({ section: s.section, title: s.title, url: s.url });
      }
    }
  }
  return { probed: candidates.length, found };
}

// ============================================
// Notion SOP refresh (requires NOTION_API_KEY)
// ============================================

/** Notion "Process Documentation Hub" — the SOP library root. */
const NOTION_SOP_HUB_ID = '2f30262b-5145-8163-ae04-c4b16fe8620a';
const NOTION_VERSION = '2022-06-28';

interface NotionPageRef {
  id: string;
  title: string;
  url: string;
}

async function notionApi(path: string): Promise<Record<string, unknown>> {
  const res = await fetch(`https://api.notion.com/v1${path}`, {
    headers: {
      Authorization: `Bearer ${process.env.NOTION_API_KEY}`,
      'Notion-Version': NOTION_VERSION,
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Notion API ${res.status}: ${body.slice(0, 200)}`);
  }
  return (await res.json()) as Record<string, unknown>;
}

async function listAllBlocks(blockId: string): Promise<Record<string, unknown>[]> {
  const blocks: Record<string, unknown>[] = [];
  let cursor: string | undefined;
  do {
    const qs = cursor ? `?start_cursor=${cursor}&page_size=100` : '?page_size=100';
    const data = await notionApi(`/blocks/${blockId}/children${qs}`);
    blocks.push(...((data.results as Record<string, unknown>[]) ?? []));
    cursor = data.has_more ? (data.next_cursor as string) : undefined;
  } while (cursor);
  return blocks;
}

function richTextToPlain(rich: unknown): string {
  if (!Array.isArray(rich)) return '';
  return rich.map((r) => (r as { plain_text?: string }).plain_text ?? '').join('');
}

/** Flatten a page's blocks to plain text; collects nested child pages. */
async function blocksToText(
  blockId: string,
  childPages: NotionPageRef[],
  depth = 0
): Promise<string> {
  if (depth > 4) return '';
  const blocks = await listAllBlocks(blockId);
  const lines: string[] = [];

  for (const block of blocks) {
    const type = block.type as string;
    const payload = block[type] as Record<string, unknown> | undefined;

    if (type === 'child_page') {
      const id = block.id as string;
      childPages.push({
        id,
        title: (payload?.title as string) ?? 'Untitled',
        url: `https://app.notion.com/p/${id.replace(/-/g, '')}`,
      });
      continue;
    }
    if (type === 'child_database' || type === 'unsupported') continue;

    let text = '';
    if (payload && 'rich_text' in payload) text = richTextToPlain(payload.rich_text);
    else if (type === 'table_row') {
      const cells = (payload?.cells as unknown[][]) ?? [];
      text = cells.map((c) => richTextToPlain(c)).join(' | ');
    }

    if (type?.startsWith('heading')) text = `\n## ${text}`;
    else if (type === 'bulleted_list_item' || type === 'numbered_list_item') text = `- ${text}`;
    else if (type === 'to_do') text = `- [ ] ${text}`;
    else if (type === 'quote' || type === 'callout') text = `> ${text}`;

    if (text.trim()) lines.push(text);

    // Recurse into containers (toggles, columns, nested lists…)
    if (block.has_children && type !== 'child_page' && type !== 'child_database') {
      const nested = await blocksToText(block.id as string, childPages, depth + 1);
      if (nested.trim()) lines.push(nested);
    }
  }

  return lines.join('\n');
}

/** Walk the SOP hub, ingest every page found (hub itself + all descendants). */
export async function syncNotionSops(): Promise<CorpusSyncResult & { pages: number }> {
  const supabase = getSupabaseAdmin();
  const result = { updated: 0, failed: 0, skipped: 0, chunks: 0, pages: 0 };

  if (!process.env.NOTION_API_KEY) {
    console.warn('[knowledge-sync] NOTION_API_KEY not set — skipping Notion SOP sync');
    result.skipped = 1;
    return result;
  }

  const hubUrl = `https://app.notion.com/p/${NOTION_SOP_HUB_ID.replace(/-/g, '')}`;
  const queue: NotionPageRef[] = [
    { id: NOTION_SOP_HUB_ID, title: 'Process Documentation Hub', url: hubUrl },
  ];
  const seen = new Set<string>();

  while (queue.length > 0) {
    const page = queue.shift()!;
    if (seen.has(page.id)) continue;
    seen.add(page.id);
    result.pages++;

    try {
      const childPages: NotionPageRef[] = [];
      const text = await blocksToText(page.id, childPages);
      queue.push(...childPages);

      if (!text.trim() || text.trim().length < 40) {
        result.skipped++;
        continue;
      }

      const chunks = chunkText(`${page.title}\n\n${text}`);
      const embeddings = await embedBatch(chunks);

      const { error: delErr } = await supabase
        .from('knowledge_chunks')
        .delete()
        .eq('source_type', 'notion_sop')
        .eq('source_url', page.url);
      if (delErr) throw new Error(delErr.message);

      const rows = chunks.map((content, i) => ({
        content,
        embedding: embeddings[i],
        source_type: 'notion_sop',
        source_title: page.title,
        source_url: page.url,
        source_section: chunks.length > 1 ? `part ${i + 1}/${chunks.length}` : null,
      }));
      const { error: insErr } = await supabase.from('knowledge_chunks').insert(rows);
      if (insErr) throw new Error(insErr.message);

      result.updated++;
      result.chunks += rows.length;
    } catch (err) {
      console.error(`[knowledge-sync] Notion page "${page.title}" failed:`, err instanceof Error ? err.message : err);
      result.failed++;
    }
  }

  return result;
}
