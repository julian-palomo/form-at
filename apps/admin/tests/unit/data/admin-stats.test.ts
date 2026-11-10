import { TREND_BUCKET_DAYS, TREND_WINDOW_DAYS } from "@form-at/data/set-stats";
import { describe, expect, it } from "vitest";
import {
  MIN_SAMPLE_FOR_RATE,
  computeInstallToPushConversion,
  computeTrackingStartDay,
  fetchAppLaunchStats,
  fetchCalendarAddStats,
  fetchClickStats,
  fetchEventsTrackingStart,
  fetchInstallFunnel,
  fetchListeningStats,
  fetchMilestones,
  fetchNotifyFunnel,
  fetchPlayStats,
  fetchPushSubscriberStats,
  fetchPushSubscriptionsTrackingStart,
  fetchStoryFunnel,
  pickStatsForMissingDb,
} from "~/data/admin-stats";
import { SAMPLE_ADMIN_DASHBOARD_STATS } from "~/data/sample-stats";

// No D1-querying loader in this codebase had a test before this file (verified
// against set-stats.ts's fetchOverallStats/fetchSetStats — neither has one).
// This fake models the one shape every query in admin-stats.ts actually uses:
// `db.prepare(sql).bind(...).first()` or `.all()`. Routes are matched by a
// regex against the SQL text rather than call order, since several functions
// fire more than one query via Promise.all in no guaranteed sequence.
type FakeRoute = {
  match: RegExp;
  first?: Record<string, unknown> | null;
  all?: Record<string, unknown>[];
};

function createFakeD1(routes: FakeRoute[]): { db: D1Database; queries: string[] } {
  const queries: string[] = [];
  const db = {
    prepare: (sql: string) => {
      queries.push(sql);
      const route = routes.find((r) => r.match.test(sql));
      if (!route) throw new Error(`No fake D1 route matched SQL:\n${sql}`);
      const statement = {
        bind: () => statement,
        first: async <T>() => (route.first ?? null) as T | null,
        all: async <T>() => ({ results: (route.all ?? []) as T[] }),
      };
      return statement;
    },
  } as unknown as D1Database;
  return { db, queries };
}

describe("fetchInstallFunnel", () => {
  // The totals and trend queries both hit `events` with an `event_type IN
  // (...)` filter, so the route match has to key on text unique to each:
  // the totals query aliases its count `as n`, the trend query group-bys
  // `day, event_type` (and aliases the count `AS count`). A broader match
  // like `/FROM events/` would match both queries and silently route the
  // trend query's `.all()` through the totals fixture instead.
  const totalsRoute = (all: Record<string, unknown>[]): FakeRoute => ({
    match: /COUNT\(\*\) as n/,
    all,
  });
  const trendRoute = (all: Record<string, unknown>[] = []): FakeRoute => ({
    match: /GROUP BY day, event_type/,
    all,
  });

  it("computes conversionRate as accepted ÷ shown", async () => {
    const { db } = createFakeD1([
      totalsRoute([
        { event_type: "install_prompt_shown", n: 10 },
        { event_type: "install_accepted", n: 4 },
        { event_type: "install_dismissed", n: 6 },
      ]),
      trendRoute(),
    ]);

    const result = await fetchInstallFunnel(db);

    expect(result).toMatchObject({ shown: 10, accepted: 4, dismissed: 6, conversionRate: 0.4 });
  });

  it("counts install_the_app's instructions opens as their own entry point, outside the rate", async () => {
    const { db, queries } = createFakeD1([
      totalsRoute([
        { event_type: "install_prompt_shown", n: 10 },
        { event_type: "install_cta_instructions_shown", n: 7 },
        { event_type: "install_accepted", n: 4 },
      ]),
      // Dated today: the 60-day window ends today, and 60 days in 7-day
      // buckets is 9 buckets with today in the last one.
      trendRoute([
        {
          day: new Date().toISOString().slice(0, 10),
          event_type: "install_cta_instructions_shown",
          count: 3,
        },
      ]),
    ]);

    const result = await fetchInstallFunnel(db);

    expect(result.instructionsShown).toBe(7);
    expect(result.conversionRate).toBe(0.4);
    expect(result.instructionsShownTrend).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 3]);
    expect(result.shownTrend).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(queries.every((q) => q.includes("'install_cta_instructions_shown'"))).toBe(true);
  });

  it("returns conversionRate null (not 0) when nothing has been shown yet", async () => {
    const { db } = createFakeD1([totalsRoute([]), trendRoute()]);

    const result = await fetchInstallFunnel(db);

    expect(result).toMatchObject({ shown: 0, accepted: 0, dismissed: 0, conversionRate: null });
  });

  it("buckets each event type's daily trend independently into 7-day sums", async () => {
    const today = new Date().toISOString().slice(0, 10);
    const { db } = createFakeD1([
      totalsRoute([]),
      trendRoute([
        { day: today, event_type: "install_prompt_shown", count: 5 },
        { day: today, event_type: "install_accepted", count: 2 },
      ]),
    ]);

    const result = await fetchInstallFunnel(db);

    const expectedBuckets = Math.ceil(TREND_WINDOW_DAYS / TREND_BUCKET_DAYS);
    expect(result.shownTrend).toHaveLength(expectedBuckets);
    expect(result.shownTrend.at(-1)).toBe(5);
    expect(result.acceptedTrend.at(-1)).toBe(2);
    expect(result.dismissedTrend.every((n) => n === 0)).toBe(true);
  });
});

