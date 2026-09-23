import assert from "node:assert/strict";
import test from "node:test";
import { bucharestMidnight, resolveRange } from "../lib/dashboard-range.ts";

test("Bucharest midnight follows summer and winter offsets", () => {
  assert.equal(bucharestMidnight("2026-07-15").toISOString(), "2026-07-14T21:00:00.000Z");
  assert.equal(bucharestMidnight("2026-12-15").toISOString(), "2026-12-14T22:00:00.000Z");
  // DST ends on 25 Oct 2026 at 04:00 local; midnight is still summer time.
  assert.equal(bucharestMidnight("2026-10-25").toISOString(), "2026-10-24T21:00:00.000Z");
  assert.equal(bucharestMidnight("2026-10-26").toISOString(), "2026-10-25T22:00:00.000Z");
});

test("presets cover whole local days up to today", () => {
  const now = new Date("2026-09-23T22:30:00Z"); // already 24 Sep in Bucharest
  const week = resolveRange({}, now);
  assert.equal(week.preset, "7d");
  assert.equal(week.fromDay, "2026-09-18");
  assert.equal(week.toDay, "2026-09-24");
  assert.equal(week.to.toISOString(), "2026-09-24T21:00:00.000Z");
  assert.equal(resolveRange({ range: "month" }, now).fromDay, "2026-09-01");
  assert.equal(resolveRange({ range: "today" }, now).fromDay, "2026-09-24");
});

test("invalid custom ranges fall back to the last 7 days", () => {
  const now = new Date("2026-09-23T10:00:00Z");
  assert.equal(resolveRange({ range: "custom", from: "2026-09-20", to: "2026-09-01" }, now).preset, "7d");
  assert.equal(resolveRange({ range: "custom", from: "2026-02-30", to: "2026-03-01" }, now).preset, "7d");
  assert.equal(resolveRange({ range: "custom", from: "2025-01-01", to: "2026-09-01" }, now).preset, "7d");
  assert.equal(resolveRange({ range: "custom", from: "2026-09-20", to: "2026-09-30" }, now).preset, "7d");
  const ok = resolveRange({ range: "custom", from: "2026-09-01", to: "2026-09-10" }, now);
  assert.equal(ok.preset, "custom");
  assert.equal(ok.to.toISOString(), "2026-09-10T21:00:00.000Z");
});
