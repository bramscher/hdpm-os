/** Closeout labels shared with the browser (no server imports here).
 * A parts run for a job is job time on that work order (field-time decision 4); the parts kind is only van stock or general shopping. */
export const OVERHEAD_KINDS:Record<string,string>={travel:'Travel / drive',parts:'Van stock / general',shop:'Shop / vehicle / office',callback:'Callback / warranty',other:'Other'};
export const JOB_KINDS=['job'];
/** A day closes when logged time is within this many minutes of the timecard. */
export const BALANCE_TOLERANCE=15;
