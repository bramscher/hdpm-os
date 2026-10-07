/**
 * Knowledge capture synthesis: audio → transcript (OpenAI Whisper, same
 * provider as brain embeddings), transcript → structured notes, and all of a
 * subject's notes → a living profile (Claude). Every claim stays grounded in
 * what Matt or Penny actually said; gaps become open questions.
 */

import Anthropic from '@anthropic-ai/sdk';
import OpenAI, { toFile } from 'openai';
import { PROFILE_SECTIONS } from './prompts';
import type { SubjectType } from './roster';

export const TRANSCRIBE_MODEL = process.env.KC_TRANSCRIBE_MODEL || 'whisper-1';
export const SYNTH_MODEL = 'claude-opus-5-5';
/** OpenAI's transcription upload limit. */
export const MAX_AUDIO_BYTES = 25 * 1024 * 1024;

let _openai: OpenAI | null = null;
let _anthropic: Anthropic | null = null;
function openai(): OpenAI {
  if (!_openai) _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return _openai;
}
function anthropic(): Anthropic {
  if (!_anthropic) {
    const apiKey = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY;
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY or CLAUDE_API_KEY is not set');
    _anthropic = new Anthropic({ apiKey });
  }
  return _anthropic;
}

const EXT_BY_MIME: Record<string, string> = {
  'audio/webm': 'webm',
  'audio/ogg': 'ogg',
  'audio/mp4': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/m4a': 'm4a',
  'audio/aac': 'm4a',
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
};

export function audioExtension(mime: string): string {
  return EXT_BY_MIME[mime.split(';')[0].trim().toLowerCase()] ?? 'webm';
}

export async function transcribeAudio(
  audio: Blob,
  mime: string,
  subjectName: string
): Promise<{ text: string; durationSec: number | null }> {
  const file = await toFile(await audio.arrayBuffer(), `recording.${audioExtension(mime)}`, { type: mime.split(';')[0] });
  // The prompt biases spelling toward local names and terms.
  const res = await openai().audio.transcriptions.create({
    file,
    model: TRANSCRIBE_MODEL,
    response_format: 'verbose_json',
    prompt: `High Desert Property Management (HDPM), Central Oregon — Bend, Redmond, Prineville, Sisters, La Pine. AppFolio. Talking about ${subjectName}.`,
  });
  const verbose = res as unknown as { text: string; duration?: number };
  return {
    text: verbose.text.trim(),
    durationSec: verbose.duration != null ? Math.round(verbose.duration) : null,
  };
}

async function complete(system: string, user: string, maxTokens: number): Promise<string> {
  const message = await anthropic()
    .beta.messages.stream({
      model: SYNTH_MODEL,
      max_tokens: maxTokens,
      output_config: { effort: 'medium' },
      betas: ['server-side-fallback-2026-06-01'],
      fallbacks: [{ model: 'claude-opus-4-8' }],
      system,
      messages: [{ role: 'user', content: user }],
    })
    .finalMessage();
  if (message.stop_reason === 'refusal') throw new Error('Synthesis was declined by the model');
  const text = message.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim();
  if (!text) throw new Error('Synthesis returned no text');
  return text;
}

const SUBJECT_LABEL: Record<SubjectType, string> = { owner: 'property owner', property: 'rental property' };

export interface SubjectContext {
  type: SubjectType;
  name: string;
  /** AppFolio facts shown to the model as ground truth (address, doors, related owners/properties). */
  facts: string;
}

export async function distillNotes(
  subject: SubjectContext,
  transcript: string,
  speaker: string,
  recordedOn: string
): Promise<string> {
  const sections = PROFILE_SECTIONS[subject.type].filter((s) => s !== 'At a glance');
  const system = `You turn recorded interviews into durable notes for High Desert Property Management's company memory. ${speaker} is a long-time HDPM employee leaving the company, recording what they know about a ${SUBJECT_LABEL[subject.type]} so the team keeps that knowledge.

Write markdown notes using these H2 sections, skipping any section with nothing said: ${sections.map((s) => `"${s}"`).join(', ')}.
Rules:
- Only include what ${speaker} actually said. Do not add advice, assumptions or general property-management knowledge.
- Keep specifics: names, phone numbers mentioned, amounts, dates, vendor names, locations of shutoffs, codes. Keep them exactly as spoken.
- Short bullet points. Attribute opinions as ${speaker}'s view ("Matt thinks…") when they are judgment calls rather than facts.
- If something said is unclear or the transcript looks garbled, put it under "Open questions" rather than guessing.
- No preamble, no closing remarks — just the sections.`;
  const user = `Subject: ${subject.name} (${SUBJECT_LABEL[subject.type]})
AppFolio facts:
${subject.facts}

Recorded ${recordedOn} by ${speaker}. Transcript:
"""
${transcript}
"""`;
  return complete(system, user, 16000);
}

export interface NoteSource {
  speaker: string;
  recordedOn: string;
  notes: string;
}

export async function synthesizeProfile(subject: SubjectContext, notes: NoteSource[]): Promise<string> {
  const sections = PROFILE_SECTIONS[subject.type];
  const system = `You maintain HDPM's living profile of a ${SUBJECT_LABEL[subject.type]}, built from interview notes recorded by departing long-time staff (Matt and Penny). The profile is what a new property manager reads before their first call or visit.

Write markdown with these H2 sections, in order: ${sections.map((s) => `"${s}"`).join(', ')}.
- "At a glance": 3–5 bullets, the things someone must know first.
- Merge overlapping notes; keep every concrete specific (names, numbers, vendors, locations, preferences).
- When notes disagree, keep both and say who said what and when, newer first.
- Attribute judgment calls to the person ("Penny: …").
- "Open questions": what a new manager would still need to find out, including anything flagged unclear.
- Do not invent anything beyond the notes and the AppFolio facts. Skip a section only if nothing at all applies (write "Nothing recorded yet." instead of dropping it).
- No title line, no preamble.`;
  const body = notes
    .map((n, i) => `### Recording ${i + 1} — ${n.speaker}, ${n.recordedOn}\n${n.notes}`)
    .join('\n\n');
  const user = `Subject: ${subject.name} (${SUBJECT_LABEL[subject.type]})
AppFolio facts:
${subject.facts}

Interview notes (oldest first):

${body}`;
  return complete(system, user, 16000);
}
