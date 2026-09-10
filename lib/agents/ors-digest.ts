/**
 * Slack action-id helpers for the ORS-watch "Digest this" button.
 *
 * The ors-watch alert offers to ingest a newly-found ORS 90 section into the
 * knowledge base on the spot. The button carries `ors:digest:<section>`; the
 * interact route parses it and calls ingestOrsSection. Pure string helpers so
 * they unit-test without Slack or a DB.
 */

export const ORS_DIGEST_PREFIX = 'ors:digest:';

export function buildOrsDigestActionId(section: string): string {
  return `${ORS_DIGEST_PREFIX}${section}`;
}

/** Parse an `ors:digest:<section>` action id. Returns null if it isn't one. */
export function parseOrsDigestActionId(actionId: string): { section: string } | null {
  if (!actionId.startsWith(ORS_DIGEST_PREFIX)) return null;
  const section = actionId.slice(ORS_DIGEST_PREFIX.length).trim();
  return section ? { section } : null;
}
