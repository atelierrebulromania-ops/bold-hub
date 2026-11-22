// Validation of what users type in the communication calendar. Pure, shared by the server actions and the
// tests. Messages are in English (the calendar is shared with partners abroad) and name the field.
import { dayNumber, eventColors, type EventColor } from "./calendar.ts";

export type FieldErrors = Record<string, string>;
export type Parsed<T> = { ok: true; value: T } | { ok: false; errors: FieldErrors };

const text = (value: unknown) => (typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "");
const multiline = (value: unknown) => (typeof value === "string" ? value.replace(/\r\n/g, "\n").trim() : "");
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type EventInput = {
  laneId: string; title: string; startDate: string; endDate: string; datesTbc: boolean; showDates: boolean;
  notes: string | null; imagePath: string | null;
};

export function parseEvent(input: Record<string, unknown>): Parsed<EventInput> {
  const errors: FieldErrors = {};
  const title = text(input.title);
  if (!title) errors.title = "Enter the event name.";
  else if (title.length > 80) errors.title = "The name can have at most 80 characters.";
  const laneId = text(input.laneId);
  if (!uuid.test(laneId)) errors.laneId = "Choose the category.";
  const startDate = text(input.startDate);
  const endDate = text(input.endDate);
  const start = dayNumber(startDate);
  const end = dayNumber(endDate);
  if (start === null) errors.startDate = "Choose the start date.";
  if (end === null) errors.endDate = "Choose the end date.";
  if (start !== null && end !== null) {
    if (end < start) errors.endDate = "The end date cannot be before the start date.";
    else if (end - start > 400) errors.endDate = "An event can last at most a year.";
  }
  const notes = multiline(input.notes) || null;
  if (notes && notes.length > 600) errors.notes = "Notes can have at most 600 characters.";
  const imagePath = text(input.imagePath) || null;
  return Object.keys(errors).length
    ? { ok: false, errors }
    : { ok: true, value: { laneId, title, startDate, endDate, datesTbc: input.datesTbc === true, showDates: input.showDates !== false, notes, imagePath } };
}

export type LaneInput = { name: string; subtitle: string; color: EventColor; showImages: boolean };

export function parseLane(input: Record<string, unknown>): Parsed<LaneInput> {
  const errors: FieldErrors = {};
  const name = text(input.name);
  if (!name) errors.name = "Enter the category name.";
  else if (name.length > 60) errors.name = "The name can have at most 60 characters.";
  const subtitle = text(input.subtitle);
  if (subtitle.length > 160) errors.subtitle = "The description can have at most 160 characters.";
  const color = text(input.color) as EventColor;
  if (!(color in eventColors)) errors.color = "Choose the colour.";
  return Object.keys(errors).length
    ? { ok: false, errors }
    : { ok: true, value: { name, subtitle, color, showImages: input.showImages === true } };
}
