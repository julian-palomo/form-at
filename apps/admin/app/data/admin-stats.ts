import {
  TREND_BUCKET_DAYS,
  TREND_WINDOW_DAYS,
  bucketByWeek,
  fillDailyWindow,
} from "@form-at/data/set-stats";
import { getSet } from "@form-at/data/sets";
import { WEB_ANALYTICS_SITE_TAG } from "@form-at/data/webAnalytics";
import { createServerFn } from "@tanstack/react-start";
import { type Milestone, STATIC_MILESTONES } from "~/utils/milestones";
import { type EdgeTraffic, type RumVisits, fetchEdgeTraffic, fetchRumVisits } from "./cf-analytics";
import {
  SAMPLE_ADMIN_DASHBOARD_STATS,
  SAMPLE_EDGE_TRAFFIC,
  SAMPLE_RUM_VISITS,
} from "./sample-stats";

// Read-only aggregate queries for the internal admin dashboard
// (`routes/dashboard.tsx`). Same `createServerFn` + D1 pattern as
// packages/data/src/set-stats.ts's `fetchSetStats` — one difference: each
// query is its OWN exported, directly-callable function (not inlined in the
// handler) so it's unit-testable with a fake D1Database.

export type InstallFunnel = {
  /** An install CTA on screen with Chrome's native prompt behind it. */
  shown: number;
  /** The home page's [ install_the_app ] opened its instructions instead (no
   *  native prompt: iOS share-menu steps, the manual hint, open-app, or
   *  where to install instead). A separate entry point, not a stage after
   *  `shown`. */
  instructionsShown: number;
  /** `appinstalled`, from any path — the native prompt, or a manual install
   *  the browser reports (iOS reports none). */
  accepted: number;
  dismissed: number;
  /** accepted ÷ shown. `null` (not 0) when nothing has been shown yet —
   *  "no data" and "0% conversion" are different facts, and the caller
   *  should render them differently. `accepted` counts installs from every
   *  path, including after `instructionsShown`, so this reads high as an
   *  approximation of the native prompt's own rate. */
  conversionRate: number | null;
  /** Same 60-day/7-day-bucket shape as `AppLaunchStats.weeklyTrend` /
   *  `PushSubscriberStats.weeklyGrowth` — one array per event type, so the
   *  three funnel stages can be compared as sparklines over time instead of
   *  only as all-time totals. */
  shownTrend: number[];
  instructionsShownTrend: number[];
  acceptedTrend: number[];
  dismissedTrend: number[];
};

export type AppLaunchStats = {
  total: number;
  /** Same shape as `SetStats.weeklyPlays` — TREND_BUCKET_DAYS-day buckets
   *  over the last TREND_WINDOW_DAYS, oldest first. */
  weeklyTrend: number[];
};

export type PlayStats = {
  total: number;
  /** Rows with `is_offline IS NULL` (recorded before `is_offline` tracking
   *  existed, or by a stale client mid-rollout) count toward `total` but not
   *  toward either of these two — the same exclusion schema.sql's own "useful
   *  queries" comment documents for this ratio. */
  offlineCount: number;
  onlineCount: number;
  /** `total - offlineCount - onlineCount` — how many plays predate `is_offline`
   *  tracking and are silently excluded from the offline/online ratio above.
   *  Surfaced so the dashboard can disclose it rather than presenting that
   *  ratio as if it covered every play ever recorded. */
  excludedCount: number;
  /** Same 60-day/7-day shape as `AppLaunchStats.weeklyTrend`. TOTAL plays only,
   *  deliberately not split by offline/online: `is_offline` is NULL for every
   *  play before tracking was added, so a split series would draw a flat-zero
   *  offline line across most of the window, reading as "nobody listened
   *  offline" rather than "not recorded". The all-time ratio row carries that
   *  breakdown instead, with its own exclusion caption. */
  weeklyTrend: number[];
  topSets: { setId: string; setTitle: string; setArtist: string; playCount: number }[];
};

export type PushSubscriberStats = {
  total: number;
  standaloneCount: number;
  tabCount: number;
  weeklyGrowth: number[];
};

export type ClickStats = {
  saveClicks: number;
  shareClicks: number;
  /** Full list, not top-N. Today's catalogue is 4 sets, so "top 5" and "all"
   *  are the same list — and unlike play counts, click volume per set is low
   *  enough that a hardcoded LIMIT risks silently hiding a set with real
   *  save/share signal once the catalogue grows past 5. Revisit with a LIMIT
   *  if the catalogue grows large enough to make this list unwieldy. */
  perSet: {
    setId: string;
    setTitle: string;
    setArtist: string;
    saveClicks: number;
    shareClicks: number;
  }[];
};

