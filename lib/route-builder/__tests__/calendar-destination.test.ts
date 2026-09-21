import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest';
import {NextRequest} from 'next/server';
import {routeCalendarAttendees,routeCalendarEventUrl,storeRouteCalendarEventId,ROUTE_CALENDAR_EVENTS_URL} from '../calendar-destination';
import {createRouteCalendarEvent,deleteRouteCalendarEvent} from '@/lib/maintenance/route-calendar';
const state=vi.hoisted(()=>({email:'craig@highdesertpm.com',assignee:'matt@highdesertpm.com',writes:[] as any[]}));
vi.mock('@/lib/auth',()=>({auth:async()=>({user:{email:state.email},accessToken:'test-token'})}));
vi.mock('@/lib/supabase',()=>({getSupabaseAdmin:()=>({from:(table:string)=>{const q:any={};q.select=q.eq=()=>q;q.single=async()=>({data:{id:'route',assigned_to:state.assignee,route_date:'2026-09-22',total_drive_minutes:10,total_service_minutes:60},error:null});q.order=async()=>({data:[],error:null});q.update=(value:any)=>{state.writes.push(value);return q};return q;}})}));
import {POST} from '@/app/api/inspections/routes/[id]/calendar/route';
const input={routeDate:'2026-09-22',assignedTech:'Matt',totalDriveMinutes:10,totalServiceMinutes:60,stops:[]};
beforeEach(()=>{state.writes=[];vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({id:'event/1',webLink:'https://outlook.office.com/event'}),{status:201})));vi.stubEnv('INSPECTION_CALENDAR_DRYRUN','0');vi.stubEnv('MAINT_ROUTE_CALENDAR_DRYRUN','0');});
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();});
describe('route publishing destinations',()=>{
 it('only lists Brody and Operations',()=>{expect(routeCalendarAttendees().map(a=>a.emailAddress.address)).toEqual(['brody@highdesertpm.com','operations@highdesertpm.com']);});
 it.each(['craig@highdesertpm.com','matt@highdesertpm.com'])('publishes inspection routes to Operations when %s is signed in',async email=>{
  state.email=email;state.assignee=email;
  const response=await POST(new NextRequest('http://localhost/calendar',{method:'POST'}),{params:Promise.resolve({id:'route'})});
  expect(response.status).toBe(200);
  const [url,request]=vi.mocked(fetch).mock.calls[0];expect(url).toBe(ROUTE_CALENDAR_EVENTS_URL);expect(JSON.parse(request!.body as string).attendees).toEqual(routeCalendarAttendees());
  expect(state.writes).toEqual([{calendar_event_id:'operations:event/1'}]);
 });
 it('uses the same destinations for maintenance routes regardless of technician',async()=>{
  const result=await createRouteCalendarEvent(input,'token');expect(result).toMatchObject({created:true,eventId:'operations:event/1'});
  const [url,request]=vi.mocked(fetch).mock.calls[0];expect(url).toBe(ROUTE_CALENDAR_EVENTS_URL);expect(JSON.parse(request!.body as string).attendees).toEqual(routeCalendarAttendees());
 });
 it('fails without falling back to a personal calendar when shared access is denied',async()=>{
  vi.mocked(fetch).mockResolvedValue(new Response('Forbidden',{status:403}));
  const response=await POST(new NextRequest('http://localhost/calendar',{method:'POST'}),{params:Promise.resolve({id:'route'})});
  expect(response.status).toBe(403);expect((await response.json()).error).toContain('Operations calendar');expect(fetch).toHaveBeenCalledTimes(1);expect(state.writes).toEqual([]);
 });
 it('dry run sends no invites',async()=>{
  vi.stubEnv('INSPECTION_CALENDAR_DRYRUN','1');vi.stubEnv('MAINT_ROUTE_CALENDAR_DRYRUN','1');
  await POST(new NextRequest('http://localhost/calendar',{method:'POST'}),{params:Promise.resolve({id:'route'})});
  await createRouteCalendarEvent(input,'token');expect(fetch).not.toHaveBeenCalled();
 });
 it('cancels new events from Operations and retains legacy event routing',async()=>{
  expect(routeCalendarEventUrl('old/id')).toBe('https://graph.microsoft.com/v1.0/me/events/old%2Fid');
  await deleteRouteCalendarEvent(storeRouteCalendarEventId('new/id'),'token');expect(fetch).toHaveBeenCalledWith('https://graph.microsoft.com/v1.0/users/operations@highdesertpm.com/events/new%2Fid',expect.objectContaining({method:'DELETE'}));
 });
});
