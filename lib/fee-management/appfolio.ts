/**
 * Fee Management — read-only AppFolio v0 pull of the property facts and
 * current owner sets the owner rollup is built from. Never writes to AppFolio.
 *
 * Sources (verified live 2026-09-24): /properties (fee policy, management
 * start), /units (doors, occupancy, market rent), /owner_groups (Current group
 * per property → Owners[] with PercentOwned + contact), /owners (primary
 * email/phone lists).
 */

import { getKpiConfig, v0FetchAll } from '@/lib/appfolio-kpi';
import type { FeeFacts, OwnerContact, OwnerSet, PropertyFact } from './model';

interface V0Property {
  Id: string;
  Name?: string | null;
  Address1?: string | null;
  City?: string | null;
  HiddenAt?: string | null;
  ManagementStartDate?: string | null;
  ManagementEndDate?: string | null;
  CurrentManagementFeePolicy?: {
    FeeType?: string | null;
    Percentage?: string | null;
    FlatAmount?: string | null;
    StartDate?: string | null;
  } | null;
}

interface V0Unit {
  PropertyId?: string;
  HiddenAt?: string | null;
  NonRevenue?: boolean;
  CurrentOccupancyId?: string | null;
  MarketRent?: string | null;
}

interface V0GroupOwner {
  OwnerId?: string;
  Id?: string;
  FirstName?: string | null;
  LastName?: string | null;
  CompanyName?: string | null;
  IsCompany?: boolean;
  Email?: string | null;
  PhoneNumber?: string | null;
  PercentOwned?: string | null;
}

interface V0OwnerGroup {
  Current: boolean;
  PropertyId: string | null;
  Owners?: V0GroupOwner[];
}

interface V0Owner {
  Id: string;
  HiddenAt?: string | null;
  Email?: string | null;
  Emails?: { EmailAddress?: string; IsPrimary?: boolean }[];
  PhoneNumber?: string | null;
  PhoneNumbers?: { Number?: string; IsPrimary?: boolean }[];
}

const ALL = { 'filters[LastUpdatedAtFrom]': '1970-01-01T00:00:00Z' };

function ownerName(o: V0GroupOwner): string {
  const person = [o.FirstName, o.LastName].filter(Boolean).join(' ').trim();
  return ((o.IsCompany ? o.CompanyName || person : person || o.CompanyName) || 'Unknown owner').trim();
}

function primary<T extends { IsPrimary?: boolean }>(list: T[] | undefined): T | undefined {
  return list?.find((x) => x.IsPrimary) ?? list?.[0];
}

export async function fetchFeeFacts(): Promise<FeeFacts> {
  const config = getKpiConfig();
  if (!config) throw new Error('AppFolio API credentials not configured');

  // Sequential, not parallel: the v0 API 429s readily and the KPI cron may be
  // running at the same time.
  const properties = await v0FetchAll<V0Property>('/properties', ALL, config, 1000, 10);
  const units = await v0FetchAll<V0Unit>('/units', ALL, config, 1000, 20);
  const groups = await v0FetchAll<V0OwnerGroup>('/owner_groups', ALL, config, 1000, 20);
  const owners = await v0FetchAll<V0Owner>('/owners', ALL, config, 1000, 10);

  const active = properties.filter((p) => !p.HiddenAt && !p.ManagementEndDate);
  const activeIds = new Set(active.map((p) => p.Id));
  const ownerById = new Map(owners.map((o) => [o.Id, o]));

  // Current owner group per property → owner set.
  const setKeyByProperty = new Map<string, string>();
  const sets = new Map<string, OwnerSet>();
  for (const g of groups) {
    if (!g.Current || !g.PropertyId || !activeIds.has(g.PropertyId)) continue;
    const contacts: OwnerContact[] = (g.Owners ?? [])
      .map((o) => {
        const id = o.OwnerId ?? o.Id ?? '';
        const rec = ownerById.get(id);
        const email = primary(rec?.Emails)?.EmailAddress || rec?.Email || o.Email || null;
        const phone = primary(rec?.PhoneNumbers)?.Number || rec?.PhoneNumber || o.PhoneNumber || null;
        const pct = o.PercentOwned != null ? parseFloat(o.PercentOwned) : NaN;
        return { id, name: ownerName(o), email, phone, percentOwned: Number.isFinite(pct) ? pct : null };
      })
      .filter((o) => o.id)
      .sort((a, b) => a.id.localeCompare(b.id));
    if (!contacts.length) continue;
    const key = contacts.map((o) => o.id).join('+');
    setKeyByProperty.set(g.PropertyId, key);
    if (!sets.has(key)) sets.set(key, { key, name: contacts.map((o) => o.name).join(' & '), owners: contacts });
  }

  const unitAgg = new Map<string, { doors: number; occupied: number; rent: number }>();
  for (const u of units) {
    if (u.HiddenAt || u.NonRevenue || !u.PropertyId || !activeIds.has(u.PropertyId)) continue;
    const a = unitAgg.get(u.PropertyId) ?? { doors: 0, occupied: 0, rent: 0 };
    a.doors++;
    if (u.CurrentOccupancyId) {
      a.occupied++;
      const rent = u.MarketRent != null ? parseFloat(u.MarketRent) : NaN;
      if (Number.isFinite(rent)) a.rent += rent;
    }
    unitAgg.set(u.PropertyId, a);
  }

  const facts: PropertyFact[] = [];
  for (const p of active) {
    const policy = p.CurrentManagementFeePolicy;
    const pct = policy?.Percentage != null ? parseFloat(policy.Percentage) : NaN;
    const flat = policy?.FlatAmount != null ? parseFloat(policy.FlatAmount) : NaN;
    const isPct = policy?.FeeType === 'Percent' && Number.isFinite(pct) && pct > 0;
    const isFlat = !isPct && policy?.FeeType === 'Flat' && Number.isFinite(flat);
    const agg = unitAgg.get(p.Id) ?? { doors: 0, occupied: 0, rent: 0 };
    facts.push({
      id: p.Id,
      name: p.Name || p.Address1 || p.Id,
      address: [p.Address1, p.City].filter(Boolean).join(', '),
      feeType: isPct ? 'percent' : isFlat ? 'flat' : 'none',
      feePct: isPct ? pct : null,
      flatMonthly: isFlat ? flat : null,
      feeStartDate: policy?.StartDate ?? null,
      mgmtStartDate: p.ManagementStartDate ?? null,
      doors: agg.doors,
      occupiedDoors: agg.occupied,
      occupiedRentMonthly: Math.round(agg.rent * 100) / 100,
      // Properties with no current owner group still show, as their own set.
      ownerSetKey: setKeyByProperty.get(p.Id) ?? `unlinked:${p.Id}`,
    });
  }
  for (const f of facts) {
    if (f.ownerSetKey.startsWith('unlinked:') && !sets.has(f.ownerSetKey)) {
      sets.set(f.ownerSetKey, { key: f.ownerSetKey, name: `${f.name} (no owner on file)`, owners: [] });
    }
  }

  return { properties: facts, ownerSets: [...sets.values()] };
}
