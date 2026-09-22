import { getSupabaseAdmin } from './supabase';
import { CAPABILITIES, type Capabilities } from './staff-capabilities';
export async function loadStaffCapabilities(email: string): Promise<Capabilities> {
 const {data,error}=await getSupabaseAdmin().rpc('staff_effective_capabilities',{identity:email});
 if(error)throw new Error('Unable to load staff permissions');
 return Object.fromEntries(CAPABILITIES.map(({key})=>[key,data?.[key]===true])) as Capabilities;
}