describe("fetchAppLaunchStats", () => {
  it("passes through the total and buckets the daily trend into weekly sums", async () => {
    const today = new Date().toISOString().slice(0, 10);
    const { db } = createFakeD1([
      { match: /COUNT\(\*\) as total/, first: { total: 42 } },
      { match: /GROUP BY day/, all: [{ day: today, count: 5 }] },
    ]);

    const result = await fetchAppLaunchStats(db);

    expect(result.total).toBe(42);
    expect(result.weeklyTrend).toHaveLength(Math.ceil(TREND_WINDOW_DAYS / TREND_BUCKET_DAYS));
    expect(result.weeklyTrend.at(-1)).toBe(5);
  });

  it("defaults to 0 when the total query returns no row", async () => {
    const { db } = createFakeD1([
      { match: /COUNT\(\*\) as total/, first: null },
      { match: /GROUP BY day/, all: [] },
    ]);

    const result = await fetchAppLaunchStats(db);

    expect(result.total).toBe(0);
    expect(result.weeklyTrend.every((n) => n === 0)).toBe(true);
  });
});

describe("fetchPlayStats", () => {
  it("maps offline/online counts, and resolves top sets' title/artist from the catalogue, not the row", async () => {
    const today = new Date().toISOString().slice(0, 10);
    // The trend query also reads FROM plays, so it needs its own route ahead of
    // the general one — routes are matched in order against the SQL text.
    // No set_title/set_artist in the mocked row: the query no longer selects
    // them (see fetchPlayStats' own comment for why — plays denormalizes that
    // text per play event, which split one set's count across multiple rows
    // when its title text changed). getSet("set-002-til") resolves against
    // the real committed catalogue, same precedent as fetchClickStats below.
    const { db } = createFakeD1([
      { match: /GROUP BY day/, all: [{ day: today, count: 3 }] },
      {
        match: /FROM plays/,
        first: { total: 100, offline_count: 30, online_count: 70 },
        all: [{ set_id: "set-002-til", play_count: 12 }],
      },
    ]);

    const result = await fetchPlayStats(db);

    expect(result.total).toBe(100);
    expect(result.offlineCount).toBe(30);
    expect(result.onlineCount).toBe(70);
    expect(result.excludedCount).toBe(0);
    expect(result.topSets).toEqual([
      { setId: "set-002-til", setTitle: "Form:at 002", setArtist: "t.i.l.", playCount: 12 },
    ]);
  });

  it("falls back to the raw id and 'unknown' when a played set isn't in the catalogue (e.g. deleted, or not yet in the snapshot)", async () => {
    const today = new Date().toISOString().slice(0, 10);
    const { db } = createFakeD1([
      { match: /GROUP BY day/, all: [{ day: today, count: 0 }] },
      {
        match: /FROM plays/,
        first: { total: 1, offline_count: 0, online_count: 1 },
        all: [{ set_id: "set-not-in-catalogue", play_count: 1 }],
      },
    ]);

    const result = await fetchPlayStats(db);

    expect(result.topSets).toEqual([
      {
        setId: "set-not-in-catalogue",
        setTitle: "set-not-in-catalogue",
        setArtist: "unknown",
        playCount: 1,
      },
    ]);
  });

  it("buckets the daily play trend into weekly sums, like every other trend", async () => {
    const today = new Date().toISOString().slice(0, 10);
    const { db } = createFakeD1([
      { match: /GROUP BY day/, all: [{ day: today, count: 4 }] },
      { match: /FROM plays/, first: { total: 4, offline_count: 4, online_count: 0 }, all: [] },
    ]);

    const result = await fetchPlayStats(db);

    // Weekly buckets, not 60 daily values — TrendChart derives its axis from
    // length x bucketDays, so a daily series would draw a 413-day span.
    expect(result.weeklyTrend).toHaveLength(Math.ceil(TREND_WINDOW_DAYS / TREND_BUCKET_DAYS));
    expect(result.weeklyTrend.at(-1)).toBe(4);
  });

  it("computes excludedCount as total minus offline/online (plays predating is_offline tracking)", async () => {
    const { db } = createFakeD1([
      { match: /FROM plays/, first: { total: 292, offline_count: 9, online_count: 27 }, all: [] },
    ]);

    const result = await fetchPlayStats(db);

    expect(result.excludedCount).toBe(256);
  });
});

