# The `.claude/` folder — a guide

This folder configures Claude Code for this repo. It's written for the person
working with Claude here, not for Claude: Claude Code doesn't load this file on
its own (it reads only the files listed under "What loads when" below).
Everything here applies to Claude Code 2.1.280; the docs are at
code.claude.com/docs.

## What loads when

| Piece | Where | Loads |
|---|---|---|
| Project instructions | `CLAUDE.md` (repo root) | At the start of every session, in full. Kept short on purpose. |
| Your private instructions | `CLAUDE.local.md` (repo root, gitignored) | At the start of every session, after `CLAUDE.md`. |
| Your instructions for every project | `~/.claude/CLAUDE.md` | At the start of every session, in every repo. (You don't have one.) |
| Rules | `.claude/rules/*.md` | A rule with a `paths:` list loads the first time Claude reads or edits a matching file; without `paths:` it would load at start. All of ours have `paths:`. |
| Skills | `.claude/skills/<name>/SKILL.md` | Only the one-line `description` at start. The full text loads when you type `/<name>`, or when Claude decides the task matches the description. |
| Subagents | `.claude/agents/*.md` | Never on their own here. A subagent runs in its own context, on its own model, and reports back. |
| Hooks | `.claude/hooks/*.sh`, wired in `settings.json` | Run by Claude Code itself on every matching tool call. Claude can't skip or argue with them. |
| Settings | `.claude/settings.json` (committed), `.claude/settings.local.json` (yours, gitignored) | Read at start and reloaded when they change: permissions, hooks, attribution. |
| MCP servers | `.mcp.json` (repo root) | Connected at start after you approve them once; only their tool names sit in context until a tool is used. |

## Every file we added

| File | What it does | When it runs | How you trigger it |
|---|---|---|---|
| `CLAUDE.md` | One line per hard constraint, the git workflow, checks, commands, doc map | Every session | Automatic |
| `rules/offline-and-service-worker.md` | Purge flag pair, no skipWaiting, never rebuild the audio Request, SW build | Touching sw.ts, offlineSlice, catalogueSlice, offline-audio, vite.config | Automatic |
| `rules/web-app.md` | Server entry, player, nav, analytics, beacon CSP, store slices, API route shape | Touching apps/web server, routes, store, hooks, player | Automatic |
| `rules/admin-security-and-metrics.md` | Host guard, verifyAccessJwt, CSP, null-not-0, metric naming, RUM, markers | Touching anything in apps/admin | Automatic |
| `rules/data-r2-d1.md` | schema.sql migrations, versioned R2 keys, catalogue, peaks, push, RUM archive, tickets | Touching packages/data, schema.sql, scripts, rum-archiver | Automatic |
| `rules/design-system-and-styling.md` | Tokens, edges, bracket labels, @source, readable JSX, packages/ui traps | Touching packages/ui or any app .tsx/.css | Automatic |
| `rules/react-and-typescript.md` | React Compiler, effects, Zustand, TS, TanStack Start, errors, tests | Touching any .ts/.tsx | Automatic |
| `rules/stories.md` | Story video, DJ Story image, lazy imports, Story product decisions | Touching story/djStory code or ShareModal | Automatic |
| `rules/tests.md` | One vitest major, standalone vitest config, test layout | Touching tests or test configs | Automatic |
| `rules/ci.md` | Playwright cache keys, CI jobs, deploy gating | Touching .github/workflows | Automatic |
| `rules/comments.md` | The comment register | Touching any code file | Automatic |
| `skills/implement-issue/` | Reads the issue and its epic, branches, posts the plan on the issue and waits for your OK (`wait-for-reply.sh`), implements, hands off, ships with `Closes #N`, applies the review | Working from a GitHub issue | `/implement-issue <N>` |
| `skills/handoff/` | Checks, docs test, branch check, stage by name, commit, change summary | End of a task | `/handoff` (or Claude, when work is done) |
| `skills/ship-pr/` | Identity check, push, `gh pr create`, CI report, never merge | After handoff | `/ship-pr` |
| `skills/visual-review/` | Design pass, 375px renders to `~/Downloads/<topic>/`, wait for your ok | Visual work, before ship-pr | `/visual-review` |
| `skills/add-dj/` | djs.ts, photo pipeline, lineup, checks | Adding a DJ | `/add-dj` |
| `skills/add-event/` | events.ts entry, flyer, sample data, status flip | Adding or updating an event | `/add-event` |
| `skills/d1-migration/` | Prints one-at-a-time ALTER + PRAGMA commands for you to run | Schema changes | `/d1-migration` only (Claude can't start it) |
| `skills/new-workspace/` | README, root README, CLAUDE.md table, tooling for a new workspace or script | Adding one | `/new-workspace` |
| `agents/constraint-reviewer.md` | Reads the diff against §1 and the rules, reports `file:line` findings (Sonnet) | When you say yes at handoff | "run the constraint reviewer" |
| `agents/docs-truth-checker.md` | Finds doc sentences the diff made false (Haiku, skips CLAUDE.md) | When you say yes at handoff | "run the docs truth checker" |
| `hooks/guard-bash.sh` | Blocks stash, `add -A`, amend, rebase, force-push, push to main, merge and auto-merge (`gh pr merge`, the API), attribution (including a Claude session link), authorship changes (`--author`, `-c user.*`, `GIT_AUTHOR_*`), deleting server.ts, `d1 --file --remote`; asks before builds, e2e, wrangler writes, `git restore` | Before every Bash command | Automatic |
| `hooks/format-on-edit.sh` | `biome check --write` on the edited file | After every edit | Automatic |
| `hooks/check-invariants.sh` | Greps protected files for the silent-failure invariants, any file for Stripe-shaped keys, and any source file for invisible characters | After every edit | Automatic |
| `hooks/tests/` | 128 cases for the three hooks; CI runs them too (`hooks` job) | When a hook changes | `bash .claude/hooks/tests/run.sh` |
| `settings.json` | Permissions (deny/ask/allow), the hooks, `attribution` set to nothing | Always | Automatic |
| `../.mcp.json` | Cloudflare's documentation MCP server (read-only docs, no account access) | Always, once approved | `/mcp` to see it |
| `../.worktreeinclude` | Gitignored files copied into every new worktree: `CLAUDE.local.md`, `settings.local.json`, the apps' `.env` files, `routeTree.gen.ts` | When a worktree is created | `claude --worktree <name>` |

## A day of work

1. **Explore.** Ask Claude to look around; it reads code and the matching rules load.
2. **Plan.** Shift+Tab until the mode says plan; Claude proposes and edits nothing until you approve.
3. **Code.** Approve the plan; Claude implements on a new `feat/` / `fix/` / `chore/` branch.
   From a GitHub issue, `/implement-issue <N>` does steps 1 to 6 in one go, posting the plan on the issue and waiting for your OK there or here.
4. **`/handoff`.** Checks, docs, commit, change summary (complex parts in English and Spanish).
5. **`/visual-review`** for anything visible: renders land in `~/Downloads/<topic>/`; you approve or ask for changes.
6. **`/ship-pr`.** Push, PR, CI report. You review and squash-merge.

## Working in parallel

One folder holds one checked-out branch, so two sessions in the same folder
step on each other however carefully they name their branches. Each parallel
session gets its own worktree instead:

```bash
claude --worktree tickets        # second terminal: claude --worktree stories
```

What to expect:

- The checkout lands in `.claude/worktrees/tickets/` (gitignored) on a branch
  named `worktree-tickets`, cut from `origin/main`. `/ship-pr` renames it to
  `feat/…`, `fix/…` or `chore/…` before pushing.
- `.worktreeinclude` copies the gitignored files listed there into it. Run
  `pnpm install` once in the worktree; `node_modules` isn't copied.
- The hooks still run from this checkout (`$CLAUDE_PROJECT_DIR` stays put),
  and a "don't ask again" approval is saved to this checkout's
  `settings.local.json`, so it applies to every worktree.
- Each app's e2e suite boots its own dev server on a port hashed from the
  folder path (`apps/*/tests/e2e/_port.ts`), so suites in two worktrees don't
  collide and never touch a `pnpm dev` you started.
- On exit, a clean worktree is removed; one with work in it asks you. To come
  back: `claude --worktree tickets --resume`. From a GitHub issue,
  `/implement-issue <N>` inside the worktree runs the whole loop.

Between features run `/clear`. Inside a long feature run `/compact`. Check what's
using context with `/context`. To get back to a PR's session later:
`claude --from-pr <number>` opens the session picker filtered to sessions linked
to that PR (Claude Code links them when Claude opens the PR).

## "I keep correcting Claude about X. Where does the fix go?"

| If X… | Put it in |
|---|---|
| must never happen, even if Claude forgets | a hook (`hooks/`), plus a test in `hooks/tests/` |
| applies to one area of the code | the rule file for that area, or a new rule with `paths:` |
| is a multi-step procedure you repeat | a skill |
| applies everywhere and fits in one line | `CLAUDE.md` |
| is about you, your machine or your accounts, in this repo | `CLAUDE.local.md` |
| is about you, in every repo | `~/.claude/CLAUDE.md` |

## Adding things

**A rule.** Create `.claude/rules/<topic>.md` and start it with the files it
covers, like `ci.md`:

```markdown
---
paths:
  - ".github/workflows/**"
---

# CI/CD
...
```

**A skill.** Create `.claude/skills/<name>/SKILL.md`. The description is what
Claude reads to decide when to use it. `disable-model-invocation: true` makes it
yours to start only, as in `d1-migration`:

```markdown
---
name: d1-migration
description: Print the one-statement-at-a-time wrangler commands …
disable-model-invocation: true
---
```

**A subagent.** In this version `/agents` only reminds you to ask Claude or
write the file. Ask Claude ("make a read-only subagent that …"), or create
`.claude/agents/<name>.md` like `docs-truth-checker.md`: `name`, `description`,
`tools`, `model`.

**A hook.** Write the script in `.claude/hooks/`, add it under `hooks` in
`settings.json` (copy an existing entry), and add cases to `hooks/tests/`.
`/hooks` shows what's configured; it doesn't edit.

**An MCP server.**
`claude mcp add --scope project --transport http <name> <url>` writes it to
`.mcp.json`; `/mcp` shows status and approval. Keep them read-only toward
Cloudflare.

## When a hook blocks something

The reason appears in the conversation as `PreToolUse:Bash hook error: … guard-bash blocked this command: <reason>`. Claude should change course, not retry. To see
what a hook does with a command, run it by hand:

```bash
echo '{"tool_input":{"command":"git stash list"}}' | bash .claude/hooks/guard-bash.sh; echo "exit $?"
```

Exit 2 = blocked (reason on stderr), exit 0 with JSON = ask, exit 0 and nothing
= allowed. If a hook is wrong, fix the script and add a case to
`hooks/tests/guard-bash.cases`. For an emergency, `"disableAllHooks": true` in
`.claude/settings.local.json` turns all hooks off until you remove it.

## Troubleshooting

- **What instructions loaded?** `/memory` lists the CLAUDE.md files and rules
  in play. `/context` shows what fills the window and how big each piece is.
- **Did my settings load?** `/status` shows the setting sources. `claude doctor`
  lists entries it rejected.
- **Conflicting instructions?** `/doctor prompt-audit`.
- **Is a customization causing it?** `claude --safe-mode` starts with all of
  this off.
- **Test the hooks:** `bash .claude/hooks/tests/run.sh`.
