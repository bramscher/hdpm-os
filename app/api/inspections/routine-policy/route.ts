import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getSupabaseAdmin } from '@/lib/supabase';
import { loadInspectionQueue } from '@/lib/inspection-queue';
import { findHouseholdSource } from '@/lib/inspection-route-households';

export async function PATCH(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.email?.endsWith('@highdesertpm.com')) return NextResponse.json({error:'Unauthorized'}, {status:401});
    const {property_ids, enabled} = await request.json();
    if (typeof enabled !== 'boolean' || !Array.isArray(property_ids) || !property_ids.length || property_ids.length > 2000 || property_ids.some(id => typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id))) {
      return NextResponse.json({error:'Select properties and specify whether routine inspections are enabled.'}, {status:400});
    }
    const db = getSupabaseAdmin();
    const {rows, properties} = await loadInspectionQueue(db);
    const ids = new Set<string>(property_ids);
    // Apply the policy to the selected unit and any reliably matched legacy import.
    for (const row of rows) {
      if (!ids.has(row.property_id) || !row.inspection_properties) continue;
      const source = findHouseholdSource(row.inspection_properties, properties, row.resident_name);
      if (source?.id) ids.add(source.id);
    }
    for (const row of rows) {
      if (!row.inspection_properties) continue;
      const source = findHouseholdSource(row.inspection_properties, properties, row.resident_name);
      if (source?.id && ids.has(source.id)) ids.add(row.property_id);
    }
    const {data,error} = await db.from('inspection_properties').update({routine_inspections_enabled:enabled}).in('id',[...ids]).select('id');
    if (error) throw error;
    return NextResponse.json({success:true,updated:data?.length || 0,enabled});
  } catch (error) {
    return NextResponse.json({error:error instanceof Error ? error.message : 'Failed to update routine inspection policy'}, {status:500});
  }
}
