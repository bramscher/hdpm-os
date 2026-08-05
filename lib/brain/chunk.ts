/**
 * Markdown chunker for brain ingestion (Phase 1, Brief 1A).
 *
 * Heading-aware: splits on H1/H2/H3 boundaries, prefixes each chunk with its
 * heading trail for retrieval context, and hard-wraps oversized sections at
 * paragraph boundaries. Pure function — unit tested.
 */

export interface MarkdownChunk {
  content: string;      // heading trail + section text
  heading: string;      // nearest heading (anchor-ish, for source_url fragments)
  index: number;        // stable within the document
}

const MAX_CHUNK_CHARS = 2400;
const MIN_CHUNK_CHARS = 80;

function splitOversized(text: string): string[] {
  if (text.length <= MAX_CHUNK_CHARS) return [text];
  const paras = text.split(/\n\n+/);
  const parts: string[] = [];
  let buf = '';
  for (const p of paras) {
    if (buf && buf.length + p.length + 2 > MAX_CHUNK_CHARS) {
      parts.push(buf);
      buf = p;
    } else {
      buf = buf ? `${buf}\n\n${p}` : p;
    }
  }
  if (buf) parts.push(buf);
  // A single paragraph beyond the limit gets hard-sliced as a last resort.
  return parts.flatMap((part) =>
    part.length <= MAX_CHUNK_CHARS
      ? [part]
      : Array.from({ length: Math.ceil(part.length / MAX_CHUNK_CHARS) }, (_, i) =>
          part.slice(i * MAX_CHUNK_CHARS, (i + 1) * MAX_CHUNK_CHARS)
        )
  );
}

export function chunkMarkdown(markdown: string, docTitle: string): MarkdownChunk[] {
  const lines = markdown.split('\n');
  const sections: { trail: string[]; body: string[] }[] = [];
  let trail: string[] = [docTitle];
  let body: string[] = [];

  const push = () => {
    if (body.join('\n').trim()) sections.push({ trail: [...trail], body });
    body = [];
  };

  for (const line of lines) {
    const m = line.match(/^(#{1,3})\s+(.*)$/);
    if (m) {
      push();
      const level = m[1].length; // 1..3
      // H1 replaces the root (avoids docTitle › H1 duplication when the
      // title was extracted from the H1 itself).
      trail = level === 1 ? [m[2].trim()] : [...trail.slice(0, level), m[2].trim()];
    } else {
      body.push(line);
    }
  }
  push();

  const chunks: MarkdownChunk[] = [];
  let index = 0;
  for (const s of sections) {
    const text = s.body.join('\n').trim();
    if (text.length < MIN_CHUNK_CHARS) continue;
    const heading = s.trail[s.trail.length - 1] ?? docTitle;
    for (const part of splitOversized(text)) {
      chunks.push({
        content: `${s.trail.join(' › ')}\n\n${part.trim()}`,
        heading,
        index: index++,
      });
    }
  }
  return chunks;
}
