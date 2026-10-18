/**
 * Dispatch week strip writes. A drop on a tech's day adds the work order to that
 * tech's DRAFT route for the day (Brody still publishes from the Route Builder);
 * a drop on the Vendors row puts a date on the board's vendor plan, and the card
 * nudges staff to set the same date in AppFolio. Each work order succeeds or
 * fails on its own.
 */

import { getSupabaseAdmin } from '@/lib/supabase';
import { recordEvent } from './events';
import { DISPATCH_TECHS, addDays, isInternalVendor, vendorDateIso, type TechDay } from './dispatch';
import { liveBoardPlan, removeFromDrafts, tidyDrafts, withdrawPlans, type DispatchResult } from './dispatch-db';
import { updateWorkOrderWorkflow, WorkflowValidationError } from './workflow-db';
import type { MaintWorkOrder, VendorAssignment } from './types';

/** Same cap as a published day (validatePublish). */
export const MAX_STOPS_PER_DAY = 40;

export type ScheduleRow = { kind: 'tech'; person: string } | { kind: 'vendor' };

export function parseScheduleRow(raw: unknown): ScheduleRow | null {
  const r = raw as Record<string, unknown> | null;
  if (!r || typeof r !== 'object') return null;
  if (r.kind === 'vendor') return { kind: 'vendor' };
  if (r.kind === 'tech' && typeof r.person === 'string') {
    const person = DISPATCH_TECHS.find((p) => p.toLowerCase() === (r.person as string).toLowerCase());
    return person ? { kind: 'tech', person } : null;
  }
  return null;
}

const dayLabel = (date: string) =>
  new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'short', month: 'numeric', day: 'numeric' });

/** Draft and published tech days from `start` for `days` days, with their work orders in stop order. */
export async function loadTechDays(start: string, days = 7): Promise<TechDay[]> {
  const db = getSupabaseAdmin();
  const { data: plans, error } = await db
    .from('maint_route_plan')
    .select('id,route_date,assigned_tech,status')
    .gte('route_date', start)
    .lte('route_date', addDays(start, days - 1))
    .in('status', ['draft', 'published']);
  if (error) throw new Error(error.message);
  if (!plans?.length) return [];
  const { data: stops, error: stopsError } = await db
    .from('maint_route_stop')
    .select('route_plan_id,work_order_id,stop_order,service_minutes')
    .in('route_plan_id', plans.map((p) => p.id))
    .order('stop_order');
  if (stopsError) throw new Error(stopsError.message);
  return plans.map((p) => {
    const mine = (stops ?? []).filter((s) => s.route_plan_id === p.id);
    return {
      plan_id: p.id,
      date: p.route_date,
      tech: p.assigned_tech ?? '',
      status: p.status as TechDay['status'],
      work_order_ids: mine.map((s) => s.work_order_id),
      service_minutes: mine.reduce((n, s) => n + (s.service_minutes ?? 45), 0),
    };
  });
}

async function planFor(date: string, tech: string, status: 'draft' | 'published') {
  const { data, error } = await getSupabaseAdmin()
    .from('maint_route_plan')
    .select('id')
    .eq('route_date', date)
    .ilike('assigned_tech', tech)
    .eq('status', status)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data?.id as string | undefined) ?? null;
}

async function getOrCreateDraft(date: string, tech: string, actor: string): Promise<string> {
  const existing = await planFor(date, tech, 'draft');
  if (existing) return existing;
  const { data, error } = await getSupabaseAdmin()
    .from('maint_route_plan')
    .insert({ route_date: date, assigned_tech: tech, status: 'draft', created_by: actor })
    .select('id')
    .single();
  if (data) return data.id as string;
  // Someone else made it a moment ago (one draft per tech per day).
  const raced = await planFor(date, tech, 'draft');
  if (raced) return raced;
  throw new Error(error?.message || 'Could not start the draft day');
}

const failAll = (ids: string[], error: string): DispatchResult[] => ids.map((id) => ({ id, ok: false, error }));

async function loadWos(ids: string[]): Promise<Map<string, MaintWorkOrder>> {
  const { data, error } = await getSupabaseAdmin().from('work_orders').select('*').in('id', ids);
  if (error) throw new Error(error.message);
  return new Map(((data ?? []) as MaintWorkOrder[]).map((w) => [w.id, w]));
}

