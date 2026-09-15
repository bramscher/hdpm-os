// Adult, non-exempt baseline: https://www.oregon.gov/boli/workers/pages/meals-and-breaks.aspx
// Work-period minutes exclude duty-free unpaid meals. Payroll classification is separate.
export function oregonBreaksForWorkMinutes(work: number) {
  const restCount = Math.floor(work / 240) + (work % 240 > 120 ? 1 : 0);
  const mealCount = work < 360 ? 0 : work < 840 ? 1 : work < 1320 ? 2 : 3;
  return { restCount, mealCount };
}
export function oregonScheduleBreaks(
  start: string,
  end: string,
  unpaidMinutes?: number,
) {
  const minute = (time: string) => {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time))
      throw new Error("Choose a valid start and end time.");
    const [h, m] = time.split(":").map(Number);
    return h * 60 + m;
  };
  const span = (minute(end) - minute(start) + 1440) % 1440;
  if (!span) throw new Error("Start and end must be different.");
  if (unpaidMinutes !== undefined) {
    const required = oregonBreaksForWorkMinutes(span - unpaidMinutes);
    return { unpaidBreak: unpaidMinutes, paidBreak: required.restCount * 10 };
  }
  // Choose the smallest set of 30-minute meals that covers the resulting work period.
  // Near a threshold this can provide an extra meal, rather than under-allocate a break.
  for (let meals = 0; meals <= 3; meals++) {
    const required = oregonBreaksForWorkMinutes(span - meals * 30);
    if (meals >= required.mealCount)
      return { unpaidBreak: meals * 30, paidBreak: required.restCount * 10 };
  }
  throw new Error("Review breaks for this schedule with your manager.");
}
