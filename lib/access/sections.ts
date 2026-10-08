/**
 * App section registry — the single source of truth for per-person access.
 *
 * Every page area of HDPM-OS belongs to exactly one section. The registry
 * drives three things, so a section added here is automatically:
 *   1. a menu item (Sidebar) when it has `nav`,
 *   2. a switchable row in Admin → User settings,
 *   3. enforced by the proxy (its pages redirect, its APIs 403) when switched off.
 *
 * ADDING A FEATURE: add a section (or extend one's `pages` / `apis`) here.
 * lib/access/__tests__/sections.test.ts fails if a nav item or page prefix
 * is left unregistered or claimed twice.
 *
 * Pure module (no server imports) — used by the proxy, the client and the API.
 */

import type { AccessRole } from '@/lib/roles';

export type NavGroup = 'main' | 'Maintenance' | 'Leasing' | 'Company' | 'Admin';

export interface AppSection {
  key: string;
  label: string;
  description: string;
  group: NavGroup;
  /** Roles that get the section by default ('all' = every staff role). Admins always default on. */
  defaultRoles: 'all' | AccessRole[];
  /** Page path prefixes owned by this section (longest match wins across sections). */
  pages: string[];
  /**
   * API path prefixes. An API may be shared by several sections — access is
   * allowed if the person has ANY section that lists it.
   */
  apis?: string[];
  /** Sidebar entry. `icon` is a key into the Sidebar's icon map. */
  nav?: { href: string; icon: string; order: number };
  /** Cannot be switched off (home screen). */
  alwaysOn?: boolean;
  /** Admins can never lose this one — prevents locking everyone out of User settings. */
  adminLocked?: boolean;
  /** Only visible to Craig regardless of switches (HABU demos). */
  ownerOnly?: boolean;
  /**
   * Admin section an admin may switch on for one non-admin person (never via
   * role defaults). Its pages/APIs check the section, not the admin role.
   */
  delegable?: boolean;
}

/** Human names for access roles (staff.access_role). */
export const ROLE_LABELS: Record<AccessRole, string> = {
  admin: 'Admin',
  manager: 'Manager',
  pm: 'Property Manager',
  maintenance: 'Maintenance',
  finance: 'Finance',
  front_desk: 'Front Desk',
  inspector: 'Inspector',
  field: 'Field tech',
  staff: 'Staff (general)',
  read_only: 'Read only',
};

// Property managers (and the generic staff fallback) get every non-admin section.
const PM: AccessRole[] = ['manager', 'pm', 'staff'];

const MAINT_APIS = ['/api/maintenance', '/api/work-orders', '/api/invoices', '/api/payments', '/api/af-bills', '/api/reconcile-selection', '/api/reconciliation-draft', '/api/turn-estimator'];

