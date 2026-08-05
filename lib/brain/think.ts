/**
 * Brain synthesis — `think()` (Phase 1, Brief 1B).
 *
 * Two consumers:
 *  - The knowledge chat: helpers here format brain matches as extra numbered
 *    context sources + chat Source cards (🧠), merged into lib/rag.ts.
 *  - Agents (Brief 1D): the standalone think() — brain-only retrieval →
 *    synthesized answer with per-claim citations and an explicit gap
 *    section ("what the brain does not know"), the GBrain pattern.
 */

import Anthropic from '@anthropic-ai/sdk';
import { searchBrain } from './retrieve';
import type { BrainMatch, Sensitivity } from './types';

const REPO_BLOB_BASE = 'https://github.com/bramscher/hdpm-os/blob/main/';

export const KIND_LABELS: Record<string, string> = {
  fact: 'recorded decision/fact',
  summary: 'summary',
  inference: 'inference — verify before relying on it',
  agent_output: 'agent-generated — verify before relying on it',
  human_correction: 'human correction (authoritative)',
};

/** Chat Source card shape (mirrors lib/rag.ts Source). */
export interface BrainChatSource {
  id: string;
  title: string;
  url: string;
  type: string;
  icon: string;
  section: string | null;
}

function titleFor(m: BrainMatch): string {
  // Doc chunks start with their heading trail ("Doc › Section").
  const firstLine = m.content.split('\n', 1)[0]?.trim() ?? '';
  return firstLine.length > 4 && firstLine.length <= 120
    ? firstLine
    : (m.source_url ?? 'Company memory');
}

function urlFor(m: BrainMatch): string {
  const u = m.source_url ?? '';
  if (/^https?:\/\//.test(u)) return u;
  return u ? `${REPO_BLOB_BASE}${u}` : REPO_BLOB_BASE;
}

export function brainSourcesForChat(matches: BrainMatch[]): BrainChatSource[] {
  return matches.map((m) => ({
    id: m.id,
    title: titleFor(m),
    url: urlFor(m),
    type: 'brain',
    icon: '🧠',
    section: KIND_LABELS[m.kind] ?? m.kind,
  }));
}

/**
 * Numbered context blocks continuing an existing source numbering
 * (startIndex is 1-based index of the first brain source).
 */
export function buildBrainContext(matches: BrainMatch[], startIndex: number): string {
  if (matches.length === 0) return '';
  return matches
    .map((m, i) => {
      const n = startIndex + i;
      const kind = KIND_LABELS[m.kind] ?? m.kind;
      const author = m.author !== 'system' ? `, author: ${m.author}` : '';
      return `[Source ${n}] (company memory — ${kind}${author}) ${m.source_url ?? ''}:\n${m.content}`;
    })
    .join('\n\n');
}

/** Prompt fragment describing the memory corpus + the gap rule (shared). */
export const BRAIN_PROMPT_ADDENDUM = `
COMPANY MEMORY:
- Some sources are labeled "(company memory — …)": HDPM's institutional
  memory — recorded decisions, plans, architecture and process docs.
- Trust order within company memory: human corrections > recorded
  decisions/facts > summaries > inferences > agent-generated content.
  Treat items labeled inference or agent-generated as unverified; say so if
  you rely on one.
- Company-memory citations link to the underlying document.

GAPS (required):
- If the sources do not fully cover the question, end with a short section:
  **What I don't know:** followed by 1-3 specific bullet points naming the
  missing information (not generic disclaimers), each with where the answer
  likely lives (a person, system, or document) when you can tell.
- If coverage is complete, omit the section entirely — never pad.`;

// ============================================
// Standalone think() — agents / Brief 1D
// ============================================

let _anthropic: Anthropic | null = null;
function getAnthropic(): Anthropic {
  if (!_anthropic) {
    const apiKey = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY;
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY or CLAUDE_API_KEY is not set');
    _anthropic = new Anthropic({ apiKey });
  }
  return _anthropic;
}

export interface ThinkResult {
  answer: string;               // markdown with [n] citations + gap section
  sources: BrainChatSource[];
  matches: BrainMatch[];
}

export async function think(
  question: string,
  opts: { limit?: number; maxSensitivity?: Sensitivity; maxTokens?: number } = {}
): Promise<ThinkResult> {
  const matches = await searchBrain(question, {
    limit: opts.limit ?? 10,
    maxSensitivity: opts.maxSensitivity ?? 'internal',
  });
  const sources = brainSourcesForChat(matches);
  const context = buildBrainContext(matches, 1) || 'No relevant company memory found.';

  const system = `You are HDPM-OS's company brain. Answer from the provided
company-memory sources only — do not invent facts about the company.
Cite every claim inline as [1], [2], … matching the numbered sources.
Be concise and specific.
${BRAIN_PROMPT_ADDENDUM}`;

  const message = await getAnthropic().messages.create({
    model: 'claude-sonnet-5',
    thinking: { type: 'disabled' },
    max_tokens: opts.maxTokens ?? 1024,
    system,
    messages: [
      { role: 'user', content: `Company memory sources:\n\n${context}\n\nQuestion: ${question}` },
    ],
  });

  const answer =
    message.content[0]?.type === 'text' ? message.content[0].text : 'Unable to generate response.';
  return { answer, sources, matches };
}
