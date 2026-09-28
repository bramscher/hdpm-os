import { describe, it, expect } from 'vitest';
import { validRouteStartTime, routeArrival, routeTimeLabel, routeWallTime } from '../inspection-time';
describe('inspection route start times',()=>{
 it('accepts valid clock times and rejects invalid input',()=>{
  for (const value of ['08:00','13:30','00:00','23:59']) expect(validRouteStartTime(value)).toBe(true);
  for (const value of ['24:00','8:00','12:60',null,'13:30:00']) expect(validRouteStartTime(value)).toBe(false);
 });
 it('defaults legacy routes to 8 AM and retains minutes in afternoon estimates',()=>{
  expect(routeTimeLabel(null)).toBe('8:00 AM');
  expect(routeTimeLabel('13:30:00',45)).toBe('2:15 PM');
 });
 it('rolls the event end into the next day',()=>{
  expect(routeWallTime('2026-09-28','23:30',90)).toBe('2026-09-29T01:00:00');
 });
 it('stores Pacific arrivals correctly in both daylight and standard time',()=>{
  expect(routeArrival('2026-09-28','13:30',45)).toBe('2026-09-28T21:15:00.000Z');
  expect(routeArrival('2026-12-28','13:30',45)).toBe('2026-12-28T22:15:00.000Z');
 });
});
