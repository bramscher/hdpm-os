/**
 * Read-only dry run of the door-movement (Growth) KPI against prod AppFolio.
 * Persists NOTHING. Builds the live roster, prints doors/properties, real
 * pipeline doors from open referral leads, and — since no door_roster baseline
 * exists yet — simulates one prior period (drop a property + shrink another) to
 * prove gained/lost/net/churn reconcile.
 *   npx tsx scripts/dryrun-door-movement.mts
 */
import { readFileSync } from 'node:fs';
for (const line of readFileSync('.env.local','utf8').split('\n')){const m=line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);if(!m)continue;let v=m[2].trim();if((v.startsWith('"')&&v.endsWith('"'))||(v.startsWith("'")&&v.endsWith("'")))v=v.slice(1,-1);if(!process.env[m[1]])process.env[m[1]]=v;}

const { fetchDoorRoster, fetchDoorMovementKpi } = await import('../lib/appfolio-kpi.ts');
const { computeDoorMovement } = await import('../lib/door-movement.ts');

const t = Date.now();
const roster = await fetchDoorRoster();
console.log(`live roster: ${roster.currentDoors} doors across ${roster.currentProperties} properties (${Math.round((Date.now()-t)/1000)}s)`);

// Simulate a prior period: drop the largest property entirely + shrink another by 1 door.
const ids = Object.keys(roster.roster).sort((a,b)=>roster.roster[b]-roster.roster[a]);
const prior = { ...roster.roster };
const droppedId = ids[0]; const droppedDoors = prior[droppedId]; delete prior[droppedId];
const shrunkId = ids[1]; prior[shrunkId] = Math.max(0, prior[shrunkId] - 1);
// Also pretend a small NEW property joined since prior (present now, absent then) — add to current only:
const cur = { ...roster.roster, 'SIM_NEW_PROP': 3 };
const m = computeDoorMovement(cur, prior);
console.log('\nSimulated movement (current+1 new 3-door prop  vs  prior[-largest, -1 door]):');
console.log(`  gained ${m.gained}  lost ${m.lost}  net ${m.net}  churn ${m.churnPct}%`);
console.log(`  baselineDoors ${m.baselineDoors}  currentDoors ${m.currentDoors}`);
console.log(`  invariant net === current − baseline: ${m.net === m.currentDoors - m.baselineDoors}`);
console.log(`  (dropped ${droppedId} = ${droppedDoors} doors; shrank ${shrunkId} by 1; added SIM_NEW_PROP=3)`);

const kpi = await fetchDoorMovementKpi();
console.log('\nLive KPI object (month/ttm null until a real door_roster baseline exists):');
console.log(`  currentDoors ${kpi.currentDoors}  properties ${kpi.currentProperties}`);
console.log(`  month:`, kpi.month, ' ttm:', kpi.ttm);
console.log(`  pipeline: ${kpi.pipelineDoors} doors across ${kpi.pipelineLeads} open leads  | firstRosterAt ${kpi.firstRosterAt}`);
