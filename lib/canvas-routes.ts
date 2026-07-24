/**
 * Canvas navigation map for the agent interface on the home page.
 *
 * The chat can steer the canvas to an app view two ways:
 *  - chips under an answer, derived from the SOPs it cited (sopUrlToAppKey —
 *    built by inverting the help-button map in lib/help-sops.ts)
 *  - a lightweight intent match on the user's message ("show me the board")
 */

import { HELP_SOPS } from '@/lib/help-sops';

export type AppEmbedKey =
  | 'board'
  | 'inspections'
  | 'candidates'
  | 'routes'
  | 'invoices'
  | 'keys'
  | 'craigslist'
  | 'comps';

export interface AppEmbedConfig {
  title: string;
  route: string;
  keywords: RegExp;
}

// Order matters for matchIntent: more specific entries before broader ones
// (candidates/routes before inspections).
export const APP_EMBEDS: Record<AppEmbedKey, AppEmbedConfig> = {
  board: {
    title: 'Work Order Board',
    route: '/maintenance/board',
    keywords: /\b(board|work[ -]?orders?|wos\b|exceptions|triage)\b/i,
  },
  candidates: {
    title: 'Inspection Candidates',
    route: '/maintenance/inspections/candidates',
    keywords: /\bcandidates?\b/i,
  },
  routes: {
    title: 'Route Builder',
    route: '/maintenance/inspections/routes',
    keywords: /\b(routes?|route builder)\b/i,
  },
  inspections: {
    title: 'Inspections',
    route: '/maintenance/inspections',
    keywords: /\binspections?\b/i,
  },
  invoices: {
    title: 'Invoices',
    route: '/maintenance/invoices',
    keywords: /\binvoices?\b/i,
  },
  keys: {
    title: 'Key Manager',
    route: '/keys',
    keywords: /\bkeys?\b/i,
  },
  craigslist: {
    title: 'Craigslist Ads',
    route: '/craigslist',
    keywords: /\b(craigslist|listings?|vacanc(y|ies))\b/i,
  },
  comps: {
    title: 'Rent Comps',
    route: '/comps',
    keywords: /\b(comps?|rent comparison|rentometer)\b/i,
  },
};

/** App-route prefix → embed key (longest/most-specific prefixes first). */
const PREFIX_TO_KEY: [string, AppEmbedKey][] = [
  ['/maintenance/inspections/candidates', 'candidates'],
  ['/maintenance/inspections/routes', 'routes'],
  ['/maintenance/inspections', 'inspections'],
  ['/maintenance/board', 'board'],
  ['/maintenance/invoices', 'invoices'],
  ['/keys', 'keys'],
  ['/craigslist', 'craigslist'],
  ['/comps', 'comps'],
];

const SOP_URL_TO_KEY = new Map<string, AppEmbedKey>();
for (const sop of HELP_SOPS) {
  const hit = PREFIX_TO_KEY.find(
    ([prefix]) => sop.prefix === prefix || sop.prefix.startsWith(`${prefix}/`)
  );
  if (hit && !SOP_URL_TO_KEY.has(sop.notionUrl)) {
    SOP_URL_TO_KEY.set(sop.notionUrl, hit[1]);
  }
}

/** Cited SOP Notion URL → the app view it documents (null for non-app SOPs). */
export function sopUrlToAppKey(url: string): AppEmbedKey | null {
  return SOP_URL_TO_KEY.get(url) ?? null;
}

/**
 * "show me the board" → 'board'. Requires an explicit navigation verb so
 * ordinary questions ("what does the board SOP say?") never hijack the canvas.
 */
export function matchIntent(message: string): AppEmbedKey | null {
  if (!/\b(show|open|pull up|view|display|bring up|go to|take me to)\b/i.test(message)) {
    return null;
  }
  for (const key of Object.keys(APP_EMBEDS) as AppEmbedKey[]) {
    if (APP_EMBEDS[key].keywords.test(message)) return key;
  }
  return null;
}