// Below this many `promptShown` impressions, `NotifyFunnel.acceptedRate`
// suppresses to `null` instead of rendering a computed percentage. At 2 accepted
// ÷ 2 shown a bare ratio reads "100%" — high-confidence off two people — and
// the null-when-zero pattern (see InstallFunnel.conversionRate) doesn't catch
// that, since 2/2 isn't zero. 10 is a plain "at least a double-digit sample"
// floor, not tuned to make any particular number disappear — don't remove this
// as fussiness without addressing the small-n problem it guards against.
export const MIN_SAMPLE_FOR_RATE = 10;

export type NotifyFunnel = {
  /** Standalone subscribe soft-prompt becoming visible. */
  promptShown: number;
  /** LEGACY, frozen: the browser-tab install nudge notify_me used to open.
   *  notify_me is installed-app only now, and a tab's install ask counts as
   *  `InstallFunnel.instructionsShown`, so no new rows arrive here (beyond
   *  tabs still running an older cached bundle). Kept so historic rows stay
   *  visible, never as part of the live funnel. */
  installNudgeShown: number;
  accepted: number;
  /** Closing the soft prompt without accepting. Historic rows also include
   *  closes of the legacy tab nudge, with no field to tell them apart. */
  declined: number;
  /** accepted ÷ promptShown, or `null` below MIN_SAMPLE_FOR_RATE — see that
   *  constant's doc comment. */
  acceptedRate: number | null;
};

/** The Instagram Story funnel, from the `events` table. Each rate divides by
 *  the stage before it and is `null` (not 0) while that base is 0, as with
 *  InstallFunnel.conversionRate. */
export type StoryFunnel = {
  /** share_click: the share modal opened, on any device — including desktop
   *  and iPhone, where the story entry isn't shown — so it's a ceiling. */
  shareClicks: number;
  /** story_create_tap: [ video_story ] tapped. Recorded from the Android
   *  launch on; earlier story rows have no tap before them. */
  createTaps: number;
  /** story_install_gate_shown: a tab's tap, sent to install the app. A
   *  branch of createTaps, not a stage before `created`: videos are made in
   *  the installed app, whose taps go straight to the picker. */
  installGateShown: number;
  /** story_video_created: a finished recording. */
  created: number;
  /** story_video_shared: the system share sheet completed. NOT a posted
   *  story: nothing reports back from Instagram. */
  shared: number;
  /** story_link_open: a set page opened from a story's link sticker
   *  (`?ref=story`). Other people than the funnel above — the story's
   *  viewers — so outside its rates. */
  linkOpens: number;
  /** createTaps ÷ shareClicks. */
  tapRate: number | null;
  /** installGateShown ÷ createTaps: the share of taps made in a tab. */
  gateRate: number | null;
  /** created ÷ createTaps. */
  createdRate: number | null;
  /** shared ÷ created. */
  sharedRate: number | null;
  /** Same 60-day/7-day-bucket shape as InstallFunnel's trends. */
  shareClicksTrend: number[];
  createTapsTrend: number[];
  installGateShownTrend: number[];
  createdTrend: number[];
  sharedTrend: number[];
  linkOpensTrend: number[];
  /** Videos made and shared per set, most made first. */
  perSet: {
    setId: string;
    setTitle: string;
    setArtist: string;
    created: number;
    shared: number;
    linkOpens: number;
  }[];
};

export type ListeningStats = {
  /** Every second listened, as whole minutes. */
  totalMinutes: number;
  /** Distinct plays (session_id, with each pre-session_id row its own play). */
  plays: number;
  /** totalMinutes ÷ plays, one decimal; null with no plays. */
  avgMinutesPerPlay: number | null;
  /** Minutes listened per TREND_BUCKET_DAYS bucket over the last
   *  TREND_WINDOW_DAYS, oldest first. */
  weeklyMinutes: number[];
  /** Most listened first. */
  perSet: {
    setId: string;
    setTitle: string;
    setArtist: string;
    minutes: number;
    plays: number;
    avgMinutesPerPlay: number | null;
  }[];
};

export type CalendarAddStats = {
  /** AddToCalendarButton clicks, merged across all three destinations
   *  (google/outlook/.ics) — see trackableEvents.ts's calendar_add_click
   *  comment for why destination isn't split out. */
  total: number;
};

export type InstallToPushConversion = {
  installAccepted: number;
  pushSubscribers: number;
  /** pushSubscribers ÷ installAccepted, or `null` when installAccepted is 0.
   *  ⚠️ APPROXIMATE, not a tracked per-user funnel. `install_accepted` lives
   *  in `events`, which is anonymous by design (no device identifier — see
   *  schema.sql's comment on that table), and `push_subscriptions` is a
   *  separate table with no shared key (see that table's own comment on why
   *  it's deliberately never joined against `events`). This is two
   *  independent aggregate counts divided, nothing more: a tab subscriber
   *  who never saw an install prompt, or one device re-subscribing after
   *  clearing site data, both move this number without corresponding to
   *  "one more converted install". Render this with the caveat visible —
   *  never as a precise conversion rate. */
  ratio: number | null;
};

