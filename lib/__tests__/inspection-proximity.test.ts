import {afterEach,describe,expect,it,vi} from 'vitest';
import {buildRoutePlans,solveNearestNeighborTSP} from '../route-engine';
import {optimizeRouteWithGoogle} from '../route-directions';
import type {GeoInspection,ProposedStop} from '@/types/routes';
const point=(id:string,lat:number,lng:number):GeoInspection=>({inspection_id:id,property_id:id,address:id,unit_name:null,city:'Redmond',lat,lng,due_date:'2026-10-01',priority:'normal',days_overdue:0,service_minutes:15});
const stop=(id:string,lat:number,lng:number):ProposedStop=>({...point(id,lat,lng),stop_order:1,drive_minutes_from_prev:0,drive_meters_from_prev:0});
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();});
describe('proximity grouping and driving estimates',()=>{
 it('keeps nearby units together despite interleaved import order',()=>{
  const points=[point('west1',44.2,-121.3),point('east1',44.2,-121.1),point('west2',44.201,-121.3),point('east2',44.201,-121.1)];
  const result=buildRoutePlans(points,{date_range_start:'2026-10-05',date_range_end:'2026-10-06',max_stops_per_route:2});
  expect(result.routes.map(r=>r.stops.map(s=>s.inspection_id).sort())).toEqual([['west1','west2'],['east1','east2']]);
 });
 it('orders a shuffled route by proximity without changing the input',()=>{
  const points=[point('far',0,3),point('near',0,1),point('middle',0,2)];
  expect(solveNearestNeighborTSP(points,0,0).map(s=>s.inspection_id)).toEqual(['near','middle','far']);
  expect(points[0].inspection_id).toBe('far');
 });
 it('uses Google driving time even for one stop and rounds up to whole minutes',async()=>{
  vi.stubEnv('GOOGLE_PLACES_API_KEY','test');
  const fetcher=vi.fn().mockResolvedValue({json:async()=>({status:'OK',routes:[{waypoint_order:[],legs:[{duration:{value:121},distance:{value:900}}],overview_polyline:{points:'path'}}]})});
  vi.stubGlobal('fetch',fetcher);
  const result=await optimizeRouteWithGoogle([stop('one',44.2,-121.1)]);
  expect(fetcher).toHaveBeenCalledOnce();
  expect(result).toMatchObject({source:'google',total_drive_minutes:3});
 });
 it('retains every stop on malformed Google output and optimizes the fallback order',async()=>{
  vi.stubEnv('GOOGLE_PLACES_API_KEY','test');
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue({json:async()=>({status:'OK',routes:[{waypoint_order:[0,0],legs:[]}]})}));
  const result=await optimizeRouteWithGoogle([stop('far',0,3),stop('near',0,1),stop('middle',0,2)],0,0);
  expect(result.source).toBe('haversine');
  expect(result.stops.map(s=>s.inspection_id)).toEqual(['near','middle','far']);
  expect(result.total_drive_minutes).toBe(result.stops.reduce((n,s)=>n+s.drive_minutes_from_prev,0));
 });
});
