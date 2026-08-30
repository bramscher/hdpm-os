/**
 * Dez answer rendering — turn an askRAG() result into Slack Block Kit.
 *
 * Pure and dependency-light (type-only import of Source, erased at compile) so
 * it unit-tests without pulling the RAG/Anthropic runtime. Handles Slack's
 * 3000-char/section limit by chunking, does minimal markdown→mrkdwn cleanup,
 * renders sources as a context line, and appends the visibility breadcrumb.
 */

import type { Source } from '@/lib/rag';

const SECTION_LIMIT = 2900; // under Slack's 3000-char section cap
const MAX_SOURCES = 8; // cap the sources line — more than this reads as noise and risks the 3000-char cap

/**
 * Minimal Claude-markdown → Slack-mrkdwn: **bold**→*bold* and [text](url)→
 * <url|text>. Everything else (lists, [1] citations) is left as-is — Slack
 * renders it acceptably. Pure.
 */
export function toSlackMrkdwn(md: string): string {
  return md
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<$2|$1>')
    .replace(/\*\*([^*]+)\*\*/g, '*$1*');
}

/** Split text into ≤limit chunks, preferring paragraph then line boundaries. Pure. */
export function chunkText(text: string, limit: number = SECTION_LIMIT): string[] {
  if (text.length <= limit) return [text];
  const chunks: string[] = [];
  let rest = text;
  while (rest.length > limit) {
    const window = rest.slice(0, limit);
    let cut = window.lastIndexOf('\n\n');
    if (cut < limit * 0.5) cut = window.lastIndexOf('\n');
    if (cut < limit * 0.5) cut = window.lastIndexOf(' ');
    if (cut <= 0) cut = limit;
    chunks.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) chunks.push(rest);
  return chunks;
}

/** One-line source list: "⚖️ [1] SOP-MO-001 · 📘 [2] Move-out". Pure. */
export function renderSources(sources: Source[]): string {
  return sources
    .map((s, i) => {
      const n = `[${i + 1}]`;
      const title = s.section ? `${s.title} — ${s.section}` : s.title;
      const label = `${s.icon} ${n} ${title}`;
      return s.url ? `<${s.url}|${label}>` : label;
    })
    .join('  ·  ');
}

/**
 * Build the Slack reply: chunked answer sections + a sources context line +
 * the visibility breadcrumb footer. `text` is the notification fallback.
 */
export function buildAnswerBlocks(
  answer: string,
  sources: Source[],
  breadcrumb: string
): { text: string; blocks: unknown[] } {
  const blocks: unknown[] = [];
  for (const chunk of chunkText(toSlackMrkdwn(answer))) {
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: chunk } });
  }
  if (sources.length) {
    // Cap by COUNT (never char-slice — that cuts a <url|label> link mid-string
    // and breaks Slack rendering). Overflow becomes a "+N more" tag.
    const shown = sources.slice(0, MAX_SOURCES);
    const overflow = sources.length - shown.length;
    const line = renderSources(shown) + (overflow > 0 ? `  ·  +${overflow} more` : '');
    blocks.push({
      type: 'context',
      elements: [{ type: 'mrkdwn', text: line }],
    });
  }
  blocks.push({ type: 'context', elements: [{ type: 'mrkdwn', text: breadcrumb }] });

  const text = answer.slice(0, 200).replace(/\s+/g, ' ').trim();
  return { text, blocks };
}

/** The breadcrumb footer that makes Dez's routing legible. Pure. */
export function buildBreadcrumb(scopeLabel: string, sourceCount: number): string {
  const src = sourceCount > 0 ? ` · ${sourceCount} source${sourceCount === 1 ? '' : 's'}` : '';
  return `🔧 dez · ${scopeLabel}${src}`;
}
