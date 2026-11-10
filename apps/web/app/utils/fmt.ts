// Formats a number of seconds as `M:SS`. Used wherever we display a position
// within a track (player seeker, share-at-time labels, deeplink URLs).
// Returns `0:00` for non-finite values so seekers don't flash NaN during load.
export function fmtTimestamp(s: number): string {
  if (!Number.isFinite(s)) return "0:00";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

export function fmtDuration(s: number): string {
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return rm > 0 ? `${h}h ${rm}m` : `${h}h`;
}

// Inverse of the `MusicSet.duration` string ("1:39:30" or "45:18") — NOT the
// inverse of `fmtDuration` above, which formats a coarser, different shape.
// Returns undefined for anything that isn't exactly 2 or 3 colon-separated
// numeric parts, so a missing or malformed duration reads as "unknown" to
// callers rather than as `0` (a caller treating 0 as a real duration would
// reject every real listen against it — see playTracking.ts's use of this).
export function parseDuration(s: string): number | undefined {
  const parts = s.split(":").map(Number);
  if (parts.length !== 2 && parts.length !== 3) return undefined;
  if (parts.some((n) => !Number.isFinite(n))) return undefined;
  if (parts.length === 3) {
    const [h, m, sec] = parts as [number, number, number];
    return h * 3600 + m * 60 + sec;
  }
  const [m, sec] = parts as [number, number];
  return m * 60 + sec;
}

export function fmtDate(ms: number): string {
  return new Date(ms).toISOString().split("T")[0] ?? "";
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

// An event's `YYYY-MM-DD` date as `Sat 05.12`. Read in UTC, never the local
// zone: the date is a calendar day, and a local parse shifts it a day back
// west of UTC (and makes the SSR and client renders disagree). Weekday names
// are fixed rather than from toLocaleDateString, whose output varies by
// engine and locale ("Sat" / "Sat."). The space is non-breaking, so a narrow
// screen never splits the weekday from the date.
export function fmtEventDay(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  if (!y || !m || !d) return date;
  const weekday = WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${weekday}\u00A0${String(d).padStart(2, "0")}.${String(m).padStart(2, "0")}`;
}

const MONTHS = [
  "jan",
  "feb",
  "mar",
  "apr",
  "may",
  "jun",
  "jul",
  "aug",
  "sep",
  "oct",
  "nov",
  "dec",
] as const;

// A night in one lowercase line for the home page: `sat 5 dec · stereo · 23:00`.
// The day is read in UTC like fmtEventDay; the venue is the part of `venue`
// before its first comma (the place's name, not its address); the time is
// where `runtime` starts. A part that can't be read is left out.
export function fmtNightLine(night: { date: string; venue: string; runtime: string }): string {
  const venue = night.venue.split(",")[0]?.trim() ?? "";
  const start = night.runtime.match(/^\s*(\d{1,2}:\d{2})/)?.[1] ?? "";
  return [nightDay(night.date), venue, start]
    .filter((part) => part !== "")
    .join(" · ")
    .toLowerCase();
}

/** `2026-12-05` as `Sat 5 Dec`; the date unchanged when it isn't one. */
function nightDay(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const month = m ? MONTHS[m - 1] : undefined;
  if (!y || !m || !d || !month) return date;
  return `${WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]} ${d} ${month}`;
}

// MB-or-GB byte sizes for offline-library labels. Decimal units (MB = 10^6)
// to match what users see in iOS Settings / Chrome storage panel — binary
// MiB would confuse the comparison. Rounds to whole numbers under 1 GB, one
// decimal at or above 1 GB. Returns `0MB` for non-finite / negative inputs
// rather than throwing — caller is rendering a label, not a precise stat.
export function fmtBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0MB";
  if (n < 1_000_000_000) return `${Math.round(n / 1_000_000)}MB`;
  return `${(n / 1_000_000_000).toFixed(1)}GB`;
}

// Renders a list of daily counts as a unicode sparkline (`▁▂▅▇▃▁▁`). The
// tallest bar represents the max value in the window, every other bar scales
// proportionally. Empty arrays return "", all-zero arrays return all `▁`.
export function asciiBar(values: number[]): string {
  if (values.length === 0) return "";
  const max = Math.max(...values);
  const chars = "▁▂▃▄▅▆▇█";
  if (max === 0) return chars[0]?.repeat(values.length) ?? "";
  return values
    .map((v) => {
      const idx = Math.floor((v / max) * (chars.length - 1));
      return chars[idx] ?? "▁";
    })
    .join("");
}

// ISO 3166-1 alpha-2 (e.g. "GB") → 🇬🇧 emoji using regional indicator symbols.
// Returns "" for non-2-letter inputs ("unknown", empty) so callers can guard.
export function countryFlag(code: string): string {
  if (!/^[a-zA-Z]{2}$/.test(code)) return "";
  const upper = code.toUpperCase();
  return String.fromCodePoint(
    0x1f1e6 + upper.charCodeAt(0) - 65,
    0x1f1e6 + upper.charCodeAt(1) - 65,
  );
}
