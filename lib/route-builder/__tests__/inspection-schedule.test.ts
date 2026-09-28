import {describe,expect,it} from 'vitest';
import {inspectionSchedule} from '../inspection-schedule';
import {routeTimeLabel} from '../inspection-time';
describe('inspection itinerary spacing',()=>{
 it('uses 15-minute inspections, rounded travel, and five minutes between visits',()=>{
  const timing=inspectionSchedule([{drive_minutes_from_prev:10},{drive_minutes_from_prev:2.1},{drive_minutes_from_prev:0}]);
  expect(timing.visits.map(v=>v.arrivalMinutes)).toEqual([10,33,53]);
  expect(timing).toMatchObject({totalMinutes:68,driveMinutes:13,serviceMinutes:45,bufferMinutes:10});
  expect(routeTimeLabel('13:00',timing.totalMinutes)).toBe('2:08 PM');
 });
 it('does not reserve inspection, driving, or buffer time for skipped stops',()=>{
  const timing=inspectionSchedule([{status:'skipped',service_minutes:30,travel_minutes_from_previous:20},{service_minutes:15},{status:'skipped',service_minutes:30},{service_minutes:15}]);
  expect(timing).toMatchObject({totalMinutes:35,serviceMinutes:30,driveMinutes:0,bufferMinutes:5});
 });
 it('preserves explicit service durations and handles an empty route',()=>{
  expect(inspectionSchedule([{service_minutes:40},{service_minutes:10}]).totalMinutes).toBe(55);
  expect(inspectionSchedule([]).totalMinutes).toBe(0);
 });
});
