/**
 * Dez quality/freshness flag — when someone asks Dez for a form or document,
 * check whether what it found looks current before they use it, and route the
 * doubtful ones to Craig.
 *
 * Dez reads *text* extracted from the SharePoint corpus, so it can't literally
 * see a logo. But the source titles carry the folder path + filename (e.g.
 * "Tenant Forms / … / RF - Deposit to Hold Agreement (Branded).pdf"), which is
 * enough to tell a form from an SOP and a branded/redesigned version from an
 * older one. That covers the real case: "here's the latest I found, but it may
 * not be the current branded version — have Craig confirm before sending."
 *
 * Pure functions; the events route wires them in and does the Slack side.
 */

import type { Source } from '@/lib/rag';

// The three SharePoint form folders (Procedures = SOPs, not forms).
const FORM_FOLDERS = ['Tenant Forms', 'Owner Forms', 'Admin Forms'];
const BRANDED_RE = /branded|redesign/i;

// Question shapes that mean "give me the actual form/document" (vs. a policy Q
// that merely happens to cite a form).
const FORM_REQUEST_SIGNALS = [
  'form', 'template', 'document', 'agreement', 'addendum', 'disclosure',
  'do we have', 'send me', 'give me', 'need the', 'looking for', 'pdf', 'the latest',
  'notice to', 'application', 'checklist', 'letter',
];

/** True when the asker wants an actual form/document, not just an answer. Pure. */
export function looksLikeFormRequest(question: string): boolean {
  const q = ` ${question.toLowerCase()} `;
  return FORM_REQUEST_SIGNALS.some((s) => q.includes(s));
}

function isFormSource(s: Source): boolean {
  return s.type === 'onedrive_doc' && FORM_FOLDERS.some((f) => s.title.includes(f));
}

function isBranded(s: Source): boolean {
  return BRANDED_RE.test(s.title);
}

export interface QualityFlag {
  /** Text appended to the answer (null → nothing to add). */
  caveat: string | null;
  /** True → also route to Craig + record as needs-attention. */
  needsAttention: boolean;
  /** Short machine-ish reason for the review queue. */
  reason: string | null;
  /** The form source the flag is about, if any. */
  flaggedTitle: string | null;
}

const NONE: QualityFlag = { caveat: null, needsAttention: false, reason: null, flaggedTitle: null };

/**
 * Assess the form sources behind an answer. Only call when looksLikeFormRequest
 * is true. Pure.
 * - both a branded and an older version present → point to the branded one (no escalation)
 * - only a branded version → light "confirm it's current" note
 * - only an older/unbranded version → escalate: might not have the current logo
 * - no form sources → nothing
 */
export function assessFormSources(sources: Source[]): QualityFlag {
  const forms = sources.filter(isFormSource);
  if (forms.length === 0) return NONE;

  const branded = forms.filter(isBranded);
  const older = forms.filter((s) => !isBranded(s));
  const link = (s: Source) => (s.url ? ` (<${s.url}|open>)` : '');

  if (branded.length && older.length) {
    return {
      caveat: `⚠️ I found more than one version. Use the current *branded* one${link(branded[0])} — the other is older. Double-check it's the latest before sending.`,
      needsAttention: false,
      reason: null,
      flaggedTitle: branded[0].title,
    };
  }

  if (branded.length && !older.length) {
    return {
      caveat: `ℹ️ This looks like the current branded form — still confirm it's the latest version before external or tenant use.`,
      needsAttention: false,
      reason: null,
      flaggedTitle: branded[0].title,
    };
  }

  // only older/unbranded
  return {
    caveat: `⚠️ This is the latest I could find, but I couldn't locate a current *branded* (logo) version — it may be out of date. Please have **Craig** confirm it's current before sending. I've flagged it for him.`,
    needsAttention: true,
    reason: 'form request returned only a non-branded/possibly-outdated version',
    flaggedTitle: older[0].title,
  };
}
