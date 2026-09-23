// Dashboard ranges are whole calendar days in Bucharest time, half-open [from, to).
const timeZone = "Europe/Bucharest";
const dayPattern = /^\d{4}-\d{2}-\d{2}$/;

export type RangePreset = "today" | "7d" | "30d" | "month" | "custom";

export type DashboardRange = {
  preset: RangePreset;
  fromDay: string;
  toDay: string; // inclusive, for display and the form
  from: Date;
  to: Date;
};

export function bucharestDay(date: Date): string {
  return date.toLocaleDateString("sv-SE", { timeZone });
}

export function addDays(day: string, days: number): string {
  const [year, month, date] = day.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, date + days)).toISOString().slice(0, 10);
}

function offsetMinutes(at: Date): number {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(at).map(part => [part.type, part.value]));
  const asUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day),
    Number(parts.hour), Number(parts.minute), Number(parts.second));
  return Math.round((asUtc - at.getTime()) / 60000);
}

export function bucharestMidnight(day: string): Date {
  const utcMidnight = Date.parse(`${day}T00:00:00Z`);
  const guess = new Date(utcMidnight - offsetMinutes(new Date(utcMidnight)) * 60000);
  // Re-check at the guessed instant so DST transition days resolve correctly.
  return new Date(utcMidnight - offsetMinutes(guess) * 60000);
}

function isValidDay(value: string | undefined): value is string {
  return !!value && dayPattern.test(value) && addDays(value, 0) === value;
}

export function resolveRange(params: { range?: string; from?: string; to?: string }, now = new Date()): DashboardRange {
  const today = bucharestDay(now);
  let preset: RangePreset = "7d";
  let fromDay = addDays(today, -6);
  let toDay = today;

  if (params.range === "today") { preset = "today"; fromDay = today; }
  else if (params.range === "30d") { preset = "30d"; fromDay = addDays(today, -29); }
  else if (params.range === "month") { preset = "month"; fromDay = `${today.slice(0, 7)}-01`; }
  else if (params.range === "custom" && isValidDay(params.from) && isValidDay(params.to)
    && params.from <= params.to && params.to <= today && addDays(params.from, 366) > params.to) {
    preset = "custom"; fromDay = params.from; toDay = params.to;
  }

  return { preset, fromDay, toDay, from: bucharestMidnight(fromDay), to: bucharestMidnight(addDays(toDay, 1)) };
}
