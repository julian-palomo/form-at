#!/usr/bin/env bash
# PreToolUse hook for the Bash tool. Blocks (exit 2, reason on stderr) the git
# and Cloudflare commands CLAUDE.md §1-§2 forbid, and returns an "ask" decision
# for slow or Cloudflare-writing ones. Everything else exits 0 with no output,
# which leaves the normal permission flow in charge.
#
# The command is split on && || ; | and newlines and each segment is checked
# on its own, so `cd x && git add .` is caught. Attribution is checked on the
# whole command plus any -F / --body-file file it names.
#
# This is a guard against mistakes, not a security boundary: a command built
# to dodge these patterns will. Test it with .claude/hooks/tests/run.sh.
# macOS: BSD sed/grep, no `timeout`; jq is /usr/bin/jq.

set -u

input=$(cat)
cmd=$(printf '%s' "$input" | jq -r '.tool_input.command // empty')
[ -z "$cmd" ] && exit 0

repo_dir="${CLAUDE_PROJECT_DIR:-$(pwd)}"

block() {
  printf 'guard-bash blocked this command: %s\n' "$1" >&2
  exit 2
}

ask_reason=""
want_ask() { [ -z "$ask_reason" ] && ask_reason="$1"; }

current_branch() { git -C "$repo_dir" rev-parse --abbrev-ref HEAD 2>/dev/null; }
tracked_changes() { git -C "$repo_dir" status --porcelain --untracked-files=no 2>/dev/null; }

