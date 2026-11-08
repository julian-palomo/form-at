#!/usr/bin/env bash
# Runs the hook test tables: guard-bash.cases against guard-bash.sh, plus
# fixtures for check-invariants.sh and format-on-edit.sh. Prints one line per
# failure and a summary; exits 1 if anything failed.
# Usage: bash .claude/hooks/tests/run.sh

set -u

here=$(cd "$(dirname "$0")" && pwd)
hooks=$(cd "$here/.." && pwd)
repo=$(cd "$hooks/../.." && pwd)
scratch=$(mktemp -d "${TMPDIR:-/tmp}/hook-tests.XXXXXX")
trap 'rm -rf "$scratch"' EXIT

pass=0
failures=0
report() {
  if [ "$1" = "$2" ]; then
    pass=$((pass + 1))
  else
    failures=$((failures + 1))
    printf 'FAIL  expected %-5s got %-5s  %s\n' "$1" "$2" "$3"
  fi
}

# ── guard-bash ────────────────────────────────────────────────────────────
make_repo() { # name branch dirty?
  local dir="$scratch/$1"
  git init -q -b "$2" "$dir"
  git -C "$dir" -c user.name=t -c user.email=t@t commit -q --allow-empty -m init
  printf 'a\n' >"$dir/tracked.txt"
  git -C "$dir" add tracked.txt
  git -C "$dir" -c user.name=t -c user.email=t@t commit -q -m tracked
  [ "$3" = dirty ] && printf 'b\n' >>"$dir/tracked.txt"
  return 0
}
make_repo feature-dirty feat/x dirty
make_repo main-clean main clean

verdict_of() { # repo-dir command
  local out code
  out=$(jq -n --arg c "$2" '{tool_name: "Bash", tool_input: {command: $c}}' |
    CLAUDE_PROJECT_DIR="$1" bash "$hooks/guard-bash.sh" 2>/dev/null)
  code=$?
  if [ "$code" -eq 2 ]; then
    echo block
  elif printf '%s' "$out" | grep -q '"permissionDecision": *"ask"'; then
    echo ask
  elif [ "$code" -eq 0 ] && [ -z "$out" ]; then
    echo pass
  else
    echo "error($code)"
  fi
}

current="$scratch/feature-dirty"
while IFS= read -r line; do
  case "$line" in '' | \#*) continue ;; esac
  case "$line" in
    @repo\ *)
      current="$scratch/${line#@repo }"
      continue
      ;;
  esac
  expected=$(printf '%s' "${line%%|*}" | tr -d '[:space:]')
  command=$(printf '%s' "${line#*|}" | sed -E 's/^ //')
  report "$expected" "$(verdict_of "$current" "$command")" "guard-bash: $command"
done <"$here/guard-bash.cases"

# Attribution read from a -F / --body-file file.
printf 'fix x\n\nCo-Authored-By: Claude <noreply@anthropic.com>\n' >"$scratch/msg-bad.txt"
printf 'fix x\n' >"$scratch/msg-ok.txt"
report block "$(verdict_of "$scratch/feature-dirty" "git commit -F $scratch/msg-bad.txt")" "guard-bash: commit -F file with attribution"
report pass "$(verdict_of "$scratch/feature-dirty" "git commit -F $scratch/msg-ok.txt")" "guard-bash: commit -F clean file"
report block "$(verdict_of "$scratch/feature-dirty" "gh pr create --body-file $scratch/msg-bad.txt")" "guard-bash: pr --body-file with attribution"

# ── check-invariants ──────────────────────────────────────────────────────
# Each fixture is a copy of the real file under the same relative path, so
# the hook's path match applies; the mutated copy must fail, the copy as it
# is must pass.
invariant_verdict() { # file
  jq -n --arg f "$1" '{tool_name: "Edit", tool_input: {file_path: $f}}' |
    bash "$hooks/check-invariants.sh" >/dev/null 2>&1
  [ $? -eq 2 ] && echo block || echo pass
}
fixture() { # relative-path
  mkdir -p "$scratch/inv/$(dirname "$1")"
  cp "$repo/$1" "$scratch/inv/$1"
  echo "$scratch/inv/$1"
}
mutate() { # file sed-expression
  # Through a temp file: BSD and GNU sed disagree on `-i`'s argument.
  sed -e "$2" "$1" >"$1.tmp" && mv "$1.tmp" "$1"
}
check_invariant() { # relative-path sed-expression label
  local f
  f=$(fixture "$1")
  report pass "$(invariant_verdict "$f")" "check-invariants: $1 as committed"
  mutate "$f" "$2"
  report block "$(invariant_verdict "$f")" "check-invariants: $3"
}