describe("fetchPushSubscriberStats", () => {
  it("maps standalone/tab counts and the weekly growth trend", async () => {
    const today = new Date().toISOString().slice(0, 10);
    const { db } = createFakeD1([
      {
        match: /COUNT\(\*\) as total[\s\S]*FROM push_subscriptions/,
        first: { total: 8, standalone_count: 5, tab_count: 3 },
      },
      { match: /GROUP BY day/, all: [{ day: today, count: 2 }] },
    ]);

    const result = await fetchPushSubscriberStats(db);

    expect(result).toMatchObject({ total: 8, standaloneCount: 5, tabCount: 3 });
    expect(result.weeklyGrowth.at(-1)).toBe(2);
  });

  it("never selects endpoint, p256dh, or auth off push_subscriptions", async () => {
    const { db, queries } = createFakeD1([
      {
        match: /COUNT\(\*\) as total[\s\S]*FROM push_subscriptions/,
        first: { total: 0, standalone_count: 0, tab_count: 0 },
      },
      { match: /GROUP BY day/, all: [] },
    ]);

    await fetchPushSubscriberStats(db);

    const pushSubQueries = queries.filter((q) => q.includes("push_subscriptions"));
    expect(pushSubQueries.length).toBeGreaterThan(0);
    for (const sql of pushSubQueries) {
      expect(sql).not.toMatch(/\bendpoint\b/);
      expect(sql).not.toMatch(/\bp256dh\b/);
      expect(sql).not.toMatch(/\bauth\b/);
    }
  });
});

