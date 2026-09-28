import { describe, expect, it } from 'vitest';
import { inspectionWeek, type WeeklyRoute } from '../inspection-week';
const route = (id:string, date:string, pending:number, skipped=0):WeeklyRoute => ({id, route_date:date,status:'optimized',route_stops:Array.from({length:pending+skipped},(_,i)=>({id:`${id}-${i}`,status:i<pending?'pending':'skipped'}))});
describe('weekly route appointments',()=>{
  it('counts all 25 appointments on three routes separately from inspection history',()=>{
    expect(inspectionWeek([route('redmond','2026-09-29',13,3),route('madras','2026-09-30',6),route('metolius','2026-09-30',1,2)],'2026-09-28','2026-10-05')).toEqual({routes:3,planned:25,pending:20,skipped:5,completed:0});
  });
  it('uses Monday through Sunday, excludes canceled routes, and separates finished stops',()=>{
    const monday=route('mon','2026-09-28',1);
    monday.route_stops![0].status='completed';
    const canceled={...route('cancel','2026-10-01',8),status:'cancelled'};
    expect(inspectionWeek([monday,route('sun','2026-10-04',1),route('before','2026-09-27',2),route('after','2026-10-05',2),canceled],'2026-09-28','2026-10-05')).toEqual({routes:2,planned:2,pending:1,skipped:0,completed:1});
  });
});