export const APP_SECTIONS: AppSection[] = [
  // ── Main ─────────────────────────────────────────────
  {
    key: 'home',
    label: 'Dashboard',
    description: 'Home screen with tiles and today’s field route.',
    group: 'main',
    defaultRoles: 'all',
    pages: [],
    nav: { href: '/', icon: 'home', order: 1 },
    alwaysOn: true,
  },
  {
    key: 'activities',
    label: 'Activities',
    description: 'AppFolio activities and follow-ups.',
    group: 'main',
    // Every employee sees their own AppFolio activities (also on the home dashboard).
    defaultRoles: 'all',
    pages: ['/activities'],
    apis: ['/api/activities'],
    nav: { href: '/activities', icon: 'list', order: 2 },
  },

  // ── Maintenance ──────────────────────────────────────
  {
    key: 'maintos',
    label: 'MaintOS',
    description: 'Maintenance board, work orders, turnovers, vendors.',
    group: 'Maintenance',
    defaultRoles: [...PM, 'maintenance', 'field', 'finance'],
    pages: ['/maintenance/board', '/maintenance'],
    apis: MAINT_APIS,
    nav: { href: '/maintenance/board', icon: 'wrench', order: 10 },
  },
  {
    key: 'chase_board',
    label: 'Chase board',
    description: 'Stuck estimates, approvals and unscheduled work: aging snapshot, next steps, vendor follow-ups.',
    group: 'Maintenance',
    // The page itself is limited to the follow-up reviewers (lib/agents/followup-access.ts);
    // admins see it by default, turn it on for others in User settings.
    defaultRoles: [],
    pages: ['/maintenance/estimate-followups'],
    apis: ['/api/maintenance/estimate-followups'],
    nav: { href: '/maintenance/estimate-followups', icon: 'target', order: 10.5 },
  },
  {
    key: 'work_billing',
    label: 'Work & Billing',
    description: 'Estimates, invoices, approvals, daily billing, reconciliation.',
    group: 'Maintenance',
    defaultRoles: [...PM, 'maintenance', 'finance'],
    pages: ['/maintenance/invoices', '/turn-estimator/estimates', '/maintenance/workspace', '/maintenance/daily-billing'],
    apis: MAINT_APIS,
    nav: { href: '/maintenance/invoices', icon: 'file', order: 11 },
  },
  {
    key: 'field_app',
    label: 'Field workspace',
    description: 'Technician field view of the maintenance workspace.',
    group: 'Maintenance',
    defaultRoles: [...PM, 'maintenance', 'field'],
    pages: ['/maintenance/field'],
    apis: MAINT_APIS,
  },
  {
    key: 'inspections',
    label: 'Inspections',
    description: 'Inspection queue, candidates and imports.',
    group: 'Maintenance',
    defaultRoles: [...PM, 'maintenance', 'inspector'],
    pages: ['/maintenance/inspections'],
    apis: ['/api/inspections'],
    nav: { href: '/maintenance/inspections', icon: 'clipboard', order: 12 },
  },
  {
    key: 'route_builder',
    label: 'Route Builder',
    description: 'Build, optimize and dispatch inspection routes.',
    group: 'Maintenance',
    defaultRoles: [...PM, 'maintenance', 'inspector'],
    pages: ['/maintenance/inspections/routes'],
    apis: ['/api/inspections'],
    nav: { href: '/maintenance/inspections/routes', icon: 'navigation', order: 13 },
  },
  {
    key: 'turns',
    label: 'Turns',
    description: 'Unit turn planning and estimates.',
    group: 'Maintenance',
    defaultRoles: [...PM, 'maintenance'],
    pages: ['/turn-estimator/turns'],
    apis: ['/api/turn-estimator'],
    nav: { href: '/turn-estimator/turns', icon: 'refresh', order: 14 },
  },
  {
    key: 'price_book',
    label: 'Price Book',
    description: 'Labor rates, materials and services for estimates (editing is admin-only).',
    group: 'Maintenance',
    defaultRoles: [...PM, 'maintenance'],
    pages: ['/turn-estimator/price-book'],
    apis: ['/api/turn-estimator'],
    nav: { href: '/turn-estimator/price-book', icon: 'book', order: 15 },
  },

  // ── Leasing ──────────────────────────────────────────
  {
    key: 'rent_comps',
    label: 'Rent Comps',
    description: 'Central Oregon rent comparisons.',
    group: 'Leasing',
    defaultRoles: [...PM, 'front_desk'],
    pages: ['/comps'],
    apis: ['/api/comps'],
    nav: { href: '/comps', icon: 'chart', order: 20 },
  },
  {
    key: 'craigslist',
    label: 'Craigslist',
    description: 'Vacancy listings and AI ad copy.',
    group: 'Leasing',
    defaultRoles: [...PM, 'front_desk'],
    pages: ['/craigslist'],
    apis: ['/api/generate-listing', '/api/saved-listings', '/api/appfolio-vacancies'],
    nav: { href: '/craigslist', icon: 'megaphone', order: 21 },
  },
  {
    key: 'keys',
    label: 'Keys',
    description: 'Physical key registry and history.',
    group: 'Leasing',
    defaultRoles: [...PM, 'maintenance', 'field', 'inspector', 'front_desk'],
    pages: ['/keys'],
    apis: ['/api/keys'],
    nav: { href: '/keys', icon: 'key', order: 22 },
  },
  {
    key: 'haven',
    label: 'Haven',
    description: 'AI leasing pipeline, escalations, tours and reception metrics.',
    group: 'Leasing',
    defaultRoles: [...PM, 'front_desk'],
    pages: ['/haven'],
    apis: ['/api/haven'],
  },
  {
    key: 'property_map',
    label: 'Property Map',
    description: 'All managed properties on a map.',
    group: 'Leasing',
    defaultRoles: [...PM, 'maintenance', 'field', 'inspector', 'front_desk'],
    pages: ['/properties'],
    apis: ['/api/properties'],
  },

  // ── Company ──────────────────────────────────────────
  {
    key: 'company',
    label: 'Company',
    description: 'Scorecard, rocks, issues, meetings, org chart.',
    group: 'Company',
    defaultRoles: 'all',
    pages: ['/company'],
    apis: ['/api/eos'],
    nav: { href: '/company/scorecard', icon: 'target', order: 30 },
  },
  {
    key: 'timekeeping',
    label: 'Timekeeping',
    description: 'Time clock, schedules and approvals.',
    group: 'Company',
    defaultRoles: [...PM, 'maintenance', 'field', 'inspector', 'front_desk', 'finance'],
    pages: ['/timekeeping'],
    apis: ['/api/timekeeping'],
    nav: { href: '/timekeeping', icon: 'clock', order: 31 },
  },
  {
    key: 'agents',
    label: 'Agents',
    description: 'What each agent and scheduled report does, recent agent activity, and agent controls.',
    group: 'Company',
    defaultRoles: [...PM],
    pages: ['/agents'],
    apis: ['/api/agents'],
    nav: { href: '/agents', icon: 'bot', order: 32 },
  },
  {
    key: 'brain',
    label: 'Brain map',
    description: 'A 3D map of everything Dez knows (policies, SOPs, Oregon law, company memory) and how often each piece is cited.',
    group: 'Company',
    defaultRoles: [...PM],
    pages: ['/brain'],
    // /api/brain is a public proxy prefix (cron + service-token callers); /api/brain/viz guards itself.
    apis: ['/api/brain/viz'],
    nav: { href: '/brain', icon: 'brain', order: 32.5 },
  },
  {
    key: 'brain_2',
    label: 'Brain 2',
    description: 'The original galaxy view of the brain map, kept alongside the anatomical one. Uses the same data, so it also needs Brain map.',
    group: 'Company',
    defaultRoles: [...PM],
    // Off the menu (still reachable at /brain-2).
    pages: ['/brain-2'],
  },
  {
    key: 'knowledge_capture',
    label: 'Knowledge Capture',
    description: 'Record what you know about each AppFolio owner and property; transcripts become owner and property profiles in the brain.',
    group: 'Company',
    // Admins by default; switch on for Matt and Penny (and whoever reads the profiles) in User settings.
    defaultRoles: [],
    pages: ['/knowledge-capture'],
    apis: ['/api/knowledge-capture'],
    nav: { href: '/knowledge-capture', icon: 'mic', order: 32.6 },
  },
  {
    key: 'desk_demo',
    label: 'The Desk (demo)',
    description: 'Clickable demo of per-person desks with circulating colored folders and paper-form tracking. Sample data only.',
    group: 'Company',
    // Admins by default; switch on per person or role in User settings for the team walkthrough.
    defaultRoles: [],
    pages: ['/desk-demo'],
    nav: { href: '/desk-demo', icon: 'folder', order: 33 },
  },
  {
    key: 'owner_reports',
    label: 'Owner Reports',
    description: 'Owner-facing reports.',
    group: 'Company',
    defaultRoles: [...PM, 'finance'],
    pages: ['/reports'],
    apis: ['/api/reports'],
  },

  // ── Admin ────────────────────────────────────────────
  {
    key: 'user_settings',
    label: 'User settings',
    description: 'Who can see which sections, plus invoice and estimate abilities.',
    group: 'Admin',
    defaultRoles: ['admin'],
    pages: ['/admin/user-settings', '/admin/staff-permissions', '/admin'],
    apis: ['/api/admin/user-settings', '/api/admin/staff-permissions'],
    nav: { href: '/admin/user-settings', icon: 'users', order: 40 },
    adminLocked: true,
  },
  {
    key: 'kpis',
    delegable: true,
    label: 'Company KPIs',
    description: 'KPI dashboard, trends and financials.',
    group: 'Admin',
    defaultRoles: ['admin'],
    pages: ['/dashboard'],
    apis: ['/api/kpi', '/api/financials', '/api/config'],
    nav: { href: '/dashboard', icon: 'activity', order: 41 },
  },
  {
    key: 'fee_management',
    delegable: true,
    label: 'Fee Management',
    description: 'Fee Index, owner fee opportunity and fee schedule.',
    group: 'Admin',
    defaultRoles: ['admin'],
    pages: ['/admin/fee-management'],
    apis: ['/api/admin/fee-management'],
    nav: { href: '/admin/fee-management', icon: 'percent', order: 42 },
  },
  {
    key: 'hiring',
    delegable: true,
    label: 'Hiring',
    description: 'Website job applications, job availability and application email recipients.',
    group: 'Admin',
    defaultRoles: ['admin'],
    pages: ['/admin/hiring'],
    apis: ['/api/admin/hiring'],
    nav: { href: '/admin/hiring', icon: 'briefcase', order: 42.6 },
  },
  {
    key: 'leads_admin',
    label: 'Leads',
    description: 'Website CRM leads: pipeline status, follow-ups, owner and notes.',
    group: 'Admin',
    defaultRoles: ['admin'],
    pages: ['/admin/leads'],
    apis: ['/api/admin/leads'],
    nav: { href: '/admin/leads', icon: 'target', order: 42.55 },
  },
  {
    key: 'website_admin',
    label: 'Website',
    description: 'Shortcuts into the highdesertpm.com admin: blog, pages, jobs, CRM and media.',
    group: 'Admin',
    defaultRoles: ['admin'],
    pages: ['/admin/website'],
    nav: { href: '/admin/website', icon: 'globe', order: 42.7 },
  },
  {
    key: 'zoom_sync',
    label: 'Zoom Sync',
    description: 'AppFolio contacts to Zoom Phone.',
    group: 'Admin',
    defaultRoles: ['admin'],
    pages: ['/admin/zoom-sync'],
    apis: ['/api/zoom-sync'],
    nav: { href: '/admin/zoom-sync', icon: 'phone', order: 43 },
  },
  {
    key: 'referrals_admin',
    delegable: true,
    label: 'Partners',
    description: 'Referral partner program: referrers, invites, the lead pipeline and fee policy.',
    group: 'Admin',
    defaultRoles: ['admin'],
    pages: ['/partners/admin'],
    apis: ['/api/partners/admin'],
    nav: { href: '/partners/admin', icon: 'handshake', order: 42.5 },
  },
  {
    key: 'habu_paper',
    label: 'Paper Workflows',
    description: 'HABU paper workflow forms (Craig only).',
    group: 'Admin',
    defaultRoles: ['admin'],
    pages: ['/admin/habu-paper'],
    nav: { href: '/admin/habu-paper', icon: 'file', order: 44 },
    ownerOnly: true,
  },
  {
    key: 'habu_demo',
    label: 'HABU Demo',
    description: 'Office jackets and subway routing map (Craig only).',
    group: 'Admin',
    defaultRoles: ['admin'],
    pages: ['/admin/habu-demo'],
    nav: { href: '/admin/habu-demo', icon: 'navigation', order: 45 },
    ownerOnly: true,
  },
];