describe("fetchClickStats", () => {
  // Same disambiguation need as fetchInstallFunnel above: the totals query
  // selects `event_type, COUNT...`, the per-set query selects `set_id,
  // event_type, COUNT...` — matching on the leading column list keeps the
  // two routes from colliding.
  const totalsRoute = (all: Record<string, unknown>[]): FakeRoute => ({
    match: /SELECT event_type, COUNT/,
    all,
  });
  const perSetRoute = (all: Record<string, unknown>[] = []): FakeRoute => ({
    match: /SELECT set_id, event_type/,
    all,
  });

  it("defaults save/share clicks to 0 when neither event type has rows", async () => {
    const { db } = createFakeD1([totalsRoute([]), perSetRoute()]);

    const result = await fetchClickStats(db);

    expect(result).toEqual({ saveClicks: 0, shareClicks: 0, perSet: [] });
  });

  it("reads save_click and share_click counts independently", async () => {
    const { db } = createFakeD1([
      totalsRoute([
        { event_type: "save_click", n: 7 },
        { event_type: "share_click", n: 2 },
      ]),
      perSetRoute(),
    ]);

    const result = await fetchClickStats(db);

    expect(result).toMatchObject({ saveClicks: 7, shareClicks: 2 });
  });

  it("groups per-set clicks, maps set_id to title/artist via the catalogue, ranked by total desc", async () => {
    const { db } = createFakeD1([
      totalsRoute([]),
      perSetRoute([
        { set_id: "set-002-til", event_type: "save_click", n: 1 },
        { set_id: "set-002-hubey", event_type: "save_click", n: 3 },
        { set_id: "set-002-hubey", event_type: "share_click", n: 2 },
      ]),
    ]);

    const result = await fetchClickStats(db);

    expect(result.perSet).toEqual([
      {
        setId: "set-002-hubey",
        setTitle: "Form:at 002",
        setArtist: "hubey",
        saveClicks: 3,
        shareClicks: 2,
      },
      {
        setId: "set-002-til",
        setTitle: "Form:at 002",
        setArtist: "t.i.l.",
        saveClicks: 1,
        shareClicks: 0,
      },
    ]);
  });

  it("falls back to the raw set_id when a click references a set no longer in the catalogue", async () => {
    const { db } = createFakeD1([
      totalsRoute([]),
      perSetRoute([{ set_id: "set-999-unknown", event_type: "save_click", n: 1 }]),
    ]);

    const result = await fetchClickStats(db);

    expect(result.perSet).toEqual([
      {
        setId: "set-999-unknown",
        setTitle: "set-999-unknown",
        setArtist: "unknown",
        saveClicks: 1,
        shareClicks: 0,
      },
    ]);
  });
});

describe("fetchNotifyFunnel", () => {
  const totalsRoute = (all: Record<string, unknown>[]): FakeRoute => ({
    match: /COUNT\(\*\) as n/,
    all,
  });

  it("maps all four notify_* counts independently", async () => {
    const { db } = createFakeD1([
      totalsRoute([
        { event_type: "notify_prompt_shown", n: 30 },
        { event_type: "notify_install_nudge_shown", n: 45 },
        { event_type: "notify_accepted", n: 12 },
        { event_type: "notify_declined", n: 18 },
      ]),
    ]);

    const result = await fetchNotifyFunnel(db);

    expect(result).toMatchObject({
      promptShown: 30,
      installNudgeShown: 45,
      accepted: 12,
      declined: 18,
    });
  });

  it("defaults every count to 0 when no rows exist", async () => {
    const { db } = createFakeD1([totalsRoute([])]);

    const result = await fetchNotifyFunnel(db);

    expect(result).toEqual({
      promptShown: 0,
      installNudgeShown: 0,
      accepted: 0,
      declined: 0,
      acceptedRate: null,
    });
  });

  it("suppresses acceptedRate to null below MIN_SAMPLE_FOR_RATE (2/2 = 100% off two people)", async () => {
    const { db } = createFakeD1([
      totalsRoute([
        { event_type: "notify_prompt_shown", n: 2 },
        { event_type: "notify_accepted", n: 2 },
      ]),
    ]);

    const result = await fetchNotifyFunnel(db);

    expect(result.promptShown).toBeLessThan(MIN_SAMPLE_FOR_RATE);
    expect(result.acceptedRate).toBeNull();
  });

  it("computes a real acceptedRate at or above MIN_SAMPLE_FOR_RATE", async () => {
    const { db } = createFakeD1([
      totalsRoute([
        { event_type: "notify_prompt_shown", n: MIN_SAMPLE_FOR_RATE },
        { event_type: "notify_accepted", n: 5 },
      ]),
    ]);

    const result = await fetchNotifyFunnel(db);

    expect(result.acceptedRate).toBe(5 / MIN_SAMPLE_FOR_RATE);
  });
});

