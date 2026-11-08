#!/usr/bin/env bash
# PostToolUse hook for the edit tools: after an edit to one of the protected
# files, cheap greps check that a silent-failure invariant from CLAUDE.md §1
# still holds. Exit 2 shows the reason to Claude; it can't undo the edit.
#
# These catch an agent's edits only. TECH_DEBT.md items 36 and 37 propose
# unit tests that would catch everyone's, in CI; drop a case here once its
# test exists. The admin host guard has no case: tests/unit/server.test.ts
# already fails if it goes.

set -u

file=$(jq -r '.tool_input.file_path // empty')
[ -z "$file" ] && exit 0
[ -f "$file" ] || exit 0

problems=""
fail() { problems="${problems}- $1
"; }

# Lines that aren't comments, so a "never add skipWaiting()" comment
# doesn't trip its own check.
code_lines() { grep -vE '^[[:space:]]*(//|\*|/\*)' "$file"; }

has() { grep -qF -- "$1" "$file"; }

# A value (not type-only) import of $1 at the top level.
static_import_of() {
  grep -E "^import .*from [\"'][^\"']*/$1[\"']" "$file" |
    grep -vqE '^import +type |^import +\{ *type [A-Za-z_]+ *\} '
}

case "$file" in
  */apps/web/app/sw.ts)
    if code_lines | grep -q 'skipWaiting('; then
      fail "sw.ts calls skipWaiting(): an immediately-activating worker prunes chunks open tabs still need (offline-and-service-worker.md)."
    fi
    ;;
  */apps/web/app/styles/global.css)
    has '@source "../../../../packages/ui/src";' ||
      fail "global.css lost its @source line: Tailwind will strip every packages/ui class (design-system-and-styling.md)."
    ;;
  */apps/admin/app/server.ts)
    has "media-src 'self' blob:" ||
      fail "admin CSP lost media-src 'self' blob:: every upload's duration read fails (admin-security-and-metrics.md)."
    has "https://*.r2.cloudflarestorage.com" ||
      fail "admin CSP lost the R2 connect-src host: every upload PUT is blocked (admin-security-and-metrics.md)."
    ;;
  */apps/web/app/components/story/StoryFlowHost.tsx)
    for m in StoryVideoFlow StoryInstallGate; do
      has "import(\"~/components/story/$m\")" ||
        fail "StoryFlowHost.tsx no longer lazy-imports $m (stories.md)."
      if static_import_of "$m"; then
        fail "StoryFlowHost.tsx imports $m statically: it lands in the main bundle (stories.md)."
      fi
    done
    ;;
  */apps/web/app/components/djStory/DjStoryHost.tsx)
    has 'import("~/components/djStory/DjStorySheet")' ||
      fail "DjStoryHost.tsx no longer lazy-imports DjStorySheet (stories.md)."
    if static_import_of DjStorySheet; then
      fail "DjStoryHost.tsx imports DjStorySheet statically (stories.md)."
    fi
    ;;
  */apps/admin/app/components/TrendChart.tsx)
    has 'import("./TrendChartInner")' ||
      fail "TrendChart.tsx no longer lazy-imports TrendChartInner: visx lands in _worker.js (admin-security-and-metrics.md)."
    if static_import_of TrendChartInner; then
      fail "TrendChart.tsx imports TrendChartInner statically (admin-security-and-metrics.md)."
    fi
    ;;
  */apps/admin/app/routes/api/sets.ts | */apps/admin/app/routes/api/sets-presign.ts | \
    */apps/admin/app/routes/api/sets/restore.ts | */apps/admin/app/routes/api/send-push.ts)
    code_lines | grep -q 'verifyAccessJwt(' ||
      fail "$(basename "$file") no longer calls verifyAccessJwt(): Access doesn't gate endpoint calls (admin-security-and-metrics.md)."
    ;;
esac

# Nothing shaped like a Stripe key in any file: secret or restricted keys
# (sk_/rk_ + live/test), webhook signing secrets (whsec_). Keys live only in
# Pages secrets, set by the repo owner. The message gives line numbers, never
# the match, so a real key doesn't land in the transcript. Never write a
# sample key in this file: it is checked too.
stripe_key_re='(sk|rk)_(live|test)_[A-Za-z0-9]{16,}|whsec_[A-Za-z0-9]{16,}'
if LC_ALL=C grep -nIE -- "$stripe_key_re" "$file" >/dev/null; then
  lines=$(LC_ALL=C grep -nIE -- "$stripe_key_re" "$file" | cut -d: -f1 | tr '\n' ' ')
  fail "line(s) ${lines}look like a Stripe key or webhook secret. Keys live only in Pages secrets, never in a file. Remove it, and if it was real, ask the repo owner to roll it."
fi

# No literal non-breaking or zero-width characters in source (write the escape).
case "$file" in
  *.ts | *.tsx | *.js | *.mjs | *.css | *.sql)
    if LC_ALL=C grep -nE $'\xc2\xa0|\xe2\x80[\x8b-\x8d]|\xe2\x81\xa0|\xef\xbb\xbf' "$file" >/dev/null; then
      lines=$(LC_ALL=C grep -nE $'\xc2\xa0|\xe2\x80[\x8b-\x8d]|\xe2\x81\xa0|\xef\xbb\xbf' "$file" | cut -d: -f1 | tr '\n' ' ')
      fail "literal non-breaking or zero-width character on line(s) $lines- write the escape (\\u00a0)."
    fi
    ;;
esac

if [ -n "$problems" ]; then
  printf 'check-invariants: %s\n%s' "$file" "$problems" >&2
  exit 2
fi
exit 0
