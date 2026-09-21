import {describe,it,expect} from 'vitest';
import {historicalScorecardValues} from '../scorecard-history';
import {scorecardWeeks} from '../scorecard';
const metric={id:'turns',source:'metrics_snapshot',source_ref:'turns.openTurns'} as any;
describe('scorecard history',()=>{
 it('shows every week since June including the current week',()=>{const weeks=scorecardWeeks('2026-09-21');expect(weeks).toHaveLength(17);expect(weeks[0]).toBe('2026-06-01');expect(weeks.at(-1)).toBe('2026-09-21');});
 it('restores only same-week original snapshots, using the latest observation',()=>{
 const values=historicalScorecardValues([metric],[{source:'metrics_snapshot',name:'turns',value:{openTurns:10},captured_at:'2026-07-21T14:00:00Z'},{source:'metrics_snapshot',name:'turns',value:{openTurns:12},captured_at:'2026-07-24T14:00:00Z'}],'2026-09-21');expect(values).toHaveLength(1);expect(values[0]).toMatchObject({week_start:'2026-07-20',value:12});
 });
 it('does not turn missing data into zero or carry an earlier value over missing later data',()=>{
 const values=historicalScorecardValues([metric],[{source:'metrics_snapshot',name:'turns',value:{openTurns:10},captured_at:'2026-07-21T14:00:00Z'},{source:'metrics_snapshot',name:'turns',value:{openTurns:null},captured_at:'2026-07-24T14:00:00Z'}],'2026-09-21');expect(values).toEqual([]);
 });
});
