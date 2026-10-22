# React GUI migration

The Web and Electron renderer are moving from Solid to React so Redcode can
consume the official RedDB Design System components directly. Migrate complete
surfaces while preserving their routes, English source copy, localization,
settings storage, accessibility and platform behavior.

## Current boundary

Appearance, Notifications and About render in React, including the third-party
notices dialog. They use the official DS Input, Select, Switch, Logo, Button and
Dialog components through canonical `@reddb-io/design-system/base/*` imports.
Selects use native browser popups and keyboard navigation. Selecting a sound
continues to preview it through the existing sound controller.

The existing settings controllers still own persistence, async loading and
theme application. Their Solid hosts forward typed snapshots and actions through
`ReactView`; React owns the DOM below each mount and unmounts with its host.
Locale and dictionary updates invalidate the snapshot. This mount boundary is
temporary and should disappear when the surrounding application is React.

Native DS dialogs own their Escape key and focus restoration. The settings host
must not consume Escape from an open native dialog before its controller can
handle it.

## Distribution and builds

`design-system.manifest.json` selects React and the official compiled distribution.
The pinned producer supplies browser ESM, declarations and Tailwind candidates.
This keeps the Solid and React JSX compilers from interpreting each other's
components. Application React source uses the `.react.tsx` suffix and its React
JSX directive; the shared Vite configuration, also used by Desktop, routes those
files to the React plugin and excludes them from the Solid plugin.

`bun scripts/sync-design-system.ts` runs the pinned producer from a temporary
archive without changing the neighboring Design System checkout. Build-only
producer dependencies live in `packages/design-system-tools`; the producer also
supports Svelte delivery, so its development dependencies include the Svelte
compiler. The delivered GUI package contains the React implementation only.

The Sync wrapper retains the legacy `contracts/*`, `logo/*` and platform icon
exports for surfaces still using Solid. It preserves the canonical React exports
and runtime dependencies, and records its package adaptation and file hashes in
the receipt. Remove these compatibility seams after their final consumer moves.
The shared Vite resolver directs portable App recipes to `contracts/base`, a
renderer-free Base seam, so those recipes do not load the React component barrel.

## Remaining surfaces

- Preferences, settings navigation/search and the server/project/extension pages.
- Shared application providers, routing, server subscriptions and desktop startup.
- Application shell and GUI extension SDK/renderers.
- Composer, session timeline, diff/review, document and terminal integrations.
- Remaining generic primitives, followed by removal of the Solid GUI dependencies
  and `ReactView`.

Before migrating session or timeline rendering, capture and compare the existing
production benchmarks as required by `packages/app/AGENTS.md`. The TUI continues
to use OpenTUI/Solid; web DS components do not render terminal UI.

## Verification

The owning browser suites are `packages/app/e2e/regression/settings.spec.ts` and
`settings-search.spec.ts`. They cover settings routes, persistence across reloads,
keyboard operation, native controls, dialog focus restoration, search targets and
narrow/short layouts. Run `bun run check` at the repository root and build both
Web and Desktop renderers when changing the shared Vite configuration.

Verified on October 21, 2026:

- `bun run check`: lint and all 27 package type checks passed.
- Web production build and Electron production build passed.
- Nine production-browser keeper cases passed, covering the migrated pages,
  settings search and desktop/mobile layouts. Eight focused controller/theme
  unit cases passed.
- Four development-browser keeper cases passed after isolating the portable DS
  recipes from the React component barrel, including opening and refreshing the
  settings route.
- The pages were also exercised against the existing authenticated local server,
  including light/dark modes, mobile layout and notices-dialog focus restoration.
- The broad Bun unit command still fails when it imports legacy Solid JSX:
  `Export named 'jsxDEV' not found`. Importing the unchanged
  `packages/ui/src/context/helper.tsx` from the app directory reproduces this
  loader limitation independently of the migrated pages.
