// Validation of what users type in the communication calendar. Pure, shared by the server actions and the
// tests. Messages are in Romanian and name the field, for people without technical knowledge.
import { dayNumber, eventColors, type EventColor, type LaneKind } from "./calendar.ts";

export type FieldErrors = Record<string, string>;
export type Parsed<T> = { ok: true; value: T } | { ok: false; errors: FieldErrors };

const text = (value: unknown) => (typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "");
const multiline = (value: unknown) => (typeof value === "string" ? value.replace(/\r\n/g, "\n").trim() : "");
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type EventInput = {
  laneId: string; title: string; startDate: string; endDate: string; datesTbc: boolean; showDates: boolean;
  color: EventColor; stockIn: string | null; notes: string | null; imagePath: string | null;
};

export function parseEvent(input: Record<string, unknown>): Parsed<EventInput> {
  const errors: FieldErrors = {};
  const title = text(input.title);
  if (!title) errors.title = "Scrie numele evenimentului.";
  else if (title.length > 80) errors.title = "Numele poate avea cel mult 80 de caractere.";
  const laneId = text(input.laneId);
  if (!uuid.test(laneId)) errors.laneId = "Alege categoria.";
  const startDate = text(input.startDate);
  const endDate = text(input.endDate);
  const start = dayNumber(startDate);
  const end = dayNumber(endDate);
  if (start === null) errors.startDate = "Alege data de început.";
  if (end === null) errors.endDate = "Alege data de sfârșit.";
  if (start !== null && end !== null) {
    if (end < start) errors.endDate = "Data de sfârșit nu poate fi înaintea celei de început.";
    else if (end - start > 400) errors.endDate = "Un eveniment poate dura cel mult un an.";
  }
  const color = text(input.color) as EventColor;
  if (!(color in eventColors)) errors.color = "Alege culoarea.";
  const stockIn = text(input.stockIn) || null;
  if (stockIn && stockIn.length > 60) errors.stockIn = "Textul poate avea cel mult 60 de caractere.";
  const notes = multiline(input.notes) || null;
  if (notes && notes.length > 600) errors.notes = "Notele pot avea cel mult 600 de caractere.";
  const imagePath = text(input.imagePath) || null;
  return Object.keys(errors).length
    ? { ok: false, errors }
    : { ok: true, value: { laneId, title, startDate, endDate, datesTbc: input.datesTbc === true, showDates: input.showDates !== false, color, stockIn, notes, imagePath } };
}

export type LaneInput = { name: string; subtitle: string; kind: LaneKind; showImages: boolean };

export function parseLane(input: Record<string, unknown>): Parsed<LaneInput> {
  const errors: FieldErrors = {};
  const name = text(input.name);
  if (!name) errors.name = "Scrie numele categoriei.";
  else if (name.length > 60) errors.name = "Numele poate avea cel mult 60 de caractere.";
  const subtitle = text(input.subtitle);
  if (subtitle.length > 160) errors.subtitle = "Descrierea poate avea cel mult 160 de caractere.";
  const kind = text(input.kind) === "band" ? "band" : "events";
  return Object.keys(errors).length
    ? { ok: false, errors }
    : { ok: true, value: { name, subtitle, kind, showImages: kind === "events" && input.showImages === true } };
}
