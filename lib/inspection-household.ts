import type { AppFolioPet, AppFolioTenant } from '@/lib/appfolio';

export interface InspectionHousehold {
  financiallyResponsibleOccupants: string[] | null;
  pets: AppFolioPet[] | null;
}

/** Receives the unit's active tenants from the candidate join. */
export function collectInspectionHousehold(tenants: AppFolioTenant[]): InspectionHousehold {
  const uniqueTenants = [...new Map(tenants.map(t => [t.id, t])).values()];
  const financiallyResponsibleOccupants = uniqueTenants.some(t => !t.tenantType)
    ? null
    : uniqueTenants
      .filter(t => t.tenantType?.trim().toLowerCase() === 'financially responsible')
      .map(t => `${t.firstName} ${t.lastName}`.trim())
      .filter(Boolean);
  // AppFolio can repeat the household's pets on multiple tenant records.
  const pets = uniqueTenants.some(t => t.pets == null)
    ? null
    : [...new Map(uniqueTenants.flatMap(t => t.pets ?? []).map(p => [JSON.stringify(p), p])).values()];
  return { financiallyResponsibleOccupants, pets };
}

export function formatInspectionPets(pets: AppFolioPet[] | null | undefined): string {
  if (pets == null) return 'Not available';
  if (!pets.length) return 'None recorded';
  return pets.map(p => [p.name || 'Unnamed pet', p.type, p.age == null ? '' : `Age: ${p.age}`, p.weight == null ? '' : `Weight: ${p.weight} lb`].filter(Boolean).join(' — ')).join('; ');
}

export function formatInspectionOccupants(names: string[] | null | undefined): string {
  return names == null ? 'Not available' : names.length ? names.join(', ') : 'None recorded';
}

export function escapeInspectionHtml(value: string): string {
  return value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
