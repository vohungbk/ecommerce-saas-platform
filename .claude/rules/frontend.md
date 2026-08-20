# Frontend Rules (apps/web)

## Component Conventions

- Function components only. No class components.
- Server Components by default. Add `'use client'` only when the component
  needs interactivity, browser APIs, or a client-only hook (e.g. TanStack
  Query, `useState`, `useEffect`).
- Type all props with an explicit `interface`/`type` — never `any`, never
  untyped destructuring. Name the type `<ComponentName>Props`.
- Extract non-trivial logic (data fetching, derived state, effects) into a
  custom hook (`use-*.ts`) instead of inlining it in the component body. A
  component should mostly describe markup; a hook should own behavior.
- Keep components small and single-purpose. If a component needs a comment
  to explain what a section does, split that section into a named
  sub-component or hook instead.
- One component per file, filename kebab-case, component name PascalCase
  (matches project naming conventions in `CLAUDE.md`).

## Styling

- Tailwind CSS v4 utility classes only. No inline `style={{ ... }}` props
  and no ad hoc CSS files per component.
- No inline styles for anything expressible in Tailwind, including dynamic
  values — use Tailwind's arbitrary value syntax (`w-[42px]`) or a class
  toggle instead of `style`.
- Shared visual primitives (buttons, inputs, cards) come from shadcn/ui once
  introduced — don't hand-roll a duplicate primitive that shadcn/ui already
  provides.
- Don't invent a design-token/theming abstraction speculatively — extend
  `tailwind.config` only when a second real consumer needs the same value.

## State Management

- **TanStack Query** owns all server state: anything that originates from
  `apps/api` (fetched data, mutations, cache invalidation). Never duplicate
  server data into local component state — read it from the query cache.
- **`useState` / `useReducer` / React Context** own local and UI state
  (form input before submit, modal open/closed, active tab, etc.). This
  project has no global client-state library (e.g. Zustand) — don't add one
  speculatively; introduce it only when a real cross-tree UI-state need
  appears that Context can't reasonably solve, and raise it with the user
  first since it's a new dependency.
- Never call `apps/api` (or any DB) directly from a Client Component's
  `fetch` outside of TanStack Query — mutations and queries go through query
  hooks so caching/invalidation stays consistent.
