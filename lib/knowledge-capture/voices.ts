/**
 * Whose knowledge a recording holds. A take can be one person or a
 * conversation (Matt and Penny together); `voices` stores their emails,
 * separate from `speaker_email` (who pressed record — used for edit/delete).
 * `source` marks the people whose take we want on every owner and property,
 * which drives the "Needs Penny's take" filters. Pure module.
 */

export interface Voice {
  email: string;
  name: string;
  source: boolean;
}

export const VOICES: Voice[] = [
  { email: 'matt@highdesertpm.com', name: 'Matt', source: true },
  { email: 'penny@highdesertpm.com', name: 'Penny', source: true },
  { email: 'craig@highdesertpm.com', name: 'Craig', source: false },
];

const BY_EMAIL = new Map(VOICES.map((v) => [v.email, v]));

export function voiceName(email: string): string {
  const e = email.trim().toLowerCase();
  return BY_EMAIL.get(e)?.name ?? e.split('@')[0].replace(/^./, (c) => c.toUpperCase());
}

/** "Matt", "Matt & Penny", "Matt, Penny & Craig". */
export function voicesLabel(emails: string[]): string {
  const names = emails.map(voiceName);
  return names.length <= 2 ? names.join(' & ') : `${names.slice(0, -1).join(', ')} & ${names[names.length - 1]}`;
}

/** Valid, de-duplicated, team-ordered voices; falls back to the recorder. */
export function normalizeVoices(input: unknown, recorderEmail: string): string[] {
  const wanted = new Set(
    (Array.isArray(input) ? input : [])
      .filter((v): v is string => typeof v === 'string')
      .map((v) => v.trim().toLowerCase())
  );
  const picked = VOICES.filter((v) => wanted.has(v.email)).map((v) => v.email);
  return picked.length ? picked : [recorderEmail.trim().toLowerCase()];
}

/** Voices of a stored row (rows from before voices existed: the recorder). */
export function rowVoices(row: { voices?: string[] | null; speaker_email: string }): string[] {
  return row.voices?.length ? row.voices : [row.speaker_email.toLowerCase()];
}
