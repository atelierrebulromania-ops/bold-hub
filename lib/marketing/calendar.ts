// Marketing communication calendar: data shapes, colours and the board layout (where each block sits in
// the year and on which sub-row of its category). Pure code, shared by the board, the server and the tests.

export type LaneKind = "band" | "events";

export type MarketingLane = {
  id: string;
  name: string;
  subtitle: string;
  kind: LaneKind;
  show_images: boolean;
  position: number;
};

export type MarketingEvent = {
  id: string;
  lane_id: string;
  title: string;
  start_date: string; // YYYY-MM-DD
  end_date: string;
  dates_tbc: boolean;
  show_dates: boolean;
  color: EventColor;
  stock_in: string | null;
  notes: string | null;
  image_path: string | null;
};

// The fixed palette of the original calendar. Users pick one of these; no free colours.
export const eventColors = {
  dark: { label: "Gri închis", background: "#3B3B3B", text: "#FFFFFF" },
  grey: { label: "Gri", background: "#A3A3A3", text: "#FFFFFF" },
  light: { label: "Gri deschis", background: "#D6D6D6", text: "#333333" },
  purple: { label: "Mov", background: "#7B1F6C", text: "#FFFFFF" },
  orange: { label: "Portocaliu", background: "#D9845A", text: "#FFFFFF" },
  red: { label: "Roșu", background: "#F03B3B", text: "#FFFFFF" },
} as const;
export type EventColor = keyof typeof eventColors;

export const monthNames = ["IAN", "FEB", "MAR", "APR", "MAI", "IUN", "IUL", "AUG", "SEP", "OCT", "NOI", "DEC"] as const;

const dayMs = 86_400_000;
const isoPattern = /^(\d{4})-(\d{2})-(\d{2})$/;

// Days since 1970-01-01 for a YYYY-MM-DD date (UTC, so no time-zone drift); null if it is not a real date.
export function dayNumber(iso: string): number | null {
  const match = isoPattern.exec(iso);
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const time = Date.UTC(year, month - 1, day);
  const date = new Date(time);
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return time / dayMs;
}

export function isoDate(dayNo: number) {
  return new Date(dayNo * dayMs).toISOString().slice(0, 10);
}

export function daysInYear(year: number) {
  return (Date.UTC(year + 1, 0, 1) - Date.UTC(year, 0, 1)) / dayMs;
}

// Where each month starts, as a share (0–1) of the year: the board's month columns.
export function monthStarts(year: number) {
  const total = daysInYear(year);
  const first = Date.UTC(year, 0, 1) / dayMs;
  return monthNames.map((name, index) => ({ name, start: (Date.UTC(year, index, 1) / dayMs - first) / total }));
}

export function eventsInYear<T extends Pick<MarketingEvent, "start_date" | "end_date">>(events: T[], year: number) {
  const first = Date.UTC(year, 0, 1) / dayMs;
  const last = Date.UTC(year, 11, 31) / dayMs;
  return events.filter(event => (dayNumber(event.start_date) ?? Infinity) <= last && (dayNumber(event.end_date) ?? -Infinity) >= first);
}

export type PlacedEvent<T> = { event: T; row: number; left: number; width: number; clippedStart: boolean; clippedEnd: boolean };

// Lays one category's events out on the year: left/width as shares of the year, and a sub-row so that
// blocks never overlap. Short events get a minimum width so their title stays readable (as on the
// original, where a one-day event still gets a box); the box is then kept inside the year.
export function layoutLane<T extends Pick<MarketingEvent, "start_date" | "end_date" | "title">>(events: T[], year: number, minDays = 24): { items: PlacedEvent<T>[]; rows: number } {
  const total = daysInYear(year);
  const first = Date.UTC(year, 0, 1) / dayMs;
  const spans = eventsInYear(events, year).map(event => {
    const start = (dayNumber(event.start_date) as number) - first;
    const end = (dayNumber(event.end_date) as number) - first;
    const from = Math.max(0, start);
    const to = Math.min(total - 1, end);
    const length = Math.max(to - from + 1, Math.min(minDays, total));
    const shownFrom = Math.min(from, total - length);
    return { event, from: shownFrom, to: shownFrom + length - 1, clippedStart: start < 0, clippedEnd: end > total - 1 };
  }).sort((a, b) => a.from - b.from || b.to - a.to || a.event.title.localeCompare(b.event.title));

  const rowEnds: number[] = [];
  const items = spans.map(span => {
    let row = rowEnds.findIndex(end => end < span.from);
    if (row === -1) { row = rowEnds.length; rowEnds.push(span.to); } else rowEnds[row] = span.to;
    return { event: span.event, row, left: span.from / total, width: (span.to - span.from + 1) / total, clippedStart: span.clippedStart, clippedEnd: span.clippedEnd };
  });
  return { items, rows: Math.max(rowEnds.length, 1) };
}

// "(15 IAN – 30 MAR)", "(21 MAR)", "(TBC)"
export function formatRange(start: string, end: string, tbc: boolean) {
  if (tbc) return "(TBC)";
  const label = (iso: string) => { const [, month, day] = iso.split("-"); return `${Number(day)} ${monthNames[Number(month) - 1]}`; };
  return start === end ? `(${label(start)})` : `(${label(start)} – ${label(end)})`;
}

// Today's position on the board (0–1), or null when the board shows another year.
export function todayOffset(year: number, today: Date) {
  if (today.getUTCFullYear() !== year) return null;
  const dayNo = Date.UTC(year, today.getUTCMonth(), today.getUTCDate()) / dayMs;
  return (dayNo - Date.UTC(year, 0, 1) / dayMs + 0.5) / daysInYear(year);
}

// The year to open on: the one asked for; else this year if it has events; else the next year that has
// some (a calendar is usually planned ahead); else this year.
export function pickYear(requested: string | undefined, currentYear: number, yearsWithEvents: number[]) {
  const asked = Number(requested);
  if (Number.isInteger(asked) && asked >= 2000 && asked <= 2100) return asked;
  if (yearsWithEvents.includes(currentYear)) return currentYear;
  return yearsWithEvents.filter(year => year > currentYear).sort((a, b) => a - b)[0] ?? currentYear;
}