// The 60-day/7-day trend sparklines render a fixed-width window regardless of
// how much real history exists, so when a table has been tracked for less than
// the window, most of its sparkline is structural zero-padding rather than
// "nothing happened". This caption tells the reader which. Deliberately NOT
// applied to `plays`, whose history already exceeds the window.
//
// Uses the table's true `MIN(created_at)` (see `fetchEventsTrackingStart` /
// `fetchPushSubscriptionsTrackingStart` below), never an approximation from the
// already-window-limited trend rows: a window-derived guess can't tell
// "tracking started at the window boundary" from "tracking started earlier and
// the window truncated it", and the extra query is trivially cheap.
//
// Returns a day (`YYYY-MM-DD`) ONLY when it's more recent than the window's own
// start. Once real history reaches 60 days this returns `null` and the caption
// disappears on its own — no "is this still needed" check to remember later.
export function computeTrackingStartDay(
  earliestCreatedAtMs: number | null,
  now: Date = new Date(),
): string | null {
  if (earliestCreatedAtMs === null) return null;
  const windowStartMs = now.getTime() - TREND_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  if (earliestCreatedAtMs <= windowStartMs) return null;
  return new Date(earliestCreatedAtMs).toISOString().slice(0, 10);
}

export async function fetchEventsTrackingStart(db: D1Database): Promise<number | null> {
  const row = await db
    .prepare("SELECT MIN(created_at) as earliest FROM events")
    .first<{ earliest: number | null }>();
  return row?.earliest ?? null;
}

export async function fetchPushSubscriptionsTrackingStart(db: D1Database): Promise<number | null> {
  const row = await db
    .prepare("SELECT MIN(created_at) as earliest FROM push_subscriptions")
    .first<{ earliest: number | null }>();
  return row?.earliest ?? null;
}

export function computeInstallToPushConversion(
  installAccepted: number,
  pushSubscribersTotal: number,
): InstallToPushConversion {
  return {
    installAccepted,
    pushSubscribers: pushSubscribersTotal,
    ratio: installAccepted > 0 ? pushSubscribersTotal / installAccepted : null,
  };
}

// Exported so the per-tab dashboard components (GrowthTab/UsageTab/SetsTab)
// can type their `stats` prop — dashboard.tsx now splits across those files
// instead of reading fields dynamically off `Route.useLoaderData()` in one
// place.
export type AdminDashboardStats = {
  installFunnel: InstallFunnel;
  appLaunches: AppLaunchStats;
  plays: PlayStats;
  pushSubscribers: PushSubscriberStats;
  clicks: ClickStats;
  notifyFunnel: NotifyFunnel;
  storyFunnel: StoryFunnel;
  listening: ListeningStats;
  /** Marker lines for the trend charts: STATIC_MILESTONES plus push sends and
   *  set uploads from D1. */
  milestones: Milestone[];
  calendarAdds: CalendarAddStats;
  installToPushConversion: InstallToPushConversion;
  /** Non-null only when real tracking history is shorter than the 60-day
   *  trend window — see `computeTrackingStartDay`'s doc comment. Shared by
   *  `installFunnel` and `appLaunches` since both trend off the same
   *  `events` table. */
  eventsTrackingStartDay: string | null;
  /** Same idea as `eventsTrackingStartDay`, for `pushSubscribers.weeklyGrowth`. */
  pushTrackingStartDay: string | null;
  /** True only for the hand-written fixture in sample-stats.ts, substituted
   *  when there's no real Cloudflare env at all (see fetchAdminDashboardStats
   *  below) — never true against a real D1 query result. Drives the
   *  "sample data" marker in dashboard.tsx so nobody mistakes it for real. */
  isSampleData: boolean;
};

export async function fetchInstallFunnel(db: D1Database): Promise<InstallFunnel> {
  const [totals, trend] = await Promise.all([
    db
      .prepare(
        `SELECT event_type, COUNT(*) as n FROM events
         WHERE event_type IN ('install_prompt_shown', 'install_cta_instructions_shown', 'install_accepted', 'install_dismissed')
         GROUP BY event_type`,
      )
      .all<{ event_type: string; n: number }>(),
    // One query for all four event types (grouped by day AND event_type)
    // rather than three separate day-bucketed queries — same total data,
    // one D1 round trip instead of three.
    db
      .prepare(
        `SELECT DATE(created_at/1000, 'unixepoch') AS day, event_type, COUNT(*) AS count
         FROM events
         WHERE event_type IN ('install_prompt_shown', 'install_cta_instructions_shown', 'install_accepted', 'install_dismissed')
           AND created_at >= (strftime('%s', 'now', '-${TREND_WINDOW_DAYS} days') * 1000)
         GROUP BY day, event_type
         ORDER BY day ASC`,
      )
      .all<{ day: string; event_type: string; count: number }>(),
  ]);

  const counts = Object.fromEntries(totals.results.map((r) => [r.event_type, r.n]));
  const shown = counts.install_prompt_shown ?? 0;
  const instructionsShown = counts.install_cta_instructions_shown ?? 0;
  const accepted = counts.install_accepted ?? 0;
  const dismissed = counts.install_dismissed ?? 0;

  const trendFor = (eventType: string) =>
    bucketByWeek(
      fillDailyWindow(
        trend.results.filter((r) => r.event_type === eventType),
        TREND_WINDOW_DAYS,
      ),
      TREND_BUCKET_DAYS,
    );

  return {
    shown,
    instructionsShown,
    accepted,
    dismissed,
    conversionRate: shown > 0 ? accepted / shown : null,
    shownTrend: trendFor("install_prompt_shown"),
    instructionsShownTrend: trendFor("install_cta_instructions_shown"),
    acceptedTrend: trendFor("install_accepted"),
    dismissedTrend: trendFor("install_dismissed"),
  };
}

