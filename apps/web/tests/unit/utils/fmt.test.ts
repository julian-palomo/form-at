import { describe, expect, it } from "vitest";
import { fmtDate, fmtDuration, fmtEventDay, fmtNightLine, parseDuration } from "~/utils/fmt";

describe("fmtEventDay", () => {
  it("formats a calendar date as short weekday + DD.MM", () => {
    expect(fmtEventDay("2026-12-05")).toBe("Sat\u00A005.12");
    expect(fmtEventDay("2026-08-28")).toBe("Fri\u00A028.08");
  });

  it("returns anything that isn't YYYY-MM-DD unchanged", () => {
    expect(fmtEventDay("tbc")).toBe("tbc");
  });
});

describe("fmtNightLine", () => {
  it("reads the day, the venue's name and the start time, in lowercase", () => {
    expect(
      fmtNightLine({
        date: "2026-12-05",
        venue: "Stereo, City Centre, Glasgow",
        runtime: "23:00 — 04:00",
      }),
    ).toBe("sat 5 dec · stereo · 23:00");
  });

  it("leaves out a part it can't read", () => {
    expect(fmtNightLine({ date: "2026-07-24", venue: "Seafield", runtime: "very late" })).toBe(
      "fri 24 jul · seafield",
    );
    expect(fmtNightLine({ date: "tbc", venue: "", runtime: "" })).toBe("tbc");
  });
});

describe("fmtDuration", () => {
  it("formats seconds under a minute", () => {
    expect(fmtDuration(0)).toBe("0s");
    expect(fmtDuration(45)).toBe("45s");
    expect(fmtDuration(59)).toBe("59s");
  });

  it("formats whole minutes", () => {
    expect(fmtDuration(60)).toBe("1m");
    expect(fmtDuration(180)).toBe("3m");
    expect(fmtDuration(3540)).toBe("59m");
  });

  it("formats hours with leftover minutes", () => {
    expect(fmtDuration(3600)).toBe("1h");
    expect(fmtDuration(3660)).toBe("1h 1m");
    expect(fmtDuration(7320)).toBe("2h 2m");
  });
});

describe("parseDuration", () => {
  it("parses M:SS", () => {
    expect(parseDuration("45:18")).toBe(2718);
    expect(parseDuration("0:05")).toBe(5);
  });

  it("parses H:MM:SS", () => {
    expect(parseDuration("1:31:55")).toBe(5515);
    expect(parseDuration("2:20:51")).toBe(8451);
  });

  it("returns undefined for anything that isn't 2 or 3 colon-separated numeric parts", () => {
    expect(parseDuration("")).toBeUndefined();
    expect(parseDuration("45")).toBeUndefined();
    expect(parseDuration("1:2:3:4")).toBeUndefined();
    expect(parseDuration("not:a:duration")).toBeUndefined();
  });
});

describe("fmtDate", () => {
  it("returns an ISO date (YYYY-MM-DD)", () => {
    // 2026-05-08T12:00:00Z
    const ms = Date.UTC(2026, 4, 8, 12, 0, 0);
    expect(fmtDate(ms)).toBe("2026-05-08");
  });
});
