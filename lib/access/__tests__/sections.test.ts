import { describe, it, expect } from 'vitest';
import { readdirSync, statSync } from 'fs';
import path from 'path';
import {
  APP_SECTIONS,
  checkPath,
  deniedSections,
  parseRoleDefaults,
  parseSectionOverrides,
  sectionAllowed,
  sectionByKey,
  sectionForPage,
  sectionsForApi,
} from '../sections';

const S = (k: string) => sectionByKey(k)!;

describe('registry integrity (guards future features)', () => {
  it('has unique keys and no page prefix claimed twice', () => {
    const keys = APP_SECTIONS.map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
    const pages = APP_SECTIONS.flatMap((s) => s.pages);
    expect(new Set(pages).size).toBe(pages.length);
  });

  it('maps every page in app/ to a section (add new pages to lib/access/sections.ts)', () => {
    const root = path.resolve(__dirname, '../../../app');
    const unmanaged = new Set(['/login', '/partners', '/r']); // public / self-guarded surfaces
    const pages: string[] = [];
    const walk = (dir: string, route: string) => {
      for (const name of readdirSync(dir)) {
        const full = path.join(dir, name);
        if (!statSync(full).isDirectory()) {
          if (name === 'page.tsx') pages.push(route || '/');
          continue;
        }
        if (name === 'api') continue;
        const seg = name.startsWith('(') ? '' : `/${name}`; // route groups add no segment
        walk(full, route + seg);
      }
    };
    walk(root, '');
    expect(pages.length).toBeGreaterThan(30); // the walk really found the app
    const isUnmanaged = (p: string) =>
      !p.startsWith('/partners/admin') && [...unmanaged].some((u) => p === u || p.startsWith(`${u}/`));
    const missing = pages.filter((p) => !isUnmanaged(p) && !sectionForPage(p));
    expect(missing).toEqual([]);
    expect(sectionForPage('/partners/admin/leads')?.key).toBe('referrals_admin');
  });

  it('every nav section has an href that resolves back to itself', () => {
    for (const s of APP_SECTIONS.filter((x) => x.nav)) {
      expect(sectionForPage(s.nav!.href)?.key, s.key).toBe(s.key);
    }
  });
});

describe('path → section', () => {
  it('uses the longest matching prefix', () => {
    expect(sectionForPage('/maintenance/inspections/routes/abc')?.key).toBe('route_builder');
    expect(sectionForPage('/maintenance/inspections')?.key).toBe('inspections');
    expect(sectionForPage('/maintenance/board')?.key).toBe('maintos');
    expect(sectionForPage('/maintenance')?.key).toBe('maintos');
    expect(sectionForPage('/admin/fee-management')?.key).toBe('fee_management');
    expect(sectionForPage('/admin')?.key).toBe('user_settings');
    expect(sectionForPage('/')?.key).toBe('home');
    expect(sectionForPage('/maintenanceX')).toBeNull(); // prefix must end at a segment
  });

  it('lets shared APIs through if any owning section is allowed', () => {
    expect(sectionsForApi('/api/turn-estimator/price-book').map((s) => s.key).sort()).toEqual(
      ['field_app', 'maintos', 'price_book', 'turns', 'work_billing'].sort()
    );
    expect(checkPath('/api/turn-estimator/price-book', ['price_book']).allowed).toBe(true);
    expect(checkPath('/api/turn-estimator/price-book', ['price_book', 'turns', 'maintos', 'work_billing', 'field_app']).allowed).toBe(false);
    expect(checkPath('/api/keys/123', ['keys']).allowed).toBe(false);
    expect(checkPath('/api/unregistered-thing', ['keys']).allowed).toBe(true);
  });

  it('blocks a denied page', () => {
    const d = checkPath('/keys/import', ['keys']);
    expect(d.allowed).toBe(false);
    expect(!d.allowed && d.section.key).toBe('keys');
    expect(checkPath('/comps', ['keys']).allowed).toBe(true);
  });
});