describe("fetchCalendarAddStats", () => {
  it("passes through the total", async () => {
    const { db } = createFakeD1([
      { match: /event_type = 'calendar_add_click'/, first: { total: 7 } },
    ]);

    expect(await fetchCalendarAddStats(db)).toEqual({ total: 7 });
  });

  it("defaults to 0 when there are no rows yet", async () => {
    const { db } = createFakeD1([{ match: /event_type = 'calendar_add_click'/, first: null }]);

    expect(await fetchCalendarAddStats(db)).toEqual({ total: 0 });
  });
});

describe("computeInstallToPushConversion", () => {
  it("computes pushSubscribers ÷ installAccepted", () => {
    expect(computeInstallToPushConversion(10, 6)).toEqual({
      installAccepted: 10,
      pushSubscribers: 6,
      ratio: 0.6,
    });
  });

  it("returns ratio null (not 0) when there are no accepted installs to divide by — an aggregate approximation has nothing to divide, not a 0% conversion", () => {
    expect(computeInstallToPushConversion(0, 3)).toEqual({
      installAccepted: 0,
      pushSubscribers: 3,
      ratio: null,
    });
  });
});

describe("computeTrackingStartDay", () => {
  const now = new Date("2026-07-28T00:00:00.000Z");

  it("returns null when there's no data at all", () => {
    expect(computeTrackingStartDay(null, now)).toBeNull();
  });

  it("returns the ISO day when real tracking started more recently than the 60-day window", () => {
    // 2026-07-15, 13 days before `now` — well inside the 60-day window.
    const earliest = new Date("2026-07-15T16:15:45.589Z").getTime();

    expect(computeTrackingStartDay(earliest, now)).toBe("2026-07-15");
  });

  it("returns null once real history reaches the full 60-day window — matches plays' no-caveat behavior", () => {
    // Exactly TREND_WINDOW_DAYS (60) before `now`: the window is fully real,
    // same state plays.weeklyPlays is already in, which needs no caption.
    const windowStart = new Date(now);
    windowStart.setUTCDate(windowStart.getUTCDate() - TREND_WINDOW_DAYS);

    expect(computeTrackingStartDay(windowStart.getTime(), now)).toBeNull();
  });

  it("returns null when real tracking predates the window by a wide margin (e.g. plays' ~84-day history)", () => {
    const earliest = new Date("2026-05-05T00:00:00.000Z").getTime();

    expect(computeTrackingStartDay(earliest, now)).toBeNull();
  });
});

