---
paths:
  - "**/*.ts"
  - "**/*.tsx"
---

# React and TypeScript

React 19.2 with the React Compiler (`babel-plugin-react-compiler` in both apps'
`vite.config.ts`), Zustand 5, TypeScript strict with `verbatimModuleSyntax` and
`noUncheckedIndexedAccess` (`packages/tsconfig`), TanStack Start.

## React

- **Don't add `useMemo`, `useCallback` or `memo`** — the compiler memoizes. The
  exception is a stable identity the compiler can't see (a function handed to a
  non-React API or returned from a hook as an effect dependency), with a comment
  naming it. Existing ones stay until each is checked; add no new ones.
- **Follow the Rules of React**: pure render, no mutation of props or state,
  hooks at the top level. The compiler silently skips a component that breaks
  them — it keeps working but loses memoization.
- To see what the compiler skipped, add a logger to the plugin options locally
  and don't commit it (react.dev/reference/react-compiler/logger):
  `logger: { logEvent(f, e) { if (e.kind === "CompileError" || e.kind === "CompileSkip") console.warn(e.kind, f) } }`.
- **Effects only sync with outside systems**: the `<audio>` element, IDB, the
  service worker, canvas, timers, listeners. A value derived from props or state
  is computed during render; work caused by an event goes in its handler.
- **Non-reactive logic inside an effect** (reading the latest callback or prop
  without re-subscribing) uses `useEffectEvent`, not a ref mirrored by another
  effect. It needs React ≥19.2: raise the `react` floor in package.json before
  its first use (`apps/admin` is on `^19.2.0` and uses it; `apps/web` is still
  on `^19.1.0`).
- **`ref` is a plain prop**; don't add `forwardRef`.

## Zustand 5

- **Select one field per `useStore` call**: `useStore((s) => s.isPlaying)`.
- **A selector returning a new object or array needs `useShallow`**
  (`zustand/react/shallow`). In v5 a fresh object per render loops with
  "Maximum update depth exceeded".
- Persist IDs, never `MusicSet` objects (`web-app.md`).

## TypeScript

- **Every boundary value starts as `unknown` and is narrowed**: D1 rows, fetch
  JSON, localStorage, `postMessage` and service-worker messages, IDB records.
- **`import type`** for type-only imports; `verbatimModuleSyntax` fails tsc otherwise.
- **Discriminated unions over boolean flag pairs**:
  `{ status: "loading" } | { status: "ready"; data: T }`, not `isLoading` + `data?`.
- **Exhaustive switches** over a union end in a `never` check, so a new member
  fails tsc:
  `default: { const unhandled: never = value; throw new Error(String(unhandled)); }`.
- **`satisfies`** for config objects, to check the shape and keep literal types.
- **No non-null `!`** without a comment saying why it holds.
- **`noUncheckedIndexedAccess` is on**: handle the `undefined` from `arr[i]` or
  `record[key]`; don't cast it away.
- **No `any`**, except the documented Cloudflare env cast in each app's
  `server.ts`. Generated `routeTree.gen.ts` is exempt.

## TanStack Start

- **Data from client code goes through `createServerFn`**, never a raw `fetch` to
  an internal API route.
- **Anything taking client input chains `.inputValidator()`** (the method's name
  in the installed `@tanstack/start-client-core`) and narrows `unknown` there.
  Annotating the parameter isn't validation. The two existing validators are
  identity casts: TECH_DEBT.md item 34.
- Pure endpoints are `createFileRoute(...)({ server: { handlers } })` (`web-app.md`).
- **Server-only modules** (D1 queries, R2, `webPush`, env access) are never
  imported from components; reach them through a server function.

## Errors

- **A catch handles, rethrows, or returns the null-not-0 "couldn't read it"
  value.** A catch that deliberately ignores the error (storage blocked,
  best-effort beacon) says why in a one-line comment.

## Tests

- **Test behaviour through what the user sees**: Testing Library queries and
  `@testing-library/user-event`, not `fireEvent`, for new tests.
- **No snapshot tests for logic.**
