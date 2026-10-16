import type { CandidateWorkOrder, Place, Point, Unit } from '../model';

/** 08:00 Pacific on Oct 7, 2026 (PDT). */
export const T0 = Date.parse('2026-10-07T15:00:00Z');
export const DATE = '2026-10-07';
export const min = (m: number) => T0 + m * 60000;

type LatLng = { lat: number; lng: number };
/** A point `north` and `east` metres from `from`. */
export const offset = (from: LatLng, north: number, east: number): LatLng => ({
  lat: from.lat + north / 111320,
  lng: from.lng + east / (111320 * Math.cos((from.lat * Math.PI) / 180)),
});

export const SHOP = { lat: 44.256798, lng: -121.184346 };
export const WEINBERGER = offset(SHOP, 3000, 1000);
export const CEDAR = offset(SHOP, -2500, 2000);
export const LOWES = offset(SHOP, 1200, -1500);
export const HOME_DEPOT = offset(SHOP, 4000, -800);
export const DUMP = offset(SHOP, 6000, 4000);

/** Fixes every `every` minutes at `at`, from minute `from` to minute `to` (inclusive). */
export function stay(at: LatLng, from: number, to: number, every = 2): Point[] {
  const out: Point[] = [];
  for (let m = from; m <= to; m += every) out.push({ t: min(m), lat: at.lat, lng: at.lng, acc: 10 });
  return out;
}
/** Fixes every 2 minutes while driving from `a` to `b` between two minutes (ends exclusive). */
export function drive(a: LatLng, b: LatLng, from: number, to: number): Point[] {
  const out: Point[] = [];
  for (let m = from + 2; m < to; m += 2) {
    const f = (m - from) / (to - from);
    out.push({ t: min(m), lat: a.lat + (b.lat - a.lat) * f, lng: a.lng + (b.lng - a.lng) * f, acc: 15 });
  }
  return out;
}

export const place = (id: string, kind: Place['kind'], at: LatLng, extra: Partial<Place> = {}): Place => ({
  id, kind, name: id, supplierId: null, lat: at.lat, lng: at.lng, radiusM: kind === 'store' ? 200 : kind === 'dump' ? 250 : 150, active: true, ...extra,
});
export const PLACES: Place[] = [
  place('shop', 'shop', SHOP, { name: 'Shop / office' }),
  place('lowes', 'store', LOWES, { name: "Lowe's Redmond" }),
  place('hd', 'store', HOME_DEPOT, { name: 'Home Depot Redmond' }),
  place('dump', 'dump', DUMP, { name: 'Negus Transfer Station' }),
];

export const unit = (id: string, propertyId: string, at: LatLng, extra: Partial<Unit> = {}): Unit => ({
  id, propertyId, unitId: `${id}-u`, name: propertyId, address: `${propertyId} address`, lat: at.lat, lng: at.lng, active: true, ...extra,
});
export const UNITS: Unit[] = [unit('u-wein', 'Weinberger 284', WEINBERGER), unit('u-cedar', 'Cedar Creek', CEDAR)];

export const wo = (id: string, propertyId: string, extra: Partial<CandidateWorkOrder> = {}): CandidateWorkOrder => ({
  id, wo_number: `${id}-1`, property_id: propertyId, unit_id: null, property_name: propertyId, assigned_to: 'Alberto Flores', assigned_tech: null,
  status: 'open', stage: null, appfolio_status: 'Assigned', created_at: '2026-10-01T16:00:00Z', completed_date: null, scheduled_start: null, canceled_date: null, ...extra,
});
export const WORK_ORDERS: CandidateWorkOrder[] = [wo('wo-wein', 'Weinberger 284'), wo('wo-cedar', 'Cedar Creek')];