# Attribution lines are never allowed in a commit or PR: authorship is the
# repo owner's own git config. "generated with" must start a word, so
# "regenerated with" passes. Cloud sessions also try to append a
# `claude.ai/code/session` link; that is attribution too.
attribution_re='co-authored-by|(^|[^a-zA-Z])generated with|noreply@anthropic\.com|claude\.com/claude-code|claude\.ai/code/session|🤖'
if printf '%s' "$cmd" | grep -qE '(^|[;&| ])(git( +-C +[^ ]+)* +commit|gh +pr +(create|edit))'; then
  if printf '%s' "$cmd" | grep -qiE "$attribution_re"; then
    block "the commit/PR text contains an attribution line (Co-Authored-By, \"Generated with\", Anthropic/Claude Code). Commits are authored as the repo owner with no attribution."
  fi
  # Message or body read from a file.
  for f in $(printf '%s' "$cmd" | sed -nE 's/.*(-F|--file|--body-file)[ =]+([^ ;&|]+).*/\2/p'); do
    [ "$f" = "-" ] && continue
    case "$f" in /*) path="$f" ;; *) path="$repo_dir/$f" ;; esac
    if [ -f "$path" ] && grep -qiE "$attribution_re" "$path"; then
      block "$f contains an attribution line. Remove it before committing or opening the PR."
    fi
  done
fi

segments=$(printf '%s\n' "$cmd" | sed -E 's/(&&|\|\||;|\|)/\
/g')

while IFS= read -r raw; do
  seg=$(printf '%s' "$raw" | sed -E 's/^[[:space:]]+//; s/[[:space:]]+$//')
  [ -z "$seg" ] && continue

  # git -c user.* overrides authorship for one command.
  if printf '%s' "$seg" | grep -qE '^git( +-C +[^ ]+)* +-c +user\.'; then
    block "git -c user.* changes commit authorship. Commits use the repo owner's git config as it is."
  fi
  # So do the environment variables git reads before its config.
  if printf '%s' "$seg" | grep -qE '(^|[[:space:]])GIT_(AUTHOR|COMMITTER)_(NAME|EMAIL)='; then
    block "GIT_AUTHOR_* / GIT_COMMITTER_* change commit authorship. Commits use the repo owner's git config as it is."
  fi
  # Normalise `git -C <dir> <sub>` to `git <sub>`.
  g=$(printf '%s' "$seg" | sed -E 's/^git( +-C +[^ ]+)+ /git /')

  case "$g" in
    git\ stash|git\ stash\ *)
      block "git stash (any form) mutates the working tree. Use a git worktree for parallel work." ;;
  esac

  if printf '%s' "$g" | grep -qE '^git +add( +[^ ]+)* +(-A|--all|\.|:/)( |$)'; then
    block "git add -A / --all / . sweeps up unrelated work. Stage files by name."
  fi
  if printf '%s' "$g" | grep -qE '^git +commit( |$).*--amend'; then
    block "git commit --amend rewrites history. Make a new commit."
  fi
  if printf '%s' "$g" | grep -qE '^git +commit( |$).*--author'; then
    block "git commit --author changes authorship. Commits use the repo owner's git config."
  fi
  if printf '%s' "$g" | grep -qE '^git +config( |$).*user\.' &&
    ! printf '%s' "$g" | grep -qE '^git +config +(--get +)?user\.(name|email)$'; then
    block "git config user.* changes authorship. Read it with \`git config user.email\`; never set it."
  fi
  if printf '%s' "$g" | grep -qE '^git +push( |$)'; then
    if printf '%s' "$g" | grep -qE '(--force|--force-with-lease| -f( |$)| \+[^ ]+)'; then
      block "force-push rewrites remote history."
    fi
    if printf '%s' "$g" | grep -qE '( |:)main( |$)'; then
      block "pushing to main deploys. Push the feature branch and open a PR."
    fi
    if [ "$(current_branch)" = "main" ]; then
      block "the current branch is main; a push from it deploys. Create a feat/, fix/ or chore/ branch."
    fi
  fi
  if printf '%s' "$g" | grep -qE '^git +reset( |$).*--hard'; then
    block "git reset --hard discards work."
  fi
  if printf '%s' "$g" | grep -qE '^git +rebase( |$)'; then
    block "git rebase rewrites history. Merge origin/main into the branch instead."
  fi
  if printf '%s' "$g" | grep -qE '^git +clean( |$).*-[a-zA-Z]*f'; then
    block "git clean -f deletes untracked files, which may be someone's work in progress."
  fi
  if printf '%s' "$g" | grep -qE '^git +restore( |$)' &&
    ! printf '%s' "$g" | grep -qE '^git +restore +--staged( +[^-][^ ]*)+$'; then
    want_ask "git restore discards working-tree changes."
  fi
  if printf '%s' "$g" | grep -qE '^git +(checkout|switch)( |$)'; then
    if printf '%s' "$g" | grep -qE '^git +checkout( +[^ ]+)* +(--|\.)( |$)'; then
      want_ask "git checkout -- <path> discards working-tree changes."
    elif printf '%s' "$g" | grep -qE '^git +(checkout +-[bB]|switch +-[cC]|switch +--create)( |$)'; then
      : # Creating a branch keeps the working tree as it is.
    elif [ -n "$(tracked_changes)" ]; then
      block "switching branches with uncommitted tracked changes. Commit them, or use a git worktree for the other branch."
    fi
  fi
  if printf '%s' "$g" | grep -qE '^(git +)?rm( |$).*(^|[ /])app/server\.ts'; then
    block "apps/web/app/server.ts and apps/admin/app/server.ts make D1 reachable; never delete them."
  fi
  if printf '%s' "$seg" | grep -qE '^gh +pr +merge( |$)'; then
    block "PRs are merged by the repo owner, never by an agent (and never with auto-merge)."
  fi
  if printf '%s' "$seg" | grep -qE '^gh +api( |$).*/pulls/[0-9]+/merge|^gh +api( |$).*enablePullRequestAutoMerge'; then
    block "merging or enabling auto-merge through the API is still merging. The repo owner merges."
  fi

  if printf '%s' "$seg" | grep -qE 'wrangler( |$)'; then
    if printf '%s' "$seg" | grep -qE 'd1 +execute' &&
      printf '%s' "$seg" | grep -qE -- '--file' &&
      printf '%s' "$seg" | grep -qE -- '--remote'; then
      block "schema.sql's ALTER TABLEs aren't idempotent; never --file against the remote database. Use /d1-migration."
    fi
    if printf '%s' "$seg" | grep -qE '( |^)(deploy|publish)( |$)|r2 +object +(put|delete)|d1 +execute.*--remote|secret +(put|delete|bulk)|pages +deploy'; then
      want_ask "this wrangler command writes to Cloudflare; those writes are the repo owner's."
    fi
  fi
  if printf '%s' "$seg" | grep -qE '^pnpm( |$)'; then
    if printf '%s' "$seg" | grep -qE '( )(build(:[a-z]+)?|test:e2e(:[a-z]+)?)( |$)'; then
      want_ask "builds and e2e runs take minutes; CLAUDE.local.md asks first."
    elif printf '%s' "$seg" | grep -qE '( )deploy( |$)'; then
      want_ask "this pnpm script deploys to Cloudflare."
    fi
  fi
done <<EOF
$segments
EOF

if [ -n "$ask_reason" ]; then
  jq -n --arg r "$ask_reason" \
    '{hookSpecificOutput: {hookEventName: "PreToolUse", permissionDecision: "ask", permissionDecisionReason: $r}}'
fi
exit 0