export async function fetchAppLaunchStats(db: D1Database): Promise<AppLaunchStats> {
  const [totalRow, trend] = await Promise.all([
    db
      .prepare("SELECT COUNT(*) as total FROM events WHERE event_type = 'app_launch'")
      .first<{ total: number }>(),
    db
      .prepare(
        `SELECT DATE(created_at/1000, 'unixepoch') AS day, COUNT(*) AS count
         FROM events
         WHERE event_type = 'app_launch'
           AND created_at >= (strftime('%s', 'now', '-${TREND_WINDOW_DAYS} days') * 1000)
         GROUP BY day
         ORDER BY day ASC`,
      )
      .all<{ day: string; count: number }>(),
  ]);

  const dailyDense = fillDailyWindow(trend.results, TREND_WINDOW_DAYS);
  return {
    total: totalRow?.total ?? 0,
    weeklyTrend: bucketByWeek(dailyDense, TREND_BUCKET_DAYS),
  };
}

export async function fetchPlayStats(db: D1Database): Promise<PlayStats> {
  // `total`, `topSets.play_count` and the trend below all use
  // COUNT(DISTINCT COALESCE(session_id, 'legacy-' || id)), not COUNT(*):
  // `plays` has one row per ≥3s LISTENING SEGMENT (sendPlay fires on
  // pause/track-change/unload), not one row per play — see schema.sql's
  // `session_id` comment for the full mechanism and why the COALESCE
  // fallback is safe for rows that predate that column.
  //
  // offline_count/online_count deliberately stay COUNT(*): that ratio
  // measures volume of listening ACTIVITY by delivery mode, not distinct
  // plays, and a session that crosses connectivity states has no single
  // correct bucket to collapse into.
  const [totals, topSets, trend] = await Promise.all([
    db
      .prepare(
        `SELECT COUNT(DISTINCT COALESCE(session_id, 'legacy-' || id)) as total,
                COALESCE(SUM(CASE WHEN is_offline = 1 THEN 1 ELSE 0 END), 0) as offline_count,
                COALESCE(SUM(CASE WHEN is_offline = 0 THEN 1 ELSE 0 END), 0) as online_count
         FROM plays`,
      )
      .first<{ total: number; offline_count: number; online_count: number }>(),
    db
      .prepare(
        `SELECT set_id, COUNT(DISTINCT COALESCE(session_id, 'legacy-' || id)) as play_count
         FROM plays
         GROUP BY set_id
         ORDER BY play_count DESC
         LIMIT 5`,
      )
      .all<{ set_id: string; play_count: number }>(),
    // `started_at` (unix ms), not `created_at` — `plays` has no created_at
    // column; the play's own start time is the event time here. Same
    // per-day dedup as `total` above — a session spanning midnight counts
    // once on each day it touches, which is the right trend semantics.
    db
      .prepare(
        `SELECT DATE(started_at/1000, 'unixepoch') AS day,
                COUNT(DISTINCT COALESCE(session_id, 'legacy-' || id)) AS count
         FROM plays
         WHERE started_at >= (strftime('%s', 'now', '-${TREND_WINDOW_DAYS} days') * 1000)
         GROUP BY day
         ORDER BY day ASC`,
      )
      .all<{ day: string; count: number }>(),
  ]);

  const total = totals?.total ?? 0;
  const offlineCount = totals?.offline_count ?? 0;
  const onlineCount = totals?.online_count ?? 0;
  return {
    total,
    offlineCount,
    onlineCount,
    excludedCount: total - offlineCount - onlineCount,
    weeklyTrend: bucketByWeek(fillDailyWindow(trend.results, TREND_WINDOW_DAYS), TREND_BUCKET_DAYS),
    // Title/artist come from the catalogue, not the row — `plays` denormalizes
    // both onto every play event, captured at play time rather than joined
    // live, so a set whose title text changed (even just casing — "FORM:AT
    // 002" vs "Form:at 002" both exist in production) splits its own play
    // count across multiple GROUP BY buckets if grouped on that text: same
    // set_id, different `topSets` rows, found against real dashboard data.
    // Grouping on set_id alone and resolving the label from the catalogue
    // matches fetchClickStats' identical fix for `events`, which never
    // denormalized title/artist for exactly this reason.
    topSets: topSets.results.map((r) => {
      const set = getSet(r.set_id);
      return {
        setId: r.set_id,
        setTitle: set?.title ?? r.set_id,
        setArtist: set?.artist ?? "unknown",
        playCount: r.play_count,
      };
    }),
  };
}