export const SECTION_KEYS = APP_SECTIONS.map((s) => s.key);
const BY_KEY = new Map(APP_SECTIONS.map((s) => [s.key, s]));
export const sectionByKey = (key: string) => BY_KEY.get(key);

export type SectionOverrides = Record<string, boolean>;

const matches = (path: string, prefix: string) => path === prefix || path.startsWith(prefix.endsWith('/') ? prefix : `${prefix}/`);

/** The section that owns a page path (longest matching prefix), or null. */
export function sectionForPage(pathname: string): AppSection | null {
  let best: AppSection | null = null;
  let len = -1;
  for (const s of APP_SECTIONS) {
    for (const p of s.pages) {
      if (matches(pathname, p) && p.length > len) {
        best = s;
        len = p.length;
      }
    }
  }
  if (!best && pathname === '/') return BY_KEY.get('home')!;
  return best;
}

/** Sections that may use an API path (any one of them grants access). Empty = unmanaged. */
export function sectionsForApi(pathname: string): AppSection[] {
  // Longest API prefix wins, then every section sharing that exact prefix counts.
  let len = -1;
  let owners: AppSection[] = [];
  for (const s of APP_SECTIONS) {
    for (const p of s.apis ?? []) {
      if (!matches(pathname, p)) continue;
      if (p.length > len) {
        len = p.length;
        owners = [s];
      } else if (p.length === len && !owners.includes(s)) {
        owners.push(s);
      }
    }
  }
  return owners;
}

