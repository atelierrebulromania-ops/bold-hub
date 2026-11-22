import assert from "node:assert/strict";
import test from "node:test";
import { dayNumber, daysInYear, eventsInYear, formatRange, layoutLane, monthStarts, pickYear, todayOffset } from "../lib/marketing/calendar.ts";

const event = (title: string, start_date: string, end_date: string) => ({ title, start_date, end_date });

test("dates: real calendar days only, leap years counted", () => {
  assert.equal(daysInYear(2027), 365);
  assert.equal(daysInYear(2028), 366);
  assert.equal(dayNumber("2027-02-29"), null);
  assert.equal(dayNumber("2028-02-29") !== null, true);
  assert.equal(dayNumber("27-1-1"), null);
  const months = monthStarts(2027);
  assert.equal(months.length, 12);
  assert.equal(months[0].start, 0);
  assert.ok(Math.abs(months[6].start - 181 / 365) < 1e-9); // 1 July
});

test("an event sits where its dates are, as a share of the year", () => {
  const { items, rows } = layoutLane([event("OLFACTIVE CLASH", "2027-01-15", "2027-03-30")], 2027, 1);
  assert.equal(rows, 1);
  assert.ok(Math.abs(items[0].left - 14 / 365) < 1e-9);
  assert.ok(Math.abs(items[0].width - 75 / 365) < 1e-9);
});

test("overlapping events go on separate sub-rows; back-to-back ones share a row", () => {
  const { items, rows } = layoutLane([
    event("AOG V-DAY", "2027-02-01", "2027-02-14"),
    event("AOG EID #1", "2027-02-20", "2027-03-12"),
    event("AOG WOMEN'S DAY", "2027-02-26", "2027-03-08"),
    event("AOG MOTHERS' DAY", "2027-04-26", "2027-05-09"),
  ], 2027, 1);
  assert.equal(rows, 2);
  const row = (title: string) => items.find(item => item.event.title === title)?.row;
  assert.equal(row("AOG V-DAY"), 0);
  assert.equal(row("AOG EID #1"), 0);
  assert.equal(row("AOG WOMEN'S DAY"), 1);
  assert.equal(row("AOG MOTHERS' DAY"), 0);
});

test("back-to-back events sharing their boundary day stay on one row", () => {
  const { rows } = layoutLane([
    event("NEW FRENCH HERITAGE", "2027-04-01", "2027-05-10"),
    event("BODY MIST EXTENSION", "2027-05-10", "2027-08-01"),
  ], 2027, 1);
  assert.equal(rows, 1);
});

test("a one-day event gets a readable minimum width and stays inside the year", () => {
  const { items } = layoutLane([event("UNBOXING DAY UK", "2027-12-26", "2027-12-26")], 2027, 20);
  assert.ok(Math.abs(items[0].width - 20 / 365) < 1e-9);
  assert.ok(items[0].left + items[0].width <= 1 + 1e-9);
});

test("events crossing the new year are clipped to the year shown", () => {
  const crossing = [event("NEW YEAR & AOG", "2027-11-12", "2028-01-10")];
  assert.equal(eventsInYear(crossing, 2027).length, 1);
  assert.equal(eventsInYear(crossing, 2028).length, 1);
  assert.equal(eventsInYear(crossing, 2026).length, 0);
  const next = layoutLane(crossing, 2028, 1).items[0];
  assert.equal(next.left, 0);
  assert.ok(next.clippedStart);
});

test("dates printed on the board", () => {
  assert.equal(formatRange("2027-01-15", "2027-03-30", false), "(15 JAN – 30 MAR)");
  assert.equal(formatRange("2027-03-21", "2027-03-21", false), "(21 MAR)");
  assert.equal(formatRange("2027-03-09", "2027-03-12", false), "(9–12 MAR)");
  assert.equal(formatRange("2027-01-01", "2027-01-31", true), "(TBC)");
});

test("today's line only on this year's board", () => {
  assert.equal(todayOffset(2027, new Date("2026-11-20T12:00:00Z")), null);
  const offset = todayOffset(2026, new Date("2026-11-20T12:00:00Z"));
  assert.ok(offset !== null && offset > 0.88 && offset < 0.89);
});

test("which year opens", () => {
  assert.equal(pickYear("2029", 2026, [2027]), 2029);
  assert.equal(pickYear(undefined, 2026, [2026, 2027]), 2026);
  assert.equal(pickYear(undefined, 2026, [2027, 2028]), 2027);
  assert.equal(pickYear(undefined, 2026, []), 2026);
  assert.equal(pickYear("abc", 2026, [2027]), 2027);
});

test("event fields are validated with plain messages", async () => {
  const { parseEvent, parseLane } = await import("../lib/marketing/validate.ts");
  const lane = "0d0e9a9c-0000-4000-8000-000000000001";
  const ok = parseEvent({ title: "  Black   Friday ", laneId: lane, startDate: "2027-11-01", endDate: "2027-11-30", showDates: false });
  assert.ok(ok.ok);
  if (ok.ok) assert.deepEqual([ok.value.title, ok.value.showDates, ok.value.datesTbc], ["Black Friday", false, false]);
  const bad = parseEvent({ title: "", laneId: "x", startDate: "2027-11-30", endDate: "2027-11-01" });
  assert.ok(!bad.ok);
  if (!bad.ok) assert.deepEqual(Object.keys(bad.errors).sort(), ["endDate", "laneId", "title"]);
  // A category carries the colour its events are drawn in.
  const category = parseLane({ name: "Commercial events", color: "purple", showImages: true });
  assert.ok(category.ok && category.value.color === "purple" && category.value.showImages);
  const noColour = parseLane({ name: "Extras", color: "pink" });
  assert.ok(!noColour.ok && "color" in noColour.errors);
});
