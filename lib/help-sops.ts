/**
 * Route → Notion SOP map for the global help button.
 *
 * Every entry lives in the Notion SOP library section "HDPM-OS App — SOP
 * Library" (under Knowledge Base → Process Documentation Hub). Longest
 * matching path prefix wins, so /maintenance/inspections/candidates resolves
 * to the Candidates SOP while /maintenance/inspections/* falls back to the
 * Inspections Dashboard SOP. Keep this in sync when adding pages or SOPs.
 */

export const SOP_LIBRARY_URL =
  'https://app.notion.com/p/3a70262b5145816bb8a3d734a23cd193';

export interface HelpSop {
  /** Path prefix this SOP applies to ('/' matches only the home page). */
  prefix: string;
  title: string;
  notionUrl: string;
  blurb: string;
}

export const HELP_SOPS: HelpSop[] = [
  {
    prefix: '/',
    title: 'Home Dashboard',
    notionUrl: 'https://app.notion.com/p/3a70262b514581f68b83e9b57b8d16a2',
    blurb: 'The tile launchpad — what the badges mean and where each tile goes.',
  },
  {
    prefix: '/maintenance/board',
    title: 'Work Order Board',
    notionUrl: 'https://app.notion.com/p/3a70262b51458113ba60c1c7f9eac6a9',
    blurb: 'Driving every work order NEW → CLOSED: views, daily flow, exceptions first.',
  },
  {
    prefix: '/maintenance/inspections',
    title: 'Inspections Dashboard',
    notionUrl: 'https://app.notion.com/p/3a70262b51458153b85dd71a214768df',
    blurb: 'The inspection queue and tenant notices (Realm-X bulk email bridge).',
  },
  {
    prefix: '/maintenance/inspections/candidates',
    title: 'Inspection Candidates & Scheduling',
    notionUrl: 'https://app.notion.com/p/3a70262b51458107b46fe222b12c6e23',
    blurb: 'Who is due (6-month move-in-anchored cadence) and how to schedule routes.',
  },
  {
    prefix: '/maintenance/inspections/routes',
    title: 'Inspection Route Builder',
    notionUrl: 'https://app.notion.com/p/3a70262b514581519e38e54ff82a2739',
    blurb: 'Build, optimize, and dispatch day routes — calendar invite is the route sheet.',
  },
  {
    prefix: '/maintenance/inspections/import',
    title: 'Inspection Import',
    notionUrl: 'https://app.notion.com/p/3a70262b5145817cabdaefbde3610289',
    blurb: 'Bulk-load inspections from CSV/XLSX for backfill.',
  },
  {
    prefix: '/maintenance/invoices',
    title: 'Invoice Generator',
    notionUrl: 'https://app.notion.com/p/3a70262b514581cc9526e8d0cb8960f2',
    blurb: 'Invoices from WOs, CSVs, or PDFs — markup rules and bill reconciliation.',
  },
  {
    prefix: '/maintenance/work-orders',
    title: 'Invoice Generator',
    notionUrl: 'https://app.notion.com/p/3a70262b514581cc9526e8d0cb8960f2',
    blurb: 'Invoices from WOs, CSVs, or PDFs — markup rules and bill reconciliation.',
  },
  {
    prefix: '/comps',
    title: 'Rent Comps',
    notionUrl: 'https://app.notion.com/p/3a70262b514581a3a841d67e7addf74e',
    blurb: 'AppFolio + Rentometer + HUD FMR comparisons for pricing decisions.',
  },
  {
    prefix: '/keys',
    title: 'Key Manager',
    notionUrl: 'https://app.notion.com/p/3a70262b514581c9b379cab98d5d1cc5',
    blurb: 'Key registry — checkouts, copies, vacancy workflow, per-key history.',
  },
  {
    prefix: '/craigslist',
    title: 'Craigslist Ad Creator',
    notionUrl: 'https://app.notion.com/p/3a70262b514581258a56ce12c7652f5f',
    blurb: 'Vacancies → AI listing copy → Craigslist post.',
  },
  {
    prefix: '/reports/owner',
    title: 'Owner Reports',
    notionUrl: 'https://app.notion.com/p/3a70262b51458176b92fecf6993e4ae1',
    blurb: 'Per-owner portfolio summaries, rent timelines, tenant history.',
  },
  {
    prefix: '/agents',
    title: 'Agent Team',
    notionUrl: 'https://app.notion.com/p/3a70262b514581f89e85d9a908ae82d7',
    blurb: 'Supervising the agents — autonomy matrix, proposals, kill switch.',
  },
  {
    prefix: '/dashboard',
    title: 'KPI Dashboard & Trends',
    notionUrl: 'https://app.notion.com/p/3a70262b514581858226da6011eb32d4',
    blurb: 'Business KPIs and trends — daily snapshots via cron.',
  },
  {
    prefix: '/admin/zoom-sync',
    title: 'Zoom Contact Sync',
    notionUrl: 'https://app.notion.com/p/3a70262b5145814ab069f5f82cfccde8',
    blurb: 'AppFolio contacts → Zoom Phone caller ID and click-to-call.',
  },
];

/** Longest-prefix match; '/' only matches the home page exactly. */
export function findHelpSop(pathname: string): HelpSop | null {
  let best: HelpSop | null = null;
  for (const sop of HELP_SOPS) {
    if (sop.prefix === '/') {
      if (pathname === '/') best = best ?? sop;
      continue;
    }
    if (pathname === sop.prefix || pathname.startsWith(`${sop.prefix}/`)) {
      if (!best || sop.prefix.length > best.prefix.length) best = sop;
    }
  }
  return best;
}