describe("fetchEventsTrackingStart / fetchPushSubscriptionsTrackingStart", () => {
  it("fetchEventsTrackingStart reads MIN(created_at) from events", async () => {
    const { db } = createFakeD1([
      { match: /MIN\(created_at\).*FROM events/, first: { earliest: 1784132145589 } },
    ]);

    expect(await fetchEventsTrackingStart(db)).toBe(1784132145589);
  });

  it("fetchEventsTrackingStart returns null when events has no rows", async () => {
    const { db } = createFakeD1([{ match: /MIN\(created_at\).*FROM events/, first: null }]);

    expect(await fetchEventsTrackingStart(db)).toBeNull();
  });

  it("fetchPushSubscriptionsTrackingStart reads MIN(created_at) from push_subscriptions", async () => {
    const { db } = createFakeD1([
      { match: /MIN\(created_at\).*FROM push_subscriptions/, first: { earliest: 1784467482633 } },
    ]);

    expect(await fetchPushSubscriptionsTrackingStart(db)).toBe(1784467482633);
  });

  it("fetchPushSubscriptionsTrackingStart returns null when the table has no rows", async () => {
    const { db } = createFakeD1([
      { match: /MIN\(created_at\).*FROM push_subscriptions/, first: null },
    ]);

    expect(await fetchPushSubscriptionsTrackingStart(db)).toBeNull();
  });

  describe("pickStatsForMissingDb", () => {
    it("stays honest (null) when a real Cloudflare env is present but D1 isn't bound", () => {
      expect(pickStatsForMissingDb(true)).toBeNull();
    });

    it("falls back to the sample fixture when there's no Cloudflare env at all", () => {
      expect(pickStatsForMissingDb(false)).toBe(SAMPLE_ADMIN_DASHBOARD_STATS);
    });

    it("treats a missing flag the same as false — defaults to the sample fixture", () => {
      expect(pickStatsForMissingDb(undefined)).toBe(SAMPLE_ADMIN_DASHBOARD_STATS);
    });
  });
});

describe("fetchStoryFunnel", () => {
  // Three queries on `events`, told apart by their leading columns: totals
  // select `event_type, COUNT(*) as n`, the trend groups `day, event_type`,
  // the per-set one selects `set_id, event_type`.
  const totalsRoute = (all: Record<string, unknown>[]): FakeRoute => ({
    match: /SELECT event_type, COUNT\(\*\) as n/,
    all,
  });
  const trendRoute = (all: Record<string, unknown>[] = []): FakeRoute => ({
    match: /GROUP BY day, event_type/,
    all,
  });
  const perSetRoute = (all: Record<string, unknown>[] = []): FakeRoute => ({
    match: /SELECT set_id, event_type/,
    all,
  });

  it("counts each stage and divides each by the stage it follows", async () => {
    const { db } = createFakeD1([
      totalsRoute([
        { event_type: "share_click", n: 40 },
        { event_type: "story_create_tap", n: 10 },
        { event_type: "story_install_gate_shown", n: 4 },
        { event_type: "story_video_created", n: 5 },
        { event_type: "story_video_shared", n: 4 },
      ]),
      trendRoute(),
      perSetRoute(),
    ]);

    const result = await fetchStoryFunnel(db);

    expect(result).toMatchObject({
      shareClicks: 40,
      createTaps: 10,
      installGateShown: 4,
      created: 5,
      shared: 4,
      tapRate: 0.25,
      gateRate: 0.4,
      createdRate: 0.5,
      sharedRate: 0.8,
    });
  });

  // "no data" and "0%" are different facts: a rate over an empty base is null.
  it("returns every rate null when its base is 0", async () => {
    const { db } = createFakeD1([totalsRoute([]), trendRoute(), perSetRoute()]);

    const result = await fetchStoryFunnel(db);

    expect(result).toMatchObject({
      shareClicks: 0,
      createTaps: 0,
      tapRate: null,
      gateRate: null,
      createdRate: null,
      sharedRate: null,
      perSet: [],
    });
  });

  // Story rows from before story_create_tap existed: created with no taps
  // leaves createdRate null rather than dividing by zero.
  it("leaves createdRate null for videos made before taps were recorded", async () => {
    const { db } = createFakeD1([
      totalsRoute([
        { event_type: "story_video_created", n: 3 },
        { event_type: "story_video_shared", n: 1 },
      ]),
      trendRoute(),
      perSetRoute(),
    ]);

    const result = await fetchStoryFunnel(db);

    expect(result.createdRate).toBeNull();
    expect(result.sharedRate).toBeCloseTo(1 / 3);
  });

  it("buckets each event type's trend into the 60-day weekly window", async () => {
    const today = new Date().toISOString().slice(0, 10);
    const { db, queries } = createFakeD1([
      totalsRoute([]),
      trendRoute([
        { day: today, event_type: "story_create_tap", count: 3 },
        { day: today, event_type: "story_video_shared", count: 1 },
      ]),
      perSetRoute(),
    ]);

    const result = await fetchStoryFunnel(db);

    const buckets = Math.ceil(TREND_WINDOW_DAYS / TREND_BUCKET_DAYS);
    expect(result.createTapsTrend).toHaveLength(buckets);
    expect(result.createTapsTrend.at(-1)).toBe(3);
    expect(result.sharedTrend.at(-1)).toBe(1);
    expect(result.createdTrend.every((n) => n === 0)).toBe(true);
    const trendSql = queries.find((q) => /GROUP BY day, event_type/.test(q)) ?? "";
    for (const type of [
      "share_click",
      "story_create_tap",
      "story_install_gate_shown",
      "story_video_created",
      "story_video_shared",
    ]) {
      expect(trendSql).toContain(`'${type}'`);
    }
  });

  it("breaks created/shared down per set, titled from the catalogue, most made first", async () => {
    const { db } = createFakeD1([
      totalsRoute([]),
      trendRoute(),
      perSetRoute([
        { set_id: "set-002-til", event_type: "story_video_created", n: 1 },
        { set_id: "set-003-unreal", event_type: "story_video_created", n: 4 },
        { set_id: "set-003-unreal", event_type: "story_video_shared", n: 2 },
      ]),
    ]);

    const result = await fetchStoryFunnel(db);

    expect(result.perSet).toEqual([
      {
        setId: "set-003-unreal",
        setTitle: "Form:at 003",
        setArtist: "Unreal",
        created: 4,
        shared: 2,
        linkOpens: 0,
      },
      {
        setId: "set-002-til",
        setTitle: "Form:at 002",
        setArtist: "t.i.l.",
        created: 1,
        shared: 0,
        linkOpens: 0,
      },
    ]);
  });
});

