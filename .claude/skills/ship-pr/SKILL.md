---
name: ship-pr
description: Push the current form-at feature branch and open its pull request, authored as the repo owner with no attribution, then report CI. Use after /handoff once checks pass (and, for visual work, after the renders were approved). Never merges.
---

# Ship a PR

## 1. Pre-flight — stop if any fails

```bash
git config --get user.name     # expect: Julián Palomo
git config --get user.email    # expect: hello@julianpalomo.dev, no quotes
git rev-parse --abbrev-ref HEAD
git status --porcelain --untracked-files=all
```

- Identity doesn't match → stop and say so. Never pass `--author`, `-c user.*`
  or change `git config`.
- Branch is `main` → stop. Work goes on `feat/…`, `fix/…` or `chore/…` from an
  up-to-date `origin/main`.
- Visual work (anything a user sees) → the renders must have been approved in
  this conversation (`/visual-review`). If not, stop and ask.
- Uncommitted task files → stage them by name and commit (see `/handoff`);
  unrelated files stay as they are and are mentioned in the report.
- No issue number for `Closes #N` → ask for it. Work that started from an
  issue closes it from the PR body; work without one says so in the body.

## 2. Push

```bash
git push -u origin <branch>
```

Never force-push, never push `main`.

## 3. Open the PR

Write the body to a file in the scratchpad, from [pr-body-template.md](pr-body-template.md),
then:

```bash
gh pr create --base main --head <branch> --title "<lowercase imperative, like the commit>" --body-file <file> --assignee @me
```

`@me` is the authenticated `gh` user, so the PR lands in the repo owner's
"Assigned" list on GitHub.

No attribution line anywhere in the title or body. `.claude/settings.json` sets
`attribution` to empty and `guard-bash.sh` blocks one if it slips in.

## 4. Report CI

```bash
gh pr checks <number> --watch
```

`--watch` replaces any `timeout`-based wait (macOS has no `timeout`). Report
`e2e-story-video (macOS)` first, then the rest. A failure: fetch the log
(`gh run view <run-id> --log-failed`), say what failed, and fix it on the same
branch with a new commit.

## 5. Hand over

Give the PR link and the change summary. **Never merge** (`gh pr merge` is
blocked): the repo owner reviews and squash-merges. If later told it's merged,
confirm with `gh pr view <number> --json state,mergedAt` before building on it.

There is no built-in `/commit-push-pr` in Claude Code 2.1.280, so nothing else
answers to this name.