check_invariant apps/web/app/sw.ts 's/^clientsClaim();$/clientsClaim();\
self.skipWaiting();/' "sw.ts gains skipWaiting()"
check_invariant apps/web/app/styles/global.css '/^@source /d' "global.css loses @source"
check_invariant apps/admin/app/server.ts "s/\"media-src 'self' blob:\",/\"media-src 'self'\",/" "admin CSP loses media-src blob:"
check_invariant apps/admin/app/server.ts 's#https://\*\.r2\.cloudflarestorage\.com##' "admin CSP loses the R2 host"
check_invariant apps/web/app/components/story/StoryFlowHost.tsx '1i\
import StoryVideoFlowStatic from "~/components/story/StoryVideoFlow";
' "StoryFlowHost gains a static import"
check_invariant apps/web/app/components/djStory/DjStoryHost.tsx 's#import("~/components/djStory/DjStorySheet")#Promise.resolve(DjStorySheetStatic)#' "DjStoryHost loses its lazy import"
check_invariant apps/admin/app/components/TrendChart.tsx 's#import("./TrendChartInner")#Promise.resolve(x)#' "TrendChart loses its lazy import"
for route in sets sets-presign sets/restore send-push; do
  check_invariant "apps/admin/app/routes/api/$route.ts" 's/verifyAccessJwt(/skipAuth(/g' "api/$route drops verifyAccessJwt()"
done

nbsp_file="$scratch/inv/apps/web/app/utils/nbsp.ts"
mkdir -p "$(dirname "$nbsp_file")"
printf 'export const a = "x\xc2\xa0y";\n' >"$nbsp_file"
report block "$(invariant_verdict "$nbsp_file")" "check-invariants: literal non-breaking space"
printf 'export const a = "x\\u00a0y";\n' >"$nbsp_file"
report pass "$(invariant_verdict "$nbsp_file")" "check-invariants: escaped non-breaking space"

# Stripe-shaped keys, built at runtime so no sample key sits in this file.
key_file="$scratch/inv/apps/web/app/utils/stripe.ts"
printf 'const key = "sk_%s_%s";\n' live "$(printf 'A%.0s' $(seq 1 24))" >"$key_file"
report block "$(invariant_verdict "$key_file")" "check-invariants: Stripe secret key"
printf 'const secret = "whsec_%s";\n' "$(printf 'B%.0s' $(seq 1 32))" >"$key_file"
report block "$(invariant_verdict "$key_file")" "check-invariants: Stripe webhook secret"
printf 'const key = env.STRIPE_SECRET_KEY; // sk_live_ or sk_test_\n' >"$key_file"
report pass "$(invariant_verdict "$key_file")" "check-invariants: a key prefix without a key body"

# ── format-on-edit ────────────────────────────────────────────────────────
format_verdict() { # file
  jq -n --arg f "$1" '{tool_name: "Write", tool_input: {file_path: $f}}' |
    CLAUDE_PROJECT_DIR="$repo" bash "$hooks/format-on-edit.sh" >/dev/null 2>&1
  [ $? -eq 2 ] && echo block || echo pass
}
fmt_dir="$repo/.claude/hooks/tests/.tmp"
mkdir -p "$fmt_dir"
printf 'export const a   =  1\n' >"$fmt_dir/fixable.ts"
report pass "$(format_verdict "$fmt_dir/fixable.ts")" "format-on-edit: fixable file is fixed silently"
grep -q 'export const a = 1;' "$fmt_dir/fixable.ts" && report x x "" || report formatted unformatted "format-on-edit: file was rewritten"
printf 'export function f(a: any) { return a == 1 }\n' >"$fmt_dir/unfixable.ts"
report block "$(format_verdict "$fmt_dir/unfixable.ts")" "format-on-edit: lint error it can't fix"
printf '# not code\n' >"$fmt_dir/notes.md"
report pass "$(format_verdict "$fmt_dir/notes.md")" "format-on-edit: markdown is skipped"
rm -rf "$fmt_dir"

printf '%d passed, %d failed\n' "$pass" "$failures"
[ "$failures" -eq 0 ]