/** Admin-edited role defaults (Admin → User settings → Roles), layered over the code defaults above. */
export type RoleDefaultOverrides = Partial<Record<string, SectionOverrides>>;

/** Code default for a role, before any admin edits. */
export function codeRoleDefault(section: AppSection, role: string | undefined): boolean {
  if (role === 'admin') return true;
  return section.defaultRoles === 'all' || section.defaultRoles.includes(role as AccessRole);
}

export function roleDefault(section: AppSection, role: string | undefined, roleOverrides?: RoleDefaultOverrides): boolean {
  if (role === 'admin') return true; // admin role = everything; restrict an admin per person instead
  if (section.group === 'Admin') return false; // admin sections also need the admin role server-side
  return roleOverrides?.[role ?? '']?.[section.key] ?? codeRoleDefault(section, role);
}

/**
 * Effective access for one section: always-on and admin-locked rules first,
 * then the person's override, then their role default.
 */
export function sectionAllowed(
  section: AppSection,
  role: string | undefined,
  overrides: SectionOverrides,
  roleOverrides?: RoleDefaultOverrides
): boolean {
  if (section.alwaysOn) return true;
  if (section.adminLocked && role === 'admin') return true;
  if (section.group === 'Admin' && role !== 'admin') return section.delegable === true && overrides[section.key] === true;
  return overrides[section.key] ?? roleDefault(section, role, roleOverrides);
}

