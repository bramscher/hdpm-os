import { getSupabaseAdmin } from '@/lib/supabase';
import { loadTripwireSnapshot } from '@/lib/maintenance/tripwire-engine';
import { tripwire11, statusSinceFor } from '@/lib/maintenance/tripwires';
import { businessDaysBetween, daysBetween } from '@/lib/maintenance/business-days';
import { DASHBOARD_THRESHOLDS, isOverThreshold } from '@/lib/maintenance/dashboard-thresholds';
import type { MaintWorkOrder, TripwireSnapshot } from '@/lib/maintenance/types';
import { createHash } from 'node:crypto';
import { getDashboardConfig } from '@/lib/dashboard-config';
import { classifyPool, buildVendorChaseDraft, buildVendorChaseSms, buildOwnerApprovalDraft } from './estimate-chaser';

export interface FollowupCandidate {
  eligible?: boolean; id: string; property: string; unit: string; woNumber: string; vendor: string;
  description: string; age: number; kind: 'vendor' | 'owner' | 'decision' | 'schedule';
  decisionMaker?: string; approvalRequestedAt?: string; totalAge?: number; legacyActivity?: string;
  episodeKey?: string; newEpisode?: boolean;
  owner?: string; sourceStatus?: string; statusSince?: string; sourceUpdatedAt?: string; nextActionDate?: string | null;
  appfolioLink?: string | null; assignedTo?: string | null; priority?: string | null; contextVersion?: string;
  estimate?: {id: string; total: number | null; status: string; version: number | null};
  reason: string; email: string; phone: string; subject: string; emailBody: string; smsBody: string;
}
export interface FollowupReview {
  work_order_id: string; status: 'review' | 'snoozed' | 'dismissed' | 'sending' | 'sent' | 'uncertain' | 'help';
  episode_key?: string | null; version: number; next_review_at: string | null; note: string; updated_by: string;
  channel: 'email' | 'sms_zoom' | null; recipient: string | null; subject: string | null;
  body: string | null; updated_at: string; error: string | null;
}
export async function gatherFollowups(): Promise<FollowupCandidate[]> {
  const snapshot = await loadTripwireSnapshot();
  const config = await getDashboardConfig();
  const now = new Date();
  const { candidates } = classifyPool(tripwire11(snapshot), new Map(snapshot.openWorkOrders.map(w => [w.id, w])), config.internalVendorIds,
    new Map(snapshot.openWorkOrders.map(w => [w.id, daysBetween(statusSinceFor(w, snapshot), now)])));
  const scheduling = schedulingFollowups(snapshot);
  const vendorIds = [...new Set([...candidates.flatMap(c => c.vendorId ? [c.vendorId] : []), ...scheduling.flatMap(c => c.vendor_id ? [c.vendor_id] : [])])];
  const db = getSupabaseAdmin();
  const contacts = vendorIds.length ? await db.from('zoom_contact_map').select('appfolio_id,email,phone').eq('contact_type', 'vendor').eq('active', true).in('appfolio_id', vendorIds) : { data: [], error: null };
  if (contacts.error) throw new Error(contacts.error.message);
  const owners = new Set(snapshot.approvals.filter(a => a.kind === 'OWNER' && !a.decided_at).map(a => a.work_order_id));
  const rows: FollowupCandidate[] = candidates.filter(c => snapshot.openWorkOrders.find(w=>w.id===c.workOrderId)?.status==='open').map(c => {
    const kind = c.kind === 'vendor_chase' ? 'vendor' : owners.has(c.workOrderId) ? 'owner' : 'decision';
    const contact = kind === 'vendor' ? contacts.data?.find(v => v.appfolio_id === c.vendorId) : null;
    const draft = kind === 'vendor' ? buildVendorChaseDraft(c, contact?.email || null, 1, 'High Desert team') : buildOwnerApprovalDraft({ ...c, ownerName: 'there' }, 1, 'High Desert team');
    return {
      id: c.workOrderId, property: c.propertyName || 'Unknown property', unit: c.unitName || '', woNumber: c.woNumber || '', vendor: c.vendorName || '',
      description: c.description || '', age: c.ageBusinessDays, kind,
      reason: kind === 'vendor' ? `Vendor bid outstanding for ${c.ageBusinessDays} business days.` : kind === 'owner' ? `Owner approval pending for ${c.ageBusinessDays} business days.` : 'Estimate received. Confirm who needs to make the next decision before following up.',
      email: contact?.email || '', phone: contact?.phone || '', subject: kind === 'decision' ? `Estimate follow-up — WO ${c.woNumber || c.workOrderId}` : draft.subject,
      emailBody: kind === 'decision' ? '' : draft.text,
      smsBody: kind === 'vendor' ? buildVendorChaseSms(c, 1, 'High Desert team') : kind === 'owner' ? `Hi, this is High Desert Property Management. Following up on the repair estimate for ${c.propertyAddress || c.propertyName}${c.unitName ? `, Unit ${c.unitName}` : ''}. Could you reply with your decision or any questions? Thank you.` : '',
    } satisfies FollowupCandidate;
  });
  for (const wo of scheduling) {
    if (rows.some(c => c.id === wo.id)) continue;
    const contact = contacts.data?.find(v => v.appfolio_id === wo.vendor_id);
    const internal = !wo.vendor_id || config.internalVendorIds.includes(wo.vendor_id);
    const text = `Hello, this is High Desert Property Management. Could you confirm the planned service date for WO ${wo.wo_number || ''} at ${wo.property_address || wo.property_name}${wo.unit_name ? `, Unit ${wo.unit_name}` : ''}? Please reply with the date or any scheduling blockers. Thank you.`;
    rows.push({ id: wo.id, property: wo.property_name, unit: wo.unit_name || '', woNumber: wo.wo_number || '', vendor: wo.vendor_name || '',
      description: wo.description, age: businessDaysBetween(statusSinceFor(wo, snapshot), now), kind: 'schedule',
      reason: wo.appfolio_status?.toLowerCase()==='new' ? 'New work needs assignment and a scheduling decision.' : internal ? 'Assigned work needs an internal scheduling decision.' : 'Assigned work still needs a service date.',
      email: internal ? '' : contact?.email || '', phone: internal ? '' : contact?.phone || '',
      subject: `Scheduling follow-up — WO ${wo.wo_number || wo.id}`, emailBody: internal ? '' : text, smsBody: internal ? '' : text });
  }
  for(const approval of snapshot.approvals) {
    if(approval.kind!=='OWNER'||approval.decided_at||!isOverThreshold(DASHBOARD_THRESHOLDS.owner_approval,new Date(approval.requested_at),now))continue;
    const wo=snapshot.openWorkOrders.find(w=>w.id===approval.work_order_id&&w.status==='open');if(!wo)continue;
    const prior=rows.findIndex(c=>c.id===wo.id);
    const text=`Hello, this is High Desert Property Management. Following up on the repair estimate for ${wo.property_address||wo.property_name}${wo.unit_name?`, Unit ${wo.unit_name}`:''}. Could you reply with your decision or any questions? Thank you.`;
    const candidate:FollowupCandidate={id:wo.id,property:wo.property_name,unit:wo.unit_name||'',woNumber:wo.wo_number||'',vendor:wo.vendor_name||'',description:wo.description,age:businessDaysBetween(new Date(approval.requested_at),now),kind:'owner',reason:'Recorded owner decision requested.',email:'',phone:'',subject:`Owner decision — WO ${wo.wo_number||wo.id}`,emailBody:text,smsBody:text};
    if(prior>=0)rows[prior]=candidate;else rows.push(candidate);
  }
  const ids = rows.map(r => r.id);
  const estimates: Record<string, any>[] = [];
  for (let i = 0; i < ids.length; i += 150) {
    const {data, error} = await db.from('estimate').select('id,work_order_id,status,current_version_id,updated_at').in('work_order_id', ids.slice(i,i+150)).not('status','in','(void,declined,superseded)').order('updated_at',{ascending:false});
    if (error) throw new Error(`Linked estimate data unavailable: ${error.message}`);
    estimates.push(...(data || []));
  }
  const versions: Record<string, any>[] = [];
  const versionIds = estimates.flatMap(e => e.current_version_id ? [e.current_version_id] : []);
  for (let i = 0; i < versionIds.length; i += 150) {
    const {data,error} = await db.from('estimate_version').select('id,owner_total,version_number').in('id', versionIds.slice(i,i+150));
    if(error) throw new Error(error.message); versions.push(...(data||[]));
  }
  return rows.map(c => {
    const wo = snapshot.openWorkOrders.find(w => w.id === c.id)!;
    const est = estimates.find(e => e.work_order_id === c.id); const version = versions.find(v => v.id === est?.current_version_id);
    const approval = snapshot.approvals.find(a => a.work_order_id === c.id && a.kind === 'OWNER' && !a.decided_at);
    if(c.kind === 'owner' && approval) {
      c.age = businessDaysBetween(new Date(approval.requested_at), now);
      c.reason = `Owner approval requested ${c.age} business days ago; confirm the recipient before following up.`;
      if(!isOverThreshold(DASHBOARD_THRESHOLDS.owner_approval, new Date(approval.requested_at), now)) c.eligible = false;
    }
    const enriched = {...c, owner: wo.owner_name || 'Unassigned', sourceStatus: wo.appfolio_status || 'Unknown',
      statusSince: (c.kind === 'owner' && approval ? new Date(approval.requested_at) : statusSinceFor(wo,snapshot)).toISOString(),
      sourceUpdatedAt: wo.synced_at, nextActionDate: wo.next_action_date, assignedTo: wo.assigned_to,
      priority: wo.priority_class, appfolioLink: wo.appfolio_link, totalAge:daysBetween(new Date(wo.appfolio_created_at||wo.created_at),now),decisionMaker:approval?.requested_of,approvalRequestedAt:approval?.requested_at,
      ...(est ? {estimate: {id:est.id,total:version ? Number(version.owner_total) : null,status:est.status,version:version?.version_number ?? null}} : {})};
    // Stable source fingerprint: regular polling alone must not invalidate an open review.
    return {...enriched, episodeKey: createHash('sha256').update(JSON.stringify([c.kind,enriched.statusSince,wo.appfolio_status,est?.current_version_id,approval?.id])).digest('hex').slice(0,24), contextVersion: createHash('sha256').update(JSON.stringify([c.kind,wo.appfolio_status,wo.vendor_id,wo.description,wo.owner_name,wo.next_action_date,wo.scheduled_start,est?.current_version_id,est?.status,approval?.id])).digest('hex').slice(0,24)};
  }).sort((a,b) => Number(b.priority === 'P1') - Number(a.priority === 'P1') || b.age-a.age);
}

