/**
 * Quick capture: guess which owner or property an untagged take is about from
 * its transcript, by matching names against the roster. No model call, so it
 * costs nothing and works offline on the cached list.
 *
 * Each subject's name (owner aliases, property address) is split into words;
 * a word shared by many subjects ("duplex", "apartments") counts for little, a
 * rare one ("malick", "coho", "1455") for a lot. A subject is suggested when
 * most of its weight is heard in the transcript, including at least one real
 * word that isn't in a large share of names.
 */
import { normalizeName, type LinkedRosterOwner } from './links';
import type { RosterProperty, SubjectType } from './roster';

export interface SubjectSuggestion {
  type: SubjectType;
  id: string;
  name: string;
  /** 0–1: share of the name's weight heard in the transcript. */
  score: number;
  /** The words that matched, for "heard: …". */
  heard: string[];
}

/** Words that say nothing about which subject it is. */
const NOISE = new Set([
  'llc', 'inc', 'corp', 'co', 'trust', 'trustee', 'trustees', 'family', 'living', 'revocable', 'irrevocable', 'properties',
  'property', 'investments', 'holdings', 'partners', 'lp', 'ltd', 'estate', 'of', 'the', 'and', 'dated', 'dtd', 'ttee',
  'unit', 'units', 'apt', 'apartment', 'apartments', 'complex', 'duplex', 'triplex', 'plex', 'st', 'street', 'ave', 'avenue',
  'rd', 'road', 'dr', 'drive', 'ln', 'lane', 'ct', 'court', 'way', 'pl', 'place', 'blvd', 'nw', 'ne', 'sw', 'se', 'n', 's',
  'e', 'w', 'for', 'sale', 'owner', 'selling', 'or', 'oregon', 'bend', 'redmond', 'prineville', 'home', 'house', 'homes',
]);

/** Everyday place words: they can add to a match but never carry one alone ("the park", "by the canyon"). */
const COMMON = new Set([
  'park', 'village', 'canyon', 'creek', 'spring', 'springs', 'ridge', 'hill', 'hills', 'view', 'point', 'lake', 'river',
  'pine', 'pines', 'oak', 'oaks', 'butte', 'mountain', 'meadow', 'meadows', 'garden', 'gardens', 'crossing', 'square',
  'center', 'west', 'east', 'north', 'south', 'town', 'townhome', 'townhomes', 'cottage', 'cottages', 'manor', 'terrace',
  'new', 'old', 'big', 'little', 'green', 'white', 'black', 'red', 'gold', 'golden', 'sun', 'sunset', 'sunrise',
]);

const MIN_SCORE = 0.6;
/** A word in more names than this ("canyon", "village" when common) can't carry a match alone. */
const MAX_SHARED = 15;
const MAX_SUGGESTIONS = 3;

function words(text: string): string[] {
  return normalizeName(text)
    .split(' ')
    .filter((w) => w.length > 1 && !NOISE.has(w) && !/^\d{1,2}$/.test(w));
}

interface Candidate {
  type: SubjectType;
  id: string;
  name: string;
  /** Alternative spellings; the best-scoring one counts. */
  names: string[][];
}

/** Heard as said: exact, or a plural/possessive ("the Malicks", "Malick's" → malicks). */
const heardIn = (said: Set<string>, w: string) => said.has(w) || said.has(`${w}s`) || (w.endsWith('s') && said.has(w.slice(0, -1)));

export function suggestSubjects(
  transcript: string | null | undefined,
  owners: LinkedRosterOwner[],
  properties: RosterProperty[]
): SubjectSuggestion[] {
  if (!transcript?.trim()) return [];
  const said = new Set(normalizeName(transcript).split(' '));

  const candidates: Candidate[] = [
    ...owners.map((o) => {
      const names = [o.name, ...o.aliases.map((a) => a.name)].map(words);
      // People say the surname their properties are named after ("Garabedian" for Andrew Garabedian).
      const propWords = new Set(o.properties.flatMap((p) => words(p.name)));
      const surname = [...new Set(names.flat())].filter((w) => propWords.has(w) && !COMMON.has(w) && !/^\d+$/.test(w));
      return { type: 'owner' as const, id: o.id, name: o.name, names: surname.length ? [...names, surname] : names };
    }),
    ...properties.map((p) => {
      // The house number and street name ("1455 Coho") are often how a place is said.
      const street = p.address.split(',')[0] ?? '';
      return { type: 'property' as const, id: p.id, name: p.name, names: [words(p.name), words(street)] };
    }),
  ].map((c) => ({ ...c, names: c.names.filter((n) => n.length) }));

  // How many subjects use each word: the fewer, the more it identifies one.
  const used = new Map<string, number>();
  for (const c of candidates) for (const w of new Set(c.names.flat())) used.set(w, (used.get(w) ?? 0) + 1);
  const weight = (w: string) => 1 / (used.get(w) ?? 1);

  const out: (SubjectSuggestion & { extra: number })[] = [];
  for (const c of candidates) {
    let best: { score: number; heard: string[]; extra: number } | null = null;
    for (const name of c.names) {
      const unique = [...new Set(name)];
      const heard = unique.filter((w) => heardIn(said, w));
      // Needs a real word, not a short number, that isn't in a large share of names.
      if (!heard.some((w) => (used.get(w) ?? 1) <= MAX_SHARED && w.length >= 3 && !COMMON.has(w) && !/^\d{1,3}$/.test(w))) continue;
      const total = unique.reduce((s, w) => s + weight(w), 0);
      const score = heard.reduce((s, w) => s + weight(w), 0) / total;
      if (score >= MIN_SCORE && (!best || score > best.score)) best = { score, heard, extra: unique.length - heard.length };
    }
    if (best) out.push({ type: c.type, id: c.id, name: c.name, score: Math.round(best.score * 100) / 100, heard: best.heard, extra: best.extra });
  }
  // Stronger match first; on a tie, more words heard (a full name beats a surname), then fewer left unheard.
  return out
    .sort((a, b) => b.score - a.score || b.heard.length - a.heard.length || a.extra - b.extra)
    .slice(0, MAX_SUGGESTIONS)
    .map(({ extra: _extra, ...s }) => s);
}
