# React GUI migration

The Web and Electron renderer are moving from Solid to React so Redcode can
consume the official RedDB Design System components directly. Migrate complete
surfaces while preserving their routes, English source copy, localization,
settings storage, accessibility and platform behavior.

## Current boundary

The Settings screen, navigation, search, panels and built-in pages render in
React: Preferences, Appearance, Notifications, Shortcuts, Projects, Worktrees,
Providers, Models and reasoning roles, Usage reporting, Agent tools, Agent
extensions, Server and About, including project-specific settings and dialogs.
Controls use the official DS Input, Textarea, Select, Switch, Checkbox, Badge,
Button, Dialog, DropdownMenu, Disclosure, Tabs, Tooltip and Logo through canonical
`@reddb-io/design-system/base/*` imports. Redcode's product glyphs and project
artwork retain their existing assets and semantic colors.

Settings-owned state and controllers are React hooks or renderer-independent
external stores. Font and settings-schema data and keyboard helpers are shared
without loading a renderer. Navigation/search share one controller with the surrounding
application, preserving the public `useSettingsSurface` interface. Shortcut
capture releases the global command handler when its page unmounts. Project
edits keep the existing serial autosave queue, including reverting a value while
an earlier write is pending. Worktree deletion captures its server context,
checks sessions and working changes again before removing a directory, and
keeps bulk deletion sequential. Reporting keeps its secret write-only and shows
controlled errors.

Global application services still use Solid: the router, localization, theme and
settings persistence, server subscriptions, query cache, provider connection
workflows and GUI extension runtime. The `.tsx` page hosts assemble those
services and project typed snapshots with `sharedSource`; React subscribes with
`useSyncExternalStore`. `SharedSlot` retains application service scopes and
existing contributed UI under its original Solid owner. These adapters do not
implement a second Settings controller or change the extension SDK. They are
temporary until the surrounding application providers migrate.

Shared sources and slots dispose with their originating Solid owner, before
React finishes its deferred teardown. Slot content remains reactive, including
navigation actions replaced when extension availability changes. Cached actions
retain the navigation owner instead of the snapshot observer's transient scope.

Native selects own their popups and keyboard navigation, including the mobile
page picker and provider account selector. Native dialogs own Escape and focus
restoration; Settings must leave an open dialog's Escape event to its controller.
Panel paint containment keeps scrolling inside the page across shared renderer
scopes. Search retains ranking, keyboard navigation, grapheme-safe empty text,
result focus, reveal highlights and scroll restoration.

Shared Solid connection dialogs retain their existing controls. Their select
popups declare the Kobalte top layer so the parent dialog does not hide a popup
portal from assistive technology. The HTTPS keeper reproduced this failure
before the fix, with visible options under an `aria-hidden` ancestor.

## Distribution and builds

`design-system.manifest.json` selects React and the official compiled distribution.
The current pin is `v2026.10.28`. Its `PhoneInput` formatting dependency,
`libphonenumber-js@1.13.15`, is available to both the pinned compiler and the
vendored runtime package.
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
The current release exposes renderer-free `/base/recipes` and `/app/recipes`;
its portable recipes use those canonical exports without loading a component
barrel. The older `contracts/base` seam remains available for compatibility.

## Remaining surfaces

- Shared application providers, routing, server subscriptions and desktop startup.
- Application shell and GUI extension SDK/renderers.
- Composer, session timeline, diff/review, document and terminal integrations.
- Remaining generic primitives, followed by removal of the Solid GUI dependencies
  and `ReactView`.

Before migrating session or timeline rendering, capture and compare the existing
production benchmarks as required by `packages/app/AGENTS.md`. The TUI continues
to use OpenTUI/Solid; web DS components do not render terminal UI.

## Verification

The owning browser suites are `packages/app/e2e/regression/settings.spec.ts`,
`settings-search.spec.ts` and `settings-wsl.spec.ts`. The mobile Settings keeper
in `mobile-session.spec.ts` verifies the native page picker above the panel.
They cover routes, server/project scope, persistence, keyboard operation,
autosave ordering, deletion checks, provider account switching/removal,
reporting secrets, dialog focus, search and narrow/short layouts.

The obsolete vertical-tab-layout browser case was removed: the schema already
retires that preference. `settings/model.test.ts` owns decoding retired values;
`navigation labels preserve rail and panel geometry and survive reload` owns
the current navigation preference in the browser.

Run `bun run check` at the repository root, `bun run typecheck:e2e` in
`packages/app`, and Web and Desktop production builds. Browser keepers must
exercise both an optimized production build and development startup. Build with
`VITE_OPENCODE_TEST_FIXTURES=1` to include the existing WSL fixture entry points
in a production browser run. Live validation uses a task-owned local preview
connected to the elected authenticated server; do not restart that server.

Validated on 2026-10-22:

- Root `bun run check`: no lint warnings/errors and all 27 package type checks passed.
- App `bun run typecheck:e2e`: passed.
- Focused Settings unit tests: 45 passed across seven files, with 131 assertions.
  The moved schema test also rejected a temporary font-size-default mutation.
- Web production build with fixture entry points and Desktop production build: passed.
- Optimized Chromium: all 61 Settings, search, WSL/SSH and mobile-navigation
  keepers passed together without retries after the lifecycle and popup fixes.
- Development: 16 distinct keepers passed across WSL/SSH, mobile navigation,
  search, refresh, preferences/sounds, provider accounts/removal and dialog flows.
  The SSH reconnection keeper waits for the replacement controller's event
  stream before sending new input.
- Live browser validation against the elected authenticated server loaded real
  sessions, providers and models. Light, dark, mobile and shared connection-dialog
  views rendered without runtime errors. Desktop scrolling stayed inside the
  Settings panel; the 390px viewport had no horizontal overflow.

WSL/SSH lifecycle and destructive provider/project/worktree operations were
exercised with the existing fixtures. Live checks used navigation and local
browser preferences, preserving the installed server and its configuration.

The `v2026.10.28` vendor refresh pins producer revision
`1d4293988aca514e59269e856e41539b1903c03c`. All 909 receipt file hashes matched,
the delivery contained no Svelte renderer files, and the new canonical
`PhoneInput`, `SettingsRow`, recipe and interaction exports resolved from the
consumer. Root checks, Web/Desktop builds and the same 61 production keepers
passed without retries. Six focused development keepers passed together; the
mobile navigation keeper passed on isolated recheck after an initial navigation
timeout. Authenticated live desktop/mobile and light/dark checks found no
runtime errors or horizontal overflow. Embedded brand assets stayed identical;
their generated header records the new producer version.