// No trend arrays here — same call as ClickStats: ~16 total events across
// four types would make a 60-day sparkline near-empty noise, not a useful
// chart.
export async function fetchNotifyFunnel(db: D1Database): Promise<NotifyFunnel> {
  const totals = await db
    .prepare(
      `SELECT event_type, COUNT(*) as n FROM events
       WHERE event_type IN ('notify_prompt_shown', 'notify_accepted', 'notify_declined', 'notify_install_nudge_shown')
       GROUP BY event_type`,
    )
    .all<{ event_type: string; n: number }>();

  const counts = Object.fromEntries(totals.results.map((r) => [r.event_type, r.n]));
  const promptShown = counts.notify_prompt_shown ?? 0;
  const installNudgeShown = counts.notify_install_nudge_shown ?? 0;
  const accepted = counts.notify_accepted ?? 0;
  const declined = counts.notify_declined ?? 0;

  return {
    promptShown,
    installNudgeShown,
    accepted,
    declined,
    acceptedRate: promptShown >= MIN_SAMPLE_FOR_RATE ? accepted / promptShown : null,
  };
}

const STORY_EVENT_TYPES = [
  "share_click",
  "story_create_tap",
  "story_install_gate_shown",
  "story_video_created",
  "story_video_shared",
  "story_link_open",
] as const;
const STORY_EVENTS_IN = STORY_EVENT_TYPES.map((t) => `'${t}'`).join(", ");

const rate = (part: number, base: number) => (base > 0 ? part / base : null);

export async function fetchStoryFunnel(db: D1Database): Promise<StoryFunnel> {
  const [totals, trend, perSetRows] = await Promise.all([
    db
      .prepare(
        `SELECT event_type, COUNT(*) as n FROM events
         WHERE event_type IN (${STORY_EVENTS_IN})
         GROUP BY event_type`,
      )
      .all<{ event_type: string; n: number }>(),
    db
      .prepare(
        `SELECT DATE(created_at/1000, 'unixepoch') AS day, event_type, COUNT(*) AS count
         FROM events
         WHERE event_type IN (${STORY_EVENTS_IN})
           AND created_at >= (strftime('%s', 'now', '-${TREND_WINDOW_DAYS} days') * 1000)
         GROUP BY day, event_type
         ORDER BY day ASC`,
      )
      .all<{ day: string; event_type: string; count: number }>(),
    db
      .prepare(
        `SELECT set_id, event_type, COUNT(*) as n FROM events
         WHERE event_type IN ('story_video_created', 'story_video_shared', 'story_link_open')
           AND set_id IS NOT NULL
         GROUP BY set_id, event_type`,
      )
      .all<{ set_id: string; event_type: string; n: number }>(),
  ]);

  const counts = Object.fromEntries(totals.results.map((r) => [r.event_type, r.n]));
  const shareClicks = counts.share_click ?? 0;
  const createTaps = counts.story_create_tap ?? 0;
  const installGateShown = counts.story_install_gate_shown ?? 0;
  const created = counts.story_video_created ?? 0;
  const shared = counts.story_video_shared ?? 0;
  const linkOpens = counts.story_link_open ?? 0;

  const trendFor = (eventType: string) =>
    bucketByWeek(
      fillDailyWindow(
        trend.results.filter((r) => r.event_type === eventType),
        TREND_WINDOW_DAYS,
      ),
      TREND_BUCKET_DAYS,
    );

  // Titles from the catalogue, as fetchClickStats does: events store only set_id.
  const bySet = new Map<string, { created: number; shared: number; linkOpens: number }>();
  for (const row of perSetRows.results) {
    const entry = bySet.get(row.set_id) ?? { created: 0, shared: 0, linkOpens: 0 };
    if (row.event_type === "story_video_created") entry.created = row.n;
    if (row.event_type === "story_video_shared") entry.shared = row.n;
    if (row.event_type === "story_link_open") entry.linkOpens = row.n;
    bySet.set(row.set_id, entry);
  }
  const perSet = [...bySet.entries()]
    .map(([setId, n]) => {
      const set = getSet(setId);
      return { setId, setTitle: set?.title ?? setId, setArtist: set?.artist ?? "unknown", ...n };
    })
    .sort((a, b) => b.created - a.created || b.shared - a.shared || b.linkOpens - a.linkOpens);

  return {
    shareClicks,
    createTaps,
    installGateShown,
    created,
    shared,
    linkOpens,
    tapRate: rate(createTaps, shareClicks),
    gateRate: rate(installGateShown, createTaps),
    createdRate: rate(created, createTaps),
    sharedRate: rate(shared, created),
    shareClicksTrend: trendFor("share_click"),
    createTapsTrend: trendFor("story_create_tap"),
    installGateShownTrend: trendFor("story_install_gate_shown"),
    createdTrend: trendFor("story_video_created"),
    sharedTrend: trendFor("story_video_shared"),
    linkOpensTrend: trendFor("story_link_open"),
    perSet,
  };
}

