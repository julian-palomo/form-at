# PR body template

Same shape as the repo's recent PRs (e.g. #91). English only. No attribution.

```markdown
Closes #N. Part of #M.

## Before

- What a user (or a developer) saw or had before this change.

## After

- What they see or have now. Bold the lead word of each point.

## How

- `path/file.tsx`: what changed in it.
- …

## Complex parts

- **<name>** (`file.ts:123`): what it does and why it has to be that way.

## Tests

- New or changed tests, what each asserts.
- `pnpm check`, `pnpm test` pass. (Plus anything else run.)

## Not verified

- Device / iOS / production, and what was checked instead (e.g. screenshots at
  375px in headless Chromium).
```
