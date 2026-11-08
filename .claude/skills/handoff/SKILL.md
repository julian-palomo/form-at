---
name: handoff
description: Close out a finished unit of work in form-at — run the checks, apply the "leave the docs true" test, stage by name, commit, and write the change summary. Use when an implementation is done, before /ship-pr.
---

# Handoff

Run these in order. Don't skip a step silently; if you skip one, the summary says so.

## 1. Checks

```bash
pnpm check
pnpm test
```

Add `pnpm knip` when `git diff origin/main --stat` touches exports, a
`package.json` or `pnpm-lock.yaml`. If `.claude/hooks/` changed, also run
`bash .claude/hooks/tests/run.sh`.

`pnpm build` and `pnpm test:e2e` take minutes: only when the change touches
routes, the player, the service worker or CI, and ask first. Locally a full
`pnpm build` fails at the snapshot step with Cloudflare error 7403; build an app
with `pnpm -C apps/web exec vite build` instead, or rely on CI's build, and say
which.

A failure stops the handoff: report it with its output.

## 2. Leave the docs true

For every doc the change could have made false or incomplete, read what it says
now and fix it. The test is "does an existing doc now say something untrue or
incomplete?" — not "did I add a feature?". Triggers per doc:
[docs-table.md](docs-table.md). A change that fails no row and makes nothing
untrue needs no doc edit; say so.

## 3. What to stage

```bash
pnpm dump-diff                              # tracked changes vs origin/main, split by area
git ls-files --others --exclude-standard    # untracked files dump-diff doesn't show
```

List the files that belong to the task. Anything else — stray untracked files,
edits from another task — is listed separately under "not staged" and left
untouched. Never `git add -A`, `--all` or `.`.

## 4. Commit

```bash
git branch --show-current
```

If that isn't the branch this task's work belongs to, stop and say so: another
session may be using this folder (CLAUDE.md §2, "one session, one folder").

Once the checks pass:

```bash
git add <path> <path> …
git commit -m "<short lowercase imperative subject>"
```

No `Co-Authored-By`, no "Generated with", no attribution of any kind. Several
commits are fine when the work splits into reviewable steps.

## 5. Offer the reviewers

Offer, don't start, the two read-only subagents. They read `.diff-dump/`, so run
`pnpm dump-diff` first if the tree changed:

- `constraint-reviewer` — checks the diff against CLAUDE.md §1 and `.claude/rules/`.
- `docs-truth-checker` — finds doc sentences the diff made false.

## 6. Summary

End with the change summary from [summary-template.md](summary-template.md):
file-by-file changes, checks run and not run, what wasn't verified, the complex
parts in English then Spanish, and what's needed from the repo owner. Then
`/ship-pr`, unless this is visual work still waiting for approved renders
(`/visual-review`).
