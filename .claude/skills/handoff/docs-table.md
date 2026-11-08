# Which doc to re-read

The table names each doc's most common trigger — a memory aid for the "does an
existing doc now say something false or incomplete?" test, not a substitute for
it. A change can fail that test without matching any row's wording: a new CSP
directive is a security-relevant change to `apps/admin` even on a day nothing
there says "CSP". When a change doesn't obviously fit a row, apply the test
directly; the table will always lag behind the next kind of change.

| Doc | Re-read it when |
|---|---|
| `README.md` | the stack, the architecture, or any claim about how something works changed. The doc an outside reader trusts first, so a stale line here misleads furthest. |
| `CLAUDE.md` | a hard constraint, the git workflow, a command or the doc map changed — or a new silent-failure rule needs its one-liner. |
| `.claude/rules/*.md` | code a rule describes changed: a file moved or was renamed (check the rule's `paths:` too), a protected string changed, a map row is now wrong. |
| `.claude/skills/*`, `.claude/hooks/*`, `.claude/README.md` | a procedure, a hook pattern or the setup itself changed. |
| `docs/adr/` | a decision was made that shapes the project: a new file from `template.md` and a row in its README. Records are history; a change of mind is a new ADR that supersedes the old one. |
| `PWA_PROGRESS.md` | an existing entry's premise changed and needs a dated follow-up, **including what was tried and rejected**. Dated entries are history; don't edit them to match the present. New decisions go in `docs/adr/`. |
| `TECH_DEBT.md` | a known gap was accepted rather than fixed, or an existing item's premise changed. |
| `IMPROVEMENTS.md` | something shipped, or was deliberately dropped and shouldn't be re-proposed. |
| `apps/web/README.md` | that app's layout, its build/dev commands, or one of its silent-failure rules changed. |
| `apps/admin/README.md` | the dashboard's layout, its security controls, or the `null`-not-`0` rule changed. |
| `apps/web/scripts/README.md` | a script, flag or setup step changed. It claims to cover every script in the folder: read the folder against the doc, not just the doc. |
| `apps/web/tests/README.md` | test layout or conventions changed. |
| `apps/web/images-source/README.md` | the image pipeline changed. |
| `apps/rum-archiver/README.md` | the capture, its schedule, its token scope or its secrets changed. |

A **new workspace** has its own checklist: `/new-workspace`.