describe("fetchStoryFunnel link opens", () => {
  it("counts story_link_open outside the funnel's rates, with its own trend and per-set column", async () => {
    const today = new Date().toISOString().slice(0, 10);
    const { db } = createFakeD1([
      {
        match: /SELECT event_type, COUNT\(\*\) as n/,
        all: [
          { event_type: "story_video_shared", n: 2 },
          { event_type: "story_link_open", n: 5 },
        ],
      },
      {
        match: /GROUP BY day, event_type/,
        all: [{ day: today, event_type: "story_link_open", count: 5 }],
      },
      {
        match: /SELECT set_id, event_type/,
        all: [{ set_id: "set-003-unreal", event_type: "story_link_open", n: 5 }],
      },
    ]);

    const result = await fetchStoryFunnel(db);

    expect(result.linkOpens).toBe(5);
    expect(result.linkOpensTrend.at(-1)).toBe(5);
    expect(result.perSet[0]).toMatchObject({ setId: "set-003-unreal", linkOpens: 5 });
    expect(result.sharedRate).toBeNull(); // created is 0; link opens play no part
  });
});

describe("fetchListeningStats", () => {
  const totalsRoute = (first: Record<string, unknown> | null): FakeRoute => ({
    match: /SELECT COALESCE\(SUM\(listened_seconds\), 0\) AS seconds/,
    first,
  });
  const trendRoute = (all: Record<string, unknown>[] = []): FakeRoute => ({
    match: /GROUP BY day/,
    all,
  });
  const perSetRoute = (all: Record<string, unknown>[] = []): FakeRoute => ({
    match: /GROUP BY set_id/,
    all,
  });

  it("divides minutes by distinct plays, never by segment rows", async () => {
    const { db, queries } = createFakeD1([
      totalsRoute({ seconds: 3 * 60 * 60, plays: 4 }),
      trendRoute(),
      perSetRoute(),
    ]);

    const result = await fetchListeningStats(db);

    expect(result).toMatchObject({ totalMinutes: 180, plays: 4, avgMinutesPerPlay: 45 });
    expect(
      queries.some((q) => q.includes("COUNT(DISTINCT COALESCE(session_id, 'legacy-' || id))")),
    ).toBe(true);
  });

  it("returns avgMinutesPerPlay null with no plays", async () => {
    const { db } = createFakeD1([
      totalsRoute({ seconds: 0, plays: 0 }),
      trendRoute(),
      perSetRoute(),
    ]);

    const result = await fetchListeningStats(db);

    expect(result.avgMinutesPerPlay).toBeNull();
    expect(result.perSet).toEqual([]);
  });

  it("buckets listened seconds into weekly minutes", async () => {
    const today = new Date().toISOString().slice(0, 10);
    const { db } = createFakeD1([
      totalsRoute({ seconds: 0, plays: 0 }),
      trendRoute([{ day: today, count: 1800 }]),
      perSetRoute(),
    ]);

    const result = await fetchListeningStats(db);

    expect(result.weeklyMinutes).toHaveLength(Math.ceil(TREND_WINDOW_DAYS / TREND_BUCKET_DAYS));
    expect(result.weeklyMinutes.at(-1)).toBe(30);
  });

  it("ranks sets by minutes, titled from the catalogue, with their own per-play average", async () => {
    const { db } = createFakeD1([
      totalsRoute({ seconds: 0, plays: 0 }),
      trendRoute(),
      perSetRoute([
        { set_id: "set-002-til", seconds: 600, plays: 2 },
        { set_id: "set-003-unreal", seconds: 5400, plays: 3 },
      ]),
    ]);

    const result = await fetchListeningStats(db);

    expect(result.perSet).toEqual([
      {
        setId: "set-003-unreal",
        setTitle: "Form:at 003",
        setArtist: "Unreal",
        minutes: 90,
        plays: 3,
        avgMinutesPerPlay: 30,
      },
      {
        setId: "set-002-til",
        setTitle: "Form:at 002",
        setArtist: "t.i.l.",
        minutes: 10,
        plays: 2,
        avgMinutesPerPlay: 5,
      },
    ]);
  });
});

