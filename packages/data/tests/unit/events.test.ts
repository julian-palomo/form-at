import { describe, expect, it } from "vitest";
import { type Event, getNextEvent } from "~/events";

function night(id: string, date: string, status: Event["status"] = "upcoming"): Event {
  return {
    id,
    title: id,
    date,
    venue: "Stereo, Glasgow",
    city: "Glasgow",
    lineupIds: [],
    audio: "techno",
    runtime: "23:00 — 04:00",
    status,
  };
}

describe("getNextEvent", () => {
  const dec = night("dec", "2026-12-05");

  it("is the night until noon UTC on the day after it", () => {
    expect(getNextEvent(new Date("2026-11-10T10:00:00Z"), [dec])).toBe(dec);
    // Doors are open and it is already the next calendar day.
    expect(getNextEvent(new Date("2026-12-06T03:00:00Z"), [dec])).toBe(dec);
    expect(getNextEvent(new Date("2026-12-06T11:59:59Z"), [dec])).toBe(dec);
  });

  it("is nothing once the night has ended, though its status still says upcoming", () => {
    expect(getNextEvent(new Date("2026-12-06T12:00:00Z"), [dec])).toBeUndefined();
  });

  it("never returns a night marked past", () => {
    const past = night("past", "2026-12-05", "past");
    expect(getNextEvent(new Date("2026-11-10T10:00:00Z"), [past])).toBeUndefined();
  });

  it("picks the soonest of several, whatever their order", () => {
    const feb = night("feb", "2027-02-26");
    expect(getNextEvent(new Date("2026-11-10T10:00:00Z"), [feb, dec])).toBe(dec);
    expect(getNextEvent(new Date("2026-12-07T10:00:00Z"), [feb, dec])).toBe(feb);
  });
});
