import { Label, TerminalRow } from "@form-at/ui";
import { type AdminDashboardStats, MIN_SAMPLE_FOR_RATE } from "~/data/admin-stats";
import { DashboardCard } from "./DashboardCard";
import { MilestoneLegend } from "./MilestoneLegend";
import { TrendChart } from "./TrendChart";

interface GrowthTabProps {
  stats: AdminDashboardStats;
}

// install_funnel + push_subscribers — both are "is the app spreading," and
// install_to_push (below) explains the relationship between the two, so
// grouping them lets that caption sit next to both numbers it's about
// instead of living awkwardly inside install_funnel alone. notify_funnel is
// a THIRD, separate card here rather than merged into either: it's the push
// PERMISSION funnel, not the PWA install funnel, despite the structural
// resemblance — conflating them would blur two different features.
// story_funnel is the Instagram Story's own, from share modal to share sheet.
export function GrowthTab({ stats }: GrowthTabProps) {
  const installConversionLabel =
    stats.installFunnel.conversionRate == null
      ? "—"
      : `${Math.round(stats.installFunnel.conversionRate * 100)}%`;
  const installToPushLabel =
    stats.installToPushConversion.ratio == null
      ? "—"
      : `${Math.round(stats.installToPushConversion.ratio * 100)}%`;
  const notifyAcceptedRateLabel =
    stats.notifyFunnel.acceptedRate == null
      ? "—"
      : `${Math.round(stats.notifyFunnel.acceptedRate * 100)}%`;
  const story = stats.storyFunnel;
  // "count · rate", the rate dropped (not 0%) while its base is 0.
  const withRate = (count: number, rate: number | null) =>
    rate == null ? String(count) : `${count} · ${Math.round(rate * 100)}%`;
  const storyTrends = [
    ["share_click_trend", story.shareClicksTrend],
    ["create_tap_trend", story.createTapsTrend],
    ["install_gate_trend", story.installGateShownTrend],
    ["created_trend", story.createdTrend],
    ["shared_trend", story.sharedTrend],
    ["link_opens_trend", story.linkOpensTrend],
  ] as const;

  return (
    // Two columns above mobile, matching SetsTab. Three columns made each card
    // too narrow for its TerminalRow label/value pairs. An odd card count
    // leaves a gap on the last row — accepted, in exchange for readable rows.
    <>
      <MilestoneLegend />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
        <DashboardCard>
          <Label className="mb-2 text-grey tracking-widest">{"// install_funnel"}</Label>
          <div className="space-y-1">
            <TerminalRow label="shown" value={String(stats.installFunnel.shown)} dimValue />
            <TerminalRow
              label="instructions_shown"
              value={String(stats.installFunnel.instructionsShown)}
              dimValue
            />
            <TerminalRow label="accepted" value={String(stats.installFunnel.accepted)} dimValue />
            <TerminalRow label="dismissed" value={String(stats.installFunnel.dismissed)} dimValue />
            <TerminalRow label="conversion" value={installConversionLabel} dimValue />
            <TerminalRow label="install_to_push" value={installToPushLabel} dimValue />
          </div>
          <p className="mt-1 text-xs text-grey/70">
            shown is an install button with the browser's own prompt behind it; instructions_shown
            is the home page's install_the_app opening its how-to instead (iOS, no prompt, or
            another browser). accepted counts installs from either, so conversion (accepted ÷ shown)
            reads high. install_to_push is an aggregate approximation, not a tracked per-user funnel
            — install events are anonymous and push_subscriptions shares no key with them.
          </p>
          <div className="mt-3 space-y-3">
            <div>
              <Label className="mb-1 block text-xs text-grey">shown_trend</Label>
              <TrendChart data={stats.installFunnel.shownTrend} />
            </div>
            <div>
              <Label className="mb-1 block text-xs text-grey">instructions_shown_trend</Label>
              <TrendChart data={stats.installFunnel.instructionsShownTrend} />
            </div>
            <div>
              <Label className="mb-1 block text-xs text-grey">accepted_trend</Label>
              <TrendChart data={stats.installFunnel.acceptedTrend} />
            </div>
            <div>
              <Label className="mb-1 block text-xs text-grey">dismissed_trend</Label>
              <TrendChart data={stats.installFunnel.dismissedTrend} />
            </div>
          </div>
          {stats.eventsTrackingStartDay && (
            <p className="mt-3 text-xs text-grey/70">
              trends above cover tracking since {stats.eventsTrackingStartDay} — the 60-day window
              shown is mostly not-yet-tracked, not "nothing happened".
            </p>
          )}
        </DashboardCard>

        <DashboardCard>
          <Label className="mb-2 text-grey tracking-widest">{"// push_subscribers"}</Label>
          <div className="space-y-1">
            <TerminalRow label="total" value={String(stats.pushSubscribers.total)} dimValue />
            <TerminalRow
              label="standalone / tab"
              value={`${stats.pushSubscribers.standaloneCount} / ${stats.pushSubscribers.tabCount}`}
              dimValue
            />
          </div>
          <p className="mt-1 text-xs text-grey/70">
            tab will always read 0 by current product policy — notify_me only renders in the
            installed app (see PushOptInCta.tsx); a browser tab gets install_the_app instead.
          </p>
          <div className="mt-3">
            <Label className="mb-1 block text-xs text-grey">growth_60d</Label>
            <TrendChart data={stats.pushSubscribers.weeklyGrowth} />
          </div>
          {stats.pushTrackingStartDay && (
            <p className="mt-3 text-xs text-grey/70">
              tracking since {stats.pushTrackingStartDay} — the 60-day window shown is mostly
              not-yet-tracked, not "nothing happened".
            </p>
          )}
        </DashboardCard>

        <DashboardCard>
          <Label className="mb-2 text-grey tracking-widest">{"// notify_funnel"}</Label>
          <div className="space-y-1">
            <TerminalRow
              label="prompt_shown"
              value={String(stats.notifyFunnel.promptShown)}
              dimValue
            />
            <TerminalRow label="accepted" value={String(stats.notifyFunnel.accepted)} dimValue />
            <TerminalRow label="declined" value={String(stats.notifyFunnel.declined)} dimValue />
            <TerminalRow label="accepted_rate" value={notifyAcceptedRateLabel} dimValue />
          </div>
          <p className="mt-1 text-xs text-grey/70">
            prompt_shown is the installed app's subscribe soft-prompt. declined is closing it
            without accepting; historic declined rows also include closes of the legacy tab nudge
            below, with nothing in the data to tell them apart.
          </p>
          <div className="mt-3 space-y-1">
            <TerminalRow
              label="legacy_install_nudge_shown"
              value={String(stats.notifyFunnel.installNudgeShown)}
              dimValue
            />
          </div>
          <p className="mt-1 text-xs text-grey/70">
            legacy, frozen: the browser-tab install nudge notify_me used to open. notify_me is
            installed-app only now and a tab's install ask is counted as install_funnel's
            instructions_shown, so this only shows historic rows — not part of the funnel above.
          </p>
          {stats.notifyFunnel.acceptedRate == null && (
            <p className="mt-1 text-xs text-grey/70">
              accepted_rate hidden — fewer than {MIN_SAMPLE_FOR_RATE} prompt_shown so far. A
              computed percentage at this sample size reads far more confident than it is.
            </p>
          )}
        </DashboardCard>

        <DashboardCard>
          <Label className="mb-2 text-grey tracking-widest">{"// story_funnel"}</Label>
          <div className="space-y-1">
            <TerminalRow label="share_click" value={String(story.shareClicks)} dimValue />
            <TerminalRow
              label="create_tap"
              value={withRate(story.createTaps, story.tapRate)}
              dimValue
            />
            <TerminalRow
              label="install_gate (tabs)"
              value={withRate(story.installGateShown, story.gateRate)}
              dimValue
            />
            <TerminalRow
              label="created"
              value={withRate(story.created, story.createdRate)}
              dimValue
            />
            <TerminalRow label="shared" value={withRate(story.shared, story.sharedRate)} dimValue />
          </div>
          <div className="mt-2 space-y-1">
            <TerminalRow label="link_opens" value={String(story.linkOpens)} dimValue />
          </div>
          <p className="mt-1 text-xs text-grey/70">
            each % is of the row above it, except created, which is of create_tap: install_gate is a
            tab's tap sent to install the app, and videos are made in the app. share_click counts
            every share modal, desktop and iPhone included, where the entry isn't shown. "shared"
            means the system share sheet completed, not that it was posted to Instagram.
            story_create_tap only exists from the Android launch on; earlier rows are the operator's
            own tests. link_opens is a set page opened from a story's link sticker (?ref=story) —
            the story's viewers, not the people above, so it has no rate.
          </p>
          <div className="mt-3 space-y-3">
            {storyTrends.map(([label, data]) => (
              <div key={label}>
                <Label className="mb-1 block text-xs text-grey">{label}</Label>
                <TrendChart data={data} />
              </div>
            ))}
          </div>
          {story.perSet.length > 0 && (
            <div className="mt-3 space-y-1">
              <Label className="mb-1 block text-xs text-grey">
                per_set (created / shared / link_opens)
              </Label>
              {story.perSet.map((s) => (
                <TerminalRow
                  key={s.setId}
                  label={`${s.setArtist} @ ${s.setTitle}`}
                  value={`${s.created} / ${s.shared} / ${s.linkOpens}`}
                  dimValue
                />
              ))}
            </div>
          )}
        </DashboardCard>
      </div>
    </>
  );
}