const toMinutes = (seconds: number) => Math.round(seconds / 60);
const minutesPerPlay = (seconds: number, plays: number) =>
  plays > 0 ? Math.round((seconds / 60 / plays) * 10) / 10 : null;

// Plays are distinct session_ids, never rows: a row is one listening segment
// (see schema.sql's session_id comment). Minutes are SUM(listened_seconds),
// which is right per row.
const DISTINCT_PLAYS = "COUNT(DISTINCT COALESCE(session_id, 'legacy-' || id))";

export async function fetchListeningStats(db: D1Database): Promise<ListeningStats> {
  const [totals, trend, perSetRows] = await Promise.all([
    db
      .prepare(
        `SELECT COALESCE(SUM(listened_seconds), 0) AS seconds, ${DISTINCT_PLAYS} AS plays FROM plays`,
      )
      .first<{ seconds: number; plays: number }>(),
    db
      .prepare(
        `SELECT DATE(started_at/1000, 'unixepoch') AS day, SUM(listened_seconds) AS count
         FROM plays
         WHERE started_at >= (strftime('%s', 'now', '-${TREND_WINDOW_DAYS} days') * 1000)
         GROUP BY day
         ORDER BY day ASC`,
      )
      .all<{ day: string; count: number }>(),
    db
      .prepare(
        `SELECT set_id, SUM(listened_seconds) AS seconds, ${DISTINCT_PLAYS} AS plays
         FROM plays GROUP BY set_id`,
      )
      .all<{ set_id: string; seconds: number; plays: number }>(),
  ]);

  const seconds = totals?.seconds ?? 0;
  const plays = totals?.plays ?? 0;
  const weeklySeconds = bucketByWeek(
    fillDailyWindow(trend.results, TREND_WINDOW_DAYS),
    TREND_BUCKET_DAYS,
  );
  const perSet = perSetRows.results
    .map((row) => {
      const set = getSet(row.set_id);
      return {
        setId: row.set_id,
        setTitle: set?.title ?? row.set_id,
        setArtist: set?.artist ?? "unknown",
        minutes: toMinutes(row.seconds),
        plays: row.plays,
        avgMinutesPerPlay: minutesPerPlay(row.seconds, row.plays),
      };
    })
    .sort((a, b) => b.minutes - a.minutes);

  return {
    totalMinutes: toMinutes(seconds),
    plays,
    avgMinutesPerPlay: minutesPerPlay(seconds, plays),
    weeklyMinutes: weeklySeconds.map(toMinutes),
    perSet,
  };
}

/**
 * STATIC_MILESTONES plus push sends and set uploads over the trend window,
 * one marker per day and kind. Uploads only: legacy sets were migrated in
 * with a placeholder created_at and no artwork_original_url (upload-only), so
 * that column keeps them out.
 */
export async function fetchMilestones(db: D1Database): Promise<Milestone[]> {
  const since = `(strftime('%s', 'now', '-${TREND_WINDOW_DAYS} days') * 1000)`;
  const [pushes, uploads] = await Promise.all([
    db
      .prepare(
        `SELECT DATE(sent_at/1000, 'unixepoch') AS day, title FROM admin_push_sends
         WHERE sent_at >= ${since} ORDER BY sent_at ASC`,
      )
      .all<{ day: string; title: string }>(),
    db
      .prepare(
        `SELECT DATE(created_at/1000, 'unixepoch') AS day, artist, title FROM sets
         WHERE created_at >= ${since} AND artwork_original_url IS NOT NULL ORDER BY created_at ASC`,
      )
      .all<{ day: string; artist: string; title: string }>(),
  ]);

  const byDay = (
    rows: { day: string; label: string }[],
    kind: "push" | "upload",
    [one, many]: [string, string],
  ) => {
    const days = new Map<string, string[]>();
    for (const row of rows) days.set(row.day, [...(days.get(row.day) ?? []), row.label]);
    return [...days].map(([date, labels]) => ({
      date,
      kind,
      label:
        labels.length === 1
          ? `${one}: ${labels[0]}`
          : `${labels.length} ${many}: ${labels.join(", ")}`,
    }));
  };

  return [
    ...STATIC_MILESTONES,
    ...byDay(
      pushes.results.map((r) => ({ day: r.day, label: r.title })),
      "push",
      ["push", "pushes"],
    ),
    ...byDay(
      uploads.results.map((r) => ({ day: r.day, label: `${r.artist} @ ${r.title}` })),
      "upload",
      ["set added", "sets added"],
    ),
  ].sort((a, b) => a.date.localeCompare(b.date));
}

