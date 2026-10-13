/**
 * Open a turn's Gantt schedule in its own resizable window, sized to most of
 * the screen. One window per turn: opening the same turn again brings its
 * window forward instead of stacking copies.
 */
export function openTurnSchedule(id: string) {
  const w = Math.min(1400, Math.round(window.screen.availWidth * 0.9));
  const h = Math.min(900, Math.round(window.screen.availHeight * 0.85));
  const left = Math.max(0, Math.round((window.screen.availWidth - w) / 2));
  const top = Math.max(0, Math.round((window.screen.availHeight - h) / 2));
  const win = window.open(
    `/turnover-tracker/${encodeURIComponent(id)}/schedule`,
    `turn-schedule-${id}`,
    `popup=yes,width=${w},height=${h},left=${left},top=${top},resizable=yes,scrollbars=yes`
  );
  // Pop-up blocked (or a phone, which opens a tab): go there in this tab instead.
  if (!win) window.location.href = `/turnover-tracker/${encodeURIComponent(id)}/schedule`;
  else win.focus();
}