async function scheduleTech(ids: string[], person: string, date: string, actor: string): Promise<DispatchResult[]> {
  if (await planFor(date, person, 'published')) {
    return failAll(ids, `${person}'s ${dayLabel(date)} is already published. Change it in Route Builder.`);
  }
  const db = getSupabaseAdmin();
  const planId = await getOrCreateDraft(date, person, actor);
  const touched = [planId, ...(await removeFromDrafts(ids, planId))];

  const { data: existingStops, error } = await db
    .from('maint_route_stop')
    .select('work_order_id,stop_order')
    .eq('route_plan_id', planId);
  if (error) throw new Error(error.message);
  const onDay = new Set((existingStops ?? []).map((s) => s.work_order_id as string));
  let nextOrder = Math.max(0, ...(existingStops ?? []).map((s) => s.stop_order as number)) + 1;

  const wos = await loadWos(ids);
  const results: DispatchResult[] = [];
  for (const id of ids) {
    let wo = wos.get(id);
    if (!wo) {
      results.push({ id, ok: false, error: 'Work order not found' });
      continue;
    }
    try {
      if (!onDay.has(id)) {
        if (onDay.size >= MAX_STOPS_PER_DAY) throw new Error(`A day can have at most ${MAX_STOPS_PER_DAY} stops`);
        const { error: insError } = await db.from('maint_route_stop').insert({
          route_plan_id: planId,
          work_order_id: id,
          stop_order: nextOrder++,
          address: wo.property_address || wo.property_name || 'Address to confirm',
        });
        if (insError) throw new Error(insError.message);
        onDay.add(id);
      }
      await withdrawPlans(id, actor);
      if (wo.assigned_tech !== person || wo.next_action_date !== date) {
        wo = (await updateWorkOrderWorkflow(id, { assigned_tech: person, next_action_date: date }, actor)).workOrder;
      }
      await recordEvent({ work_order_id: id, event_type: 'schedule', payload: { draft_day: date, tech: person, via: 'dispatch_board' }, actor });
      results.push({ id, ok: true, workOrder: wo, plan: null });
    } catch (e) {
      results.push({ id, ok: false, error: e instanceof WorkflowValidationError ? e.errors.join('; ') : e instanceof Error ? e.message : 'Failed' });
    }
  }
  await tidyDrafts(touched);
  return results;
}

async function scheduleVendor(ids: string[], date: string | null, actor: string): Promise<DispatchResult[]> {
  const db = getSupabaseAdmin();
  const wos = await loadWos(ids);
  const results: DispatchResult[] = [];
  for (const id of ids) {
    let wo = wos.get(id);
    if (!wo) {
      results.push({ id, ok: false, error: 'Work order not found' });
      continue;
    }
    try {
      let plan = await liveBoardPlan(id);
      if (!plan && date) {
        if (wo.assigned_tech || isInternalVendor(wo)) throw new Error("In-house work goes on Alberto's or Brody's row");
        if (!wo.vendor_id) throw new Error('Assign a vendor first, then give it a date');
        const { data: vendor } = await db.from('vendor').select('id').eq('appfolio_vendor_id', wo.vendor_id).maybeSingle();
        if (!vendor) throw new Error(`${wo.vendor_name ?? 'This vendor'} isn't in the vendor list yet. Set the date in AppFolio.`);
        // A plan for the vendor AppFolio already has: it only carries the date.
        const { data, error } = await db
          .from('vendor_assignment')
          .insert({ work_order_id: id, vendor_id: vendor.id, created_by: actor, source: 'board', af_vendor_at_plan: wo.vendor_id })
          .select('*')
          .single();
        if (error || !data) throw new Error(error?.message || 'Could not save the vendor date');
        plan = data as VendorAssignment;
      }
      if (!plan) {
        results.push({ id, ok: true, workOrder: wo, plan: null });
        continue;
      }
      const { data: updated, error } = await db
        .from('vendor_assignment')
        .update({ scheduled_at: date ? vendorDateIso(date) : null })
        .eq('id', plan.id)
        .select('*')
        .single();
      if (error || !updated) throw new Error(error?.message || 'Could not save the vendor date');
      if (date && wo.next_action_date !== date) {
        wo = (await updateWorkOrderWorkflow(id, { next_action_date: date }, actor)).workOrder;
      }
      await recordEvent({ work_order_id: id, event_type: 'schedule', payload: { vendor_date: date, assignment_id: plan.id, via: 'dispatch_board' }, actor });
      results.push({ id, ok: true, workOrder: wo, plan: updated as VendorAssignment });
    } catch (e) {
      results.push({ id, ok: false, error: e instanceof WorkflowValidationError ? e.errors.join('; ') : e instanceof Error ? e.message : 'Failed' });
    }
  }
  return results;
}

/**
 * Put work orders on a day (or take them off with date = null).
 * Tech row: draft route for that tech and day. Vendors row: the date on the vendor plan.
 */
export async function scheduleWorkOrders(
  ids: string[],
  row: ScheduleRow,
  date: string | null,
  actor: string,
): Promise<DispatchResult[]> {
  if (row.kind === 'vendor') return scheduleVendor(ids, date, actor);
  if (date) return scheduleTech(ids, row.person, date, actor);
  // Off the strip: leave the tech on it, just drop it from any draft day.
  const touched = await removeFromDrafts(ids);
  await tidyDrafts(touched);
  return ids.map((id) => ({ id, ok: true }));
}
