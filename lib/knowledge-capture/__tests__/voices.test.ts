import { describe, it, expect } from 'vitest';
import { VOICES, normalizeVoices, rowVoices, voiceName, voicesLabel } from '../voices';

const MATT = 'matt@highdesertpm.com';
const PENNY = 'penny@highdesertpm.com';
const CRAIG = 'craig@highdesertpm.com';

describe('voices', () => {
  it('wants a take from both Matt and Penny', () => {
    expect(VOICES.filter((v) => v.source).map((v) => v.name)).toEqual(['Matt', 'Penny']);
  });

  it('names and labels voices', () => {
    expect(voiceName('Matt@HighDesertPM.com')).toBe('Matt');
    expect(voiceName('lisa@highdesertpm.com')).toBe('Lisa');
    expect(voicesLabel([MATT])).toBe('Matt');
    expect(voicesLabel([MATT, PENNY])).toBe('Matt & Penny');
    expect(voicesLabel([MATT, PENNY, CRAIG])).toBe('Matt, Penny & Craig');
  });

  it('keeps only team voices, in team order, defaulting to the recorder', () => {
    expect(normalizeVoices([PENNY, 'MATT@highdesertpm.com', PENNY], CRAIG)).toEqual([MATT, PENNY]);
    expect(normalizeVoices(['someone@else.com', 7], 'Matt@HighDesertPM.com')).toEqual([MATT]);
    expect(normalizeVoices(undefined, PENNY)).toEqual([PENNY]);
  });

  it('reads older rows without voices as the recorder', () => {
    expect(rowVoices({ voices: null, speaker_email: 'Penny@HighDesertPM.com' })).toEqual([PENNY]);
    expect(rowVoices({ voices: [MATT, PENNY], speaker_email: CRAIG })).toEqual([MATT, PENNY]);
  });
});