export async function fetchCalendarAddStats(db: D1Database): Promise<CalendarAddStats> {
  const row = await db
    .prepare("SELECT COUNT(*) as total FROM events WHERE event_type = 'calendar_add_click'")
    .first<{ total: number }>();
  return { total: row?.total ?? 0 };
}

// ⚠️ Only ever SELECTs `is_standalone` / `created_at` (plus COUNT) from
// `push_subscriptions` — never `endpoint` / `p256dh` / `auth`. Per
// schema.sql's own comment on this table: a subscription's `endpoint` is
// an addressable per-device token by necessity (that's how push delivery
// works), and the mitigation for that is scope — this table is read here
// for aggregate counts only, the same discipline every other consumer of
// this table (besides the send script itself) must hold to.
export async function fetchPushSubscriberStats(db: D1Database): Promise<PushSubscriberStats> {
  const [totals, trend] = await Promise.all([
    db
      .prepare(
        `SELECT COUNT(*) as total,
                COALESCE(SUM(CASE WHEN is_standalone = 1 THEN 1 ELSE 0 END), 0) as standalone_count,
                COALESCE(SUM(CASE WHEN is_standalone = 0 THEN 1 ELSE 0 END), 0) as tab_count
         FROM push_subscriptions`,
      )
      .first<{ total: number; standalone_count: number; tab_count: number }>(),
    db
      .prepare(
        `SELECT DATE(created_at/1000, 'unixepoch') AS day, COUNT(*) AS count
         FROM push_subscriptions
         WHERE created_at >= (strftime('%s', 'now', '-${TREND_WINDOW_DAYS} days') * 1000)
         GROUP BY day
         ORDER BY day ASC`,
      )
      .all<{ day: string; count: number }>(),
  ]);

  const dailyDense = fillDailyWindow(trend.results, TREND_WINDOW_DAYS);
  return {
    total: totals?.total ?? 0,
    standaloneCount: totals?.standalone_count ?? 0,
    tabCount: totals?.tab_count ?? 0,
    weeklyGrowth: bucketByWeek(dailyDense, TREND_BUCKET_DAYS),
  };
}

export async function fetchClickStats(db: D1Database): Promise<ClickStats> {
  const [totals, perSetRows] = await Promise.all([
    db
      .prepare(
        `SELECT event_type, COUNT(*) as n FROM events
         WHERE event_type IN ('save_click', 'share_click')
         GROUP BY event_type`,
      )
      .all<{ event_type: string; n: number }>(),
    db
      .prepare(
        `SELECT set_id, event_type, COUNT(*) as n FROM events
         WHERE event_type IN ('save_click', 'share_click') AND set_id IS NOT NULL
         GROUP BY set_id, event_type`,
      )
      .all<{ set_id: string; event_type: string; n: number }>(),
  ]);

  const totalCounts = Object.fromEntries(totals.results.map((r) => [r.event_type, r.n]));

  // events stores only set_id (no denormalized title/artist, unlike `plays`)
  // — map to a title/artist via the static catalogue, the same source
  // `getSet()` already provides for the public routes.
  const bySet = new Map<string, { saveClicks: number; shareClicks: number }>();
  for (const row of perSetRows.results) {
    const entry = bySet.get(row.set_id) ?? { saveClicks: 0, shareClicks: 0 };
    if (row.event_type === "save_click") entry.saveClicks = row.n;
    if (row.event_type === "share_click") entry.shareClicks = row.n;
    bySet.set(row.set_id, entry);
  }
  const perSet = [...bySet.entries()]
    .map(([setId, counts]) => {
      const set = getSet(setId);
      return {
        setId,
        setTitle: set?.title ?? setId,
        setArtist: set?.artist ?? "unknown",
        ...counts,
      };
    })
    .sort((a, b) => b.saveClicks + b.shareClicks - (a.saveClicks + a.shareClicks));

  return {
    saveClicks: totalCounts.save_click ?? 0,
    shareClicks: totalCounts.share_click ?? 0,
    perSet,
  };
}

// `hasCloudflareEnv` (set by server.ts from the raw `env` argument, before
// it gets coalesced to `{}`) tells apart "no D1 binding because we're not
// running under Cloudflare at all" (plain `vite dev`/e2e — safe to fake)
// from "no D1 binding despite a real Cloudflare env" (a real deployment
// mid-setup, or D1 genuinely down — must stay honest, never show sample
// data there). NODE_ENV was considered and rejected: it's baked into
// _worker.js at BUILD time via esbuild's --define, so it reads "production"
// for every built worker regardless of where that worker actually runs
// (local `wrangler pages dev` or the real deployment) — it can't make this
// distinction. Extracted as its own function, like every other query below,
// so it's directly unit-testable without going through createServerFn.
export function pickStatsForMissingDb(
  hasCloudflareEnv: boolean | undefined,
): AdminDashboardStats | null {
  return hasCloudflareEnv ? null : SAMPLE_ADMIN_DASHBOARD_STATS;
}