export function schedulingFollowups(snapshot: TripwireSnapshot): MaintWorkOrder[] {
  return snapshot.openWorkOrders.filter(wo => wo.status === 'open' && ['new','assigned'].includes(wo.appfolio_status?.toLowerCase()||'') && !wo.scheduled_start
    && isOverThreshold(wo.appfolio_status?.toLowerCase()==='new'?DASHBOARD_THRESHOLDS.new:DASHBOARD_THRESHOLDS.assigned, statusSinceFor(wo, snapshot), snapshot.now));
}

export function validateFollowupMessage(input: Record<string, unknown>): { channel: 'email' | 'sms_zoom'; recipient: string; body: string; subject: string } {
  const channel = input.channel;
  const recipient = typeof input.recipient === 'string' ? input.recipient.trim() : '';
  const body = typeof input.body === 'string' ? input.body.trim() : '';
  const subject = typeof input.subject === 'string' ? input.subject.trim() : '';
  if (channel !== 'email' && channel !== 'sms_zoom') throw new Error('Choose email or text');
  if (channel === 'email' ? !/^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(recipient) : !/^\+[1-9]\d{7,14}$/.test(recipient)) throw new Error(channel === 'email' ? 'Enter one valid email address' : 'Enter a phone number with country code, such as +15415551234');
  if (!body || body.length > (channel === 'email' ? 10000 : 1600)) throw new Error('Enter a message within the length limit');
  if (channel === 'email' && (!subject || subject.length > 200 || /[\r\n]/.test(subject))) throw new Error('Enter an email subject under 200 characters');
  return { channel, recipient, body, subject };
}
