// Explicit allowlist of `event_type` values the tracking endpoint accepts.
// Shared between the client hook
// (`useTrackEvent`) and the server validation (`routes/api/event.ts`) so the
// two can never drift — add a new event type here FIRST, then wire up its
// call site.
//
// This allowlist IS the guard against `events` quietly becoming a dumping
// ground for arbitrary strings: `routes/api/event.ts` rejects (still 204,
// no INSERT) anything not listed here. Reject, don't sanitize — an unknown
// event_type usually means a client/server drift bug, not a value worth
// coercing into something else.
export const TRACKABLE_EVENT_TYPES = [
  "install_prompt_shown",
  "install_accepted",
  "install_dismissed",
  "app_launch",
  "save_click",
  "share_click",
  // Push opt-in soft prompt (installed app only) — mirrors the install_*
  // naming. `notify_prompt_shown` is the subscribe prompt becoming visible;
  // `notify_accepted` is accepting OUR soft prompt (fires before the native
  // permission ask — grant rate is inferable by comparing against the
  // push_subscriptions table); `notify_declined` is closing it without
  // accepting. `notify_install_nudge_shown` is LEGACY: the browser-tab
  // nudge it counted is gone (a tab's install ask is
  // install_cta_instructions_shown), and nothing current sends it. It stays
  // accepted for tabs still running an older cached bundle; the admin
  // dashboard reads historic rows from D1 either way, not through this list.
  "notify_prompt_shown",
  "notify_accepted",
  "notify_declined",
  "notify_install_nudge_shown",
  // AddToCalendarButton — one type for all three destinations
  // (google/outlook/.ics), same
  // minimal-cardinality precedent as save_click/share_click not
  // differentiating method. Deliberately carries no set_id/event_id: `events`
  // has no generic entity-id column (set_id is validated against getSet() in
  // routes/api/event.ts, sets-only), and this button only ever appears in the
  // context of one event per page load — adding an id column is a separate,
  // not-yet-needed schema decision.
  "calendar_add_click",
  // A tap on [ video_story ] in the share modal's instagram: section,
  // with the set's id: the top of the Story funnel, before the install gate
  // (a tab) or the picker (the installed app). Not sent for a tap ignored
  // while the gate is still pending.
  "story_create_tap",
  // Instagram Story video, both with the set's id.
  // `story_video_created` is a finished recording, a File in hand.
  // `story_video_shared` means `navigator.share` resolved, i.e. the visitor
  // picked a share target. It does NOT mean the story was published: nothing
  // reports back from Instagram, and the visitor can still back out of its
  // composer. Deliberately separate types rather than a method on
  // share_click, which stays one undifferentiated count.
  "story_video_created",
  "story_video_shared",
  // The install gate shown to a mobile tab user who tapped
  // [ video_story ]: stories need the installed app. Paired with
  // install_accepted over the same window, it says whether stories drive
  // installs; the two rows aren't linkable, so it's a rate, not a per-visitor
  // conversion.
  "story_install_gate_shown",
  // A set page opened from a story's link sticker: the link the picker copies
  // carries `ref=story` (storyLinkUrl). With the set's id, once per arrival —
  // the page drops `ref` from the address bar afterwards. Counts the story's
  // viewers, not its makers, so it sits beside the funnel, not in it.
  "story_link_open",
  // The home page's [ install_the_app ] opened its instructions modal: a browser
  // tab with no native prompt to fire (iOS share-menu steps, the manual hint,
  // open-app, or where to install instead). A tap that fires Chrome's prompt
  // directly isn't this; that funnel is install_prompt_shown →
  // install_accepted / install_dismissed.
  "install_cta_instructions_shown",
  // DJ Story image (DjStorySheet, from the share modal's [ image_story ]
  // row on a DJ page). `dj_story_open` is the sheet opening, sent by the
  // sheet itself, not the row; `dj_story_shared` means
  // navigator.share resolved (a target was picked, not that a story was
  // published, as story_video_shared); `dj_story_downloaded` is the fallback
  // where file sharing isn't available. No id: `events` has no column for a
  // DJ, and set_id is validated as a set (calendar_add_click's precedent).
  "dj_story_open",
  "dj_story_shared",
  "dj_story_downloaded",
  // Taps on the home page, so what stays on it is decided with numbers.
  // `home_tickets_click` is the button to the next night's event page while
  // its tickets are on sale; `home_your_tickets_click` is the same button on
  // a device that holds a ticket, which opens /tickets instead.
  // `home_play_click` is every tap on the play / pause toggle, not a play:
  // plays are counted in `plays`. The other two are the link rows. No id on
  // any of them, as calendar_add_click.
  "home_tickets_click",
  "home_your_tickets_click",
  "home_play_click",
  "home_instagram_click",
  "home_community_click",
] as const;

export type TrackableEventType = (typeof TRACKABLE_EVENT_TYPES)[number];

export function isTrackableEventType(value: string): value is TrackableEventType {
  return (TRACKABLE_EVENT_TYPES as readonly string[]).includes(value);
}
