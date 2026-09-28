/** Route times are local wall-clock times in Central Oregon. */
export function validRouteStartTime(value: unknown): value is string {
  return typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}
export function routeStartTime(value?: string | null): string {
  return value?.slice(0, 5) || '08:00';
}
export function routeWallTime(date: string, start: string | null | undefined, minutes = 0): string {
  const value = new Date(`${date}T${routeStartTime(start)}:00Z`);
  value.setUTCMinutes(value.getUTCMinutes() + Math.round(minutes));
  return value.toISOString().slice(0, 19);
}
export function routeTimeLabel(start: string | null | undefined, minutes = 0): string {
  return new Date(`${routeWallTime('2026-01-01', start, minutes)}Z`).toLocaleTimeString('en-US', {timeZone:'UTC',hour:'numeric',minute:'2-digit'});
}
/** Convert a Pacific wall-clock arrival to an instant, including daylight saving. */
export function routeArrival(date: string, start: string | null | undefined, minutes = 0): string {
  const wall = new Date(`${routeWallTime(date, start, minutes)}Z`).getTime();
  let instant = wall;
  for (let i = 0; i < 3; i++) {
    const parts = new Intl.DateTimeFormat('en-US', {timeZone:'America/Los_Angeles', year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(new Date(instant));
    const part = (name: string) => Number(parts.find(p=>p.type===name)!.value);
    const local = Date.UTC(part('year'),part('month')-1,part('day'),part('hour'),part('minute'),part('second'));
    instant += wall - local;
  }
  return new Date(instant).toISOString();
}