describe('effective access', () => {
  it('follows role defaults, then overrides', () => {
    expect(sectionAllowed(S('kpis'), 'staff', {})).toBe(false);
    expect(sectionAllowed(S('kpis'), 'staff', { kpis: true })).toBe(false); // admin-only regardless
    expect(sectionAllowed(S('keys'), 'staff', {})).toBe(true);
    expect(sectionAllowed(S('keys'), 'staff', { keys: false })).toBe(false);
  });

  it('admins default to everything but can be restricted — except User settings', () => {
    expect(deniedSections('admin', {})).toEqual([]);
    expect(sectionAllowed(S('fee_management'), 'admin', { fee_management: false })).toBe(false);
    expect(sectionAllowed(S('user_settings'), 'admin', { user_settings: false })).toBe(true);
    expect(sectionAllowed(S('home'), 'staff', { home: false })).toBe(true);
  });

  it('general staff and property managers get everything but admin', () => {
    const adminKeys = APP_SECTIONS.filter((s) => s.group === 'Admin').map((s) => s.key).sort();
    expect(deniedSections('staff', {}).sort()).toEqual(adminKeys);
    expect(deniedSections('pm', {}).sort()).toEqual(adminKeys);
    expect(deniedSections('manager', {}).sort()).toEqual(adminKeys);
  });

  it('role defaults follow the approved grid', () => {
    const on = (role: string) => APP_SECTIONS.filter((s) => sectionAllowed(s, role, {})).map((s) => s.key).sort();
    expect(on('maintenance')).toEqual(
      ['home', 'activities', 'maintos', 'work_billing', 'field_app', 'inspections', 'route_builder', 'turns', 'price_book', 'keys', 'property_map', 'company', 'timekeeping'].sort()
    );
    expect(on('field')).toEqual(['home', 'field_app', 'maintos', 'keys', 'property_map', 'company', 'timekeeping'].sort());
    expect(on('inspector')).toEqual(['home', 'inspections', 'route_builder', 'keys', 'property_map', 'company', 'timekeeping'].sort());
    expect(on('front_desk')).toEqual(['home', 'activities', 'rent_comps', 'craigslist', 'keys', 'haven', 'property_map', 'company', 'timekeeping'].sort());
    expect(on('finance')).toEqual(['home', 'activities', 'work_billing', 'maintos', 'owner_reports', 'company', 'timekeeping'].sort());
    expect(on('read_only')).toEqual(['home', 'company'].sort());
    expect(on('admin')).toEqual(APP_SECTIONS.map((s) => s.key).sort());
  });

  it('admin-edited role defaults override code defaults; person overrides win over both', () => {
    const roleOv = { maintenance: { keys: false, rent_comps: true } };
    expect(sectionAllowed(S('keys'), 'maintenance', {}, roleOv)).toBe(false);
    expect(sectionAllowed(S('rent_comps'), 'maintenance', {}, roleOv)).toBe(true);
    expect(sectionAllowed(S('keys'), 'maintenance', { keys: true }, roleOv)).toBe(true);
    // admin sections can't be granted to non-admins at any level
    expect(sectionAllowed(S('kpis'), 'pm', { kpis: true }, { pm: { kpis: true } })).toBe(false);
  });
});

describe('parseRoleDefaults', () => {
  it('accepts non-admin roles and non-admin sections only', () => {
    expect(parseRoleDefaults('maintenance', { keys: false })).toEqual({ role: 'maintenance', overrides: { keys: false } });
    expect(parseRoleDefaults('admin', { keys: false })).toBeNull();
    expect(parseRoleDefaults('wizard', { keys: false })).toBeNull();
    expect(parseRoleDefaults('pm', { kpis: true })).toBeNull();
  });
});

describe('parseSectionOverrides', () => {
  it('accepts known keys with booleans, drops always-on, rejects junk', () => {
    expect(parseSectionOverrides({ keys: false, kpis: true, home: false })).toEqual({ keys: false, kpis: true });
    expect(parseSectionOverrides({ nope: true })).toBeNull();
    expect(parseSectionOverrides({ keys: 'yes' })).toBeNull();
    expect(parseSectionOverrides([])).toBeNull();
  });
});