export const fetchAdminDashboardStats = createServerFn({ method: "GET" }).handler(
  async ({ context }) => {
    try {
      const cf = (context as unknown as Record<string, unknown>).cloudflare as
        | {
            env: { DB: D1Database; CF_ANALYTICS_TOKEN?: string; CF_ZONE_ID?: string };
            hasCloudflareEnv: boolean;
          }
        | undefined;
      const db = cf?.env?.DB;
      if (!db) return pickStatsForMissingDb(cf?.hasCloudflareEnv);

      const [
        installFunnel,
        appLaunches,
        plays,
        pushSubscribers,
        clicks,
        notifyFunnel,
        storyFunnel,
        listening,
        milestones,
        calendarAdds,
        eventsEarliest,
        pushEarliest,
      ] = await Promise.all([
        fetchInstallFunnel(db),
        fetchAppLaunchStats(db),
        fetchPlayStats(db),
        fetchPushSubscriberStats(db),
        fetchClickStats(db),
        fetchNotifyFunnel(db),
        fetchStoryFunnel(db),
        fetchListeningStats(db),
        fetchMilestones(db),
        fetchCalendarAddStats(db),
        fetchEventsTrackingStart(db),
        fetchPushSubscriptionsTrackingStart(db),
      ]);

      // No new query — just dividing two aggregates already fetched above.
      // See InstallToPushConversion's doc comment for why this can't be a
      // real per-user join.
      const installToPushConversion = computeInstallToPushConversion(
        installFunnel.accepted,
        pushSubscribers.total,
      );

      return {
        installFunnel,
        appLaunches,
        plays,
        pushSubscribers,
        clicks,
        notifyFunnel,
        storyFunnel,
        listening,
        milestones,
        calendarAdds,
        installToPushConversion,
        eventsTrackingStartDay: computeTrackingStartDay(eventsEarliest),
        pushTrackingStartDay: computeTrackingStartDay(pushEarliest),
        isSampleData: false,
      } satisfies AdminDashboardStats;
    } catch {
      return null;
    }
  },
);

// Separate from `fetchAdminDashboardStats` on purpose: this is the page's only
// NETWORK call (Cloudflare's GraphQL API), so the route DEFERS it — see
// dashboard.tsx's loader. Bundling it into the stats object would make the
// whole dashboard wait on it, up to cf-analytics.ts's 8s timeout, which is
// exactly what deferring avoids.
//
// Returns null on every failure (fetchEdgeTraffic swallows them all), and the
// sample fixture when there's no Cloudflare env at all — mirroring
// `pickStatsForMissingDb` so local dev and the e2e suite exercise the
// populated card instead of only its empty state.
export const fetchEdgeTrafficStats = createServerFn({ method: "GET" }).handler(
  async ({ context }): Promise<EdgeTraffic | null> => {
    const cf = (context as unknown as Record<string, unknown>).cloudflare as
      | {
          env: { CF_ANALYTICS_TOKEN?: string; CF_ZONE_ID?: string };
          hasCloudflareEnv: boolean;
        }
      | undefined;
    if (!cf?.hasCloudflareEnv) return SAMPLE_EDGE_TRAFFIC;
    return fetchEdgeTraffic(cf.env?.CF_ANALYTICS_TOKEN, cf.env?.CF_ZONE_ID);
  },
);

// Independent of `fetchEdgeTrafficStats` on purpose, not merged into one call.
// They query different scopes (account vs zone) needing DIFFERENT token
// permissions, so a token missing one should blank one card, not both — and
// the likely failure right now is exactly that. Two deferred round-trips, both
// off the critical path.
export const fetchRumVisitStats = createServerFn({ method: "GET" }).handler(
  async ({ context }): Promise<RumVisits | null> => {
    const cf = (context as unknown as Record<string, unknown>).cloudflare as
      | {
          env: { CF_ANALYTICS_TOKEN?: string; CF_ACCOUNT_ID?: string };
          hasCloudflareEnv: boolean;
        }
      | undefined;
    if (!cf?.hasCloudflareEnv) return SAMPLE_RUM_VISITS;
    // Site tag comes from @form-at/data, not env: it's already published in
    // every page of the public site, so one committed constant beats two copies.
    return fetchRumVisits(
      cf.env?.CF_ANALYTICS_TOKEN,
      cf.env?.CF_ACCOUNT_ID,
      WEB_ANALYTICS_SITE_TAG,
    );
  },
);
