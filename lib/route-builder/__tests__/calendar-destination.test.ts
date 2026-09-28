import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest';
import {NextRequest} from 'next/server';
import {routeCalendarAttendees,routeCalendarEventUrl,storeRouteCalendarEventId,ROUTE_CALENDAR_EVENTS_URL} from '../calendar-destination';
import {createRouteCalendarEvent,deleteRouteCalendarEvent} from '@/lib/maintenance/route-calendar';
const state=vi.hoisted(()=>({email:'craig@highdesertpm.com',assignee:'matt@highdesertpm.com',startTime:null as string | null,eventId:null as string | null,writes:[] as any[]}));
vi.mock('@/lib/auth',()=>({auth:async()=>({user:{email:state.email},accessToken:'test-token'})}));
vi.mock('@/lib/supabase',()=>({getSupabaseAdmin:()=>({from:(table:string)=>{const q:any={};q.select=q.eq=()=>q;q.single=async()=>({data:{id:'route',calendar_event_id:state.eventId,assigned_to:state.assignee,route_date:'2026-09-22',start_time:state.startTime,total_drive_minutes:10,total_service_minutes:60},error:null});q.order=async()=>({data:[],error:null});q.update=(value:any)=>{state.writes.push(value);return q};return q;}})}));
import {POST} from '@/app/api/inspections/routes/[id]/calendar/route';
const input={routeDate:'2026-09-22',assignedTech:'Matt',totalDriveMinutes:10,totalServiceMinutes:60,stops:[]};
beforeEach(()=>{state.startTime=null;state.eventId=null;state.writes=[];vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({id:'event/1',webLink:'https://outlook.office.com/event'}),{status:201})));vi.stubEnv('INSPECTION_CALENDAR_DRYRUN','0');vi.stubEnv('MAINT_ROUTE_CALENDAR_DRYRUN','0');});
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
 it.each(['operations:event/1', 'legacy/event'])('republishes %s in place without changing attendees or times',async eventId=>{
  state.eventId=eventId;
  const response=await POST(new NextRequest('http://localhost/calendar',{method:'POST'}),{params:Promise.resolve({id:'route'})});
  expect(response.status).toBe(200);expect((await response.json()).updated).toBe(true);
  const [url,request]=vi.mocked(fetch).mock.calls[0];
  expect(url).toBe(routeCalendarEventUrl(eventId));expect(request!.method).toBe('PATCH');
  const payload=JSON.parse(request!.body as string);expect(Object.keys(payload)).toEqual(['body']);
  expect(payload.body.content).toContain('Inspection Route');expect(state.writes).toEqual([]);
 });
 it('updates an existing event time only after a start time is saved', async()=>{
  state.eventId='operations:existing'; state.startTime='13:30:00';
  const response=await POST(new NextRequest('http://localhost/calendar',{method:'POST'}),{params:Promise.resolve({id:'route'})});
  expect(response.status).toBe(200);
  const payload=JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string);
  expect(payload.start).toEqual({dateTime:'2026-09-22T13:30:00',timeZone:'America/Los_Angeles'});
  expect(payload.end.dateTime).toBe('2026-09-22T14:40:00');
  expect(payload.body.content).toContain('1:30 PM');
  expect(payload.attendees).toBeUndefined();
  expect(vi.mocked(fetch).mock.calls[0][1]!.method).toBe('PATCH');
 });
 it('does not create another event if the linked event is missing',async()=>{
  state.eventId='operations:missing';vi.mocked(fetch).mockResolvedValue(new Response('Not found',{status:404}));
  const response=await POST(new NextRequest('http://localhost/calendar',{method:'POST'}),{params:Promise.resolve({id:'route'})});
  expect(response.status).toBe(404);expect(fetch).toHaveBeenCalledTimes(1);expect(state.writes).toEqual([]);
 });

 it('recovers an exact legacy event from the assigned inspector calendar and saves its mailbox',async()=>{
  state.eventId='legacy/event';state.assignee='brody@highdesertpm.com';
  vi.mocked(fetch).mockReset()
    .mockResolvedValueOnce(new Response('Not found',{status:404}))
    .mockResolvedValueOnce(new Response('Not found',{status:404}))
    .mockResolvedValueOnce(new Response(JSON.stringify({id:'legacy/event'}),{status:200}))
    .mockResolvedValueOnce(new Response(JSON.stringify({id:'legacy/event',webLink:'https://outlook.office.com/event'}),{status:200}));
  const response=await POST(new NextRequest('http://localhost/calendar',{method:'POST'}),{params:Promise.resolve({id:'route'})});
  expect(response.status).toBe(200);
  const calls=vi.mocked(fetch).mock.calls;
  expect(calls[1][0]).toContain('operations@highdesertpm.com/events/legacy%2Fevent');
  expect(calls[2][0]).toContain('brody%40highdesertpm.com/events/legacy%2Fevent');
  expect(calls[3][1]?.method).toBe('PATCH');
  expect(state.writes).toEqual([{calendar_event_id:'mailbox:brody@highdesertpm.com:legacy/event'}]);
  expect(calls.every(([,request])=>request?.method!=='POST')).toBe(true);
 });
 it('does not create an event when all legacy calendar lookups fail',async()=>{
  state.eventId='legacy/event';vi.mocked(fetch).mockResolvedValue(new Response('Not found',{status:404}));
  const response=await POST(new NextRequest('http://localhost/calendar',{method:'POST'}),{params:Promise.resolve({id:'route'})});
  expect(response.status).toBe(404);expect(fetch).toHaveBeenCalledTimes(3);expect(state.writes).toEqual([]);
 });

});
