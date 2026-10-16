import type { PlaceKind } from './model';

/** Tunables for turning location evidence into a field day. Pilot data sets the final values. */
export const FIELD_CONFIG = {
  maxAccuracyM: 100,       // ignore fixes less accurate than this
  spikeM: 300,             // a lone fix this far from both neighbours...
  spikeNeighborM: 100,     // ...when the neighbours agree with each other is a GPS spike
  clusterRadiusM: 75,      // fixes this close to the running centre belong to one stop
  detectDwellMin: 3,       // a cluster lasting this long is a stop candidate
  minStopMin: 5,           // shorter stops are dropped unless they're inside a known place
  mergeGapMin: 10,         // stops at the same place this close together are one stop
  gapMin: 10,              // no fix for this long is a gap in the data
  stationaryGapM: 150,     // across a gap, moving less than this means the stop continued
  driveSlackMin: 15,       // a gap no longer than the drive estimate plus this was driving
  propertyRadiusM: 120,    // a stop this close to a property with work orders is at that property
  ruralRadiusM: 250,       // ...or this close when nothing is within the normal radius
  ambiguityM: 30,          // properties within this of the nearest one are equally likely
  trimLeftoverMin: 3,      // suggestion pieces shorter than this after trimming are dropped
  candidateDaysBefore: 2,  // a work order completed up to this many days before the stop can be the job
  candidateDaysAfter: 14,  // ...or up to this many days after it
  shortfallHours: 0.5,     // flag a work order only when billing is short by at least this
  lookbackDays: 60,        // field time counted for a work order from before the review period
};
export type FieldConfig = typeof FIELD_CONFIG;

/** Default stop radius by location kind, in metres. Big-box parking lots need room. */
export const RADIUS_BY_KIND: Record<PlaceKind, number> = { store: 200, dump: 250, shop: 150, other: 150 };