/** Admin sections that can be granted to one non-admin person. */
export const DELEGABLE_SECTION_KEYS = APP_SECTIONS.filter((s) => s.group === 'Admin' && s.delegable).map((s) => s.key);

/** Keys in `overrides` that would grant a non-delegable Admin section to a non-admin. */
export function forbiddenAdminGrants(role: string | undefined, overrides: SectionOverrides): string[] {
  if (role === 'admin') return [];
  return Object.entries(overrides)
    .filter(([key, on]) => on && BY_KEY.get(key)?.group === 'Admin' && !BY_KEY.get(key)?.delegable)
    .map(([key]) => key);
}

/** Keys of sections this person is denied — small list, stamped into the session token. */
export function deniedSections(role: string | undefined, overrides: SectionOverrides, roleOverrides?: RoleDefaultOverrides): string[] {
  return APP_SECTIONS.filter((s) => !sectionAllowed(s, role, overrides, roleOverrides)).map((s) => s.key);
}

/** Validate a role-defaults payload: known role, known non-admin, non-always-on sections, booleans. */
export function parseRoleDefaults(role: unknown, v: unknown): { role: AccessRole; overrides: SectionOverrides } | null {
  if (typeof role !== 'string' || !(role in ROLE_LABELS) || role === 'admin') return null;
  const parsed = parseSectionOverrides(v);
  if (!parsed) return null;
  for (const k of Object.keys(parsed)) if (BY_KEY.get(k)?.group === 'Admin') return null;
  return { role: role as AccessRole, overrides: parsed };
}

export type AccessDecision = { allowed: true } | { allowed: false; section: AppSection };

/** Proxy decision for a path given the denied set. Unregistered paths are allowed (other gates still apply). */
export function checkPath(pathname: string, denied: readonly string[]): AccessDecision {
  if (!denied.length) return { allowed: true };
  if (pathname.startsWith('/api/')) {
    const owners = sectionsForApi(pathname);
    if (!owners.length || owners.some((s) => !denied.includes(s.key))) return { allowed: true };
    return { allowed: false, section: owners[0] };
  }
  const s = sectionForPage(pathname);
  if (!s || !denied.includes(s.key)) return { allowed: true };
  return { allowed: false, section: s };
}

/** Validate an overrides payload from the admin UI. */
export function parseSectionOverrides(v: unknown): SectionOverrides | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const out: SectionOverrides = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    const s = BY_KEY.get(k);
    if (!s || typeof val !== 'boolean') return null;
    if (s.alwaysOn) continue; // nothing to override
    out[k] = val;
  }
  return out;
}