describe("fetchMilestones", () => {
  const pushRoute = (all: Record<string, unknown>[] = []): FakeRoute => ({
    match: /FROM admin_push_sends/,
    all,
  });
  const uploadRoute = (all: Record<string, unknown>[] = []): FakeRoute => ({
    match: /FROM sets/,
    all,
  });

  it("adds push sends and uploads to the static milestones, oldest first, one per day and kind", async () => {
    const { db } = createFakeD1([
      pushRoute([
        { day: "2026-09-19", title: "003 is up" },
        { day: "2026-09-25", title: "a" },
        { day: "2026-09-25", title: "b" },
      ]),
      uploadRoute([{ day: "2026-09-12", artist: "Unreal", title: "Form:at 003" }]),
    ]);

    const result = await fetchMilestones(db);

    expect(result.filter((m) => m.date >= "2026-09-01")).toEqual([
      { date: "2026-09-12", kind: "upload", label: "set added: Unreal @ Form:at 003" },
      { date: "2026-09-19", kind: "push", label: "push: 003 is up" },
      { date: "2026-09-25", kind: "push", label: "2 pushes: a, b" },
      { date: "2026-10-02", kind: "launch", label: "instagram story launched on android" },
      { date: "2026-12-05", kind: "event", label: "form:at 004" },
    ]);
    const dates = result.map((m) => m.date);
    expect(dates).toEqual([...dates].sort());
  });

  // Legacy sets were migrated with a placeholder created_at; only uploads
  // carry artwork_original_url.
  it("only counts real uploads as set additions", async () => {
    const { db, queries } = createFakeD1([pushRoute(), uploadRoute()]);

    await fetchMilestones(db);

    expect(queries.find((q) => /FROM sets/.test(q))).toMatch(/artwork_original_url IS NOT NULL/);
  });
});
