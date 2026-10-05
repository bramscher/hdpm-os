import type { AppFolioTenant } from './appfolio';

export interface RecipientTenant {
  name: string;
  email: string | null;
  phone: string | null;
  financially_responsible: boolean;
  primary: boolean;
  move_in: string | null;
  move_out: string | null;
}

export interface RecipientCheck {
  id: string;
  tenants: RecipientTenant[];
  warnings: string[];
}

export interface RecipientCheckInput {
  id: string;
  appfolio_unit_id: string | null;
  target_date: string | null;
  resident_name: string | null;
  email: string | null;
}

const norm = (value: string | null | undefined) => (value || '').trim().toLowerCase();

/**
 * Compare each notice's scheduled-time contact with AppFolio's tenants right now,
 * so staff tick the right people in AppFolio. Pure: callers pass the tenant list.
 */
export function checkRecipients(notices: RecipientCheckInput[], tenants: AppFolioTenant[], today: string): RecipientCheck[] {
  const byUnit = new Map<string, AppFolioTenant[]>();
  for (const t of tenants) {
    if (!t.unitId) continue;
    if (norm(t.status) === 'past') continue;
    if (t.moveOutOn && t.moveOutOn < today) continue;
    byUnit.set(t.unitId, [...(byUnit.get(t.unitId) || []), t]);
  }

  return notices.map((n) => {
    const warnings: string[] = [];
    if (!n.appfolio_unit_id) {
      return { id: n.id, tenants: [], warnings: ['Not linked to an AppFolio unit — check the unit in AppFolio by address.'] };
    }
    const unitTenants = byUnit.get(n.appfolio_unit_id) || [];
    const list: RecipientTenant[] = unitTenants
      .map((t) => ({
        name: `${t.firstName} ${t.lastName}`.trim() || 'Unnamed tenant',
        email: t.email,
        phone: t.phone,
        financially_responsible: norm(t.tenantType) === 'financially responsible',
        primary: t.isPrimary,
        move_in: t.moveInOn,
        move_out: t.moveOutOn,
      }))
      .sort((a, b) => Number(b.primary) - Number(a.primary) || Number(b.financially_responsible) - Number(a.financially_responsible));

    const current = list.filter((t) => !t.move_in || !n.target_date || t.move_in <= n.target_date);
    if (current.length === 0) warnings.push('No current tenant in AppFolio — the unit may be vacant. Don\'t send; check the route.');
    for (const t of list) {
      if (t.move_out && n.target_date && t.move_out <= n.target_date) warnings.push(`${t.name} moves out ${t.move_out}, on or before the inspection.`);
      if (t.move_in && n.target_date && t.move_in > n.target_date) warnings.push(`${t.name} moves in ${t.move_in}, after the inspection — don't notify them for this date.`);
    }
    const names = list.map((t) => norm(t.name));
    const emails = list.map((t) => norm(t.email));
    const nameChanged = n.resident_name && !names.includes(norm(n.resident_name));
    const emailChanged = n.email && !emails.includes(norm(n.email));
    if (list.length > 0 && (nameChanged || emailChanged)) {
      warnings.push(`Tenant changed since scheduling (was ${[n.resident_name, n.email].filter(Boolean).join(', ')}).`);
    }
    if (current.length > 0 && !current.some((t) => t.email)) warnings.push('No email on file for any current tenant — call or post the notice.');
    return { id: n.id, tenants: list, warnings };
  });
}
