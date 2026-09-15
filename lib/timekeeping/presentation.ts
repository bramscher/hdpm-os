export function displayTime(value: string): string {
  if (value === "24:00") return "12:00 AM (next day)";
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) return "";
  const [h, m] = value.split(":").map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`;
}
export const QUARTER_HOUR_TIMES = Array.from(
  { length: 96 },
  (_, i) =>
    `${String(Math.floor(i / 4)).padStart(2, "0")}:${String((i % 4) * 15).padStart(2, "0")}`,
);

const MONTHS = [
  "Jan.",
  "Feb.",
  "March",
  "April",
  "May",
  "June",
  "July",
  "Aug.",
  "Sept.",
  "Oct.",
  "Nov.",
  "Dec.",
];
export function displayDate(date: string, includeYear = true): string {
  const [year, month, day] = date.split("-").map(Number);
  const suffix =
    day % 100 >= 11 && day % 100 <= 13
      ? "th"
      : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[day % 10] ||
        "th";
  return `${MONTHS[month - 1]} ${day}${suffix}${includeYear ? `, ${year}` : ""}`;
}
export function displayPeriod(start: string, end: string): string {
  return `${displayDate(start, start.slice(0, 4) !== end.slice(0, 4))} – ${displayDate(end)}`;
}
