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

Native connection dialogs and their popups own focus containment and dismissal.
The retained Solid hosts pass existing service scopes to those renderers without
mounting a second modal or focus trap.

The surrounding frame, desktop navigation rail, project/session sidemenu, mobile
dock and command palette now render in React as well. The frame uses the canonical
App recipes, and menus, tooltips, inputs, scrolling and the palette dialog use
native Base components. Redcode artwork, status roles, route selection, background
session opening, pins, filters, section expansion and saved panel width are
preserved. The resize separator supports both pointer dragging and keyboard input.
Extension project-menu contributions are projected as ordered actions into the
native menu, preserving their existing server/directory invocation contract.

Navigation-owned transient state uses the same renderer-independent external
store as Settings. The application service adapter still derives the tree and
status from Solid-owned server, routing and persistence services. Command search
retains its cancellation and independently published asynchronous sources;
React owns active-row selection and reads local query state through the shared
store. The portable palette entries, server-session loader, file-icon lookup,
project artwork, language snapshot and keyboard legends have explicit shared
owners. The server-session loader's existing test rejected removing its archive
filter after the move.

The titlebar frame, back/forward controls, channel indicator and ordered extension
pills now render in React with the canonical DS Button, Tooltip and Logo. Pills
use the canonical Button recipe to retain their custom busy artwork and native
`aria-busy` state. The service adapter preserves route history and state, session/root resolution,
pending-tab adoption and command ownership. Native macOS traffic-light and Windows
caption-control clearance, zoom, RTL physical positioning and mobile safe areas
keep their existing geometry. Product SVG markup stays stable across tooltip
updates so a pointer press on an icon keeps its target until release.

Stable titlebar slots retain the sortable tab strip and recently-closed menu,
mobile drawer and its swipe/force-mount behavior, Windows/Linux nested app menu,
and the extension right-slot portal under their original service owners. The DS
ContextMenu currently owns a button trigger and cannot wrap the real tab anchor,
editable title and close control; its Drawer does not expose the existing swipe
contract. These specialized surfaces remain an explicit next slice.

The shell's other shared slots keep route content, extension
surfaces and notification/upload hosts under their original providers. Palette
session avatars also retain their existing subscriptions in shared slots. These
boundaries preserve extension and server ownership while those renderers and the
global providers migrate.

Agents navigation now renders with native App NavItem and Base SearchSelect.
The workspace's section, machine, project, harness and task selectors use the
same native searchable control through a service adapter. Filtering remains local,
accent-insensitive and independent from the selected value. Metadata updates
retain the search draft and focus. SearchSelect owns its label; compact contexts
retain that label for assistive technology without adding another visible row.

Server pairing and HTTPS setup, saved integration connections, MCP management and
ChatGPT account notices now use native React DS dialogs and controls. Pairing
retains its link and external-address draft when HTTPS opens above it. The existing
service stack still owns replacement, nested layers and disposal; the native DS
owns focus containment, Escape and backdrop behavior. Native layers release their
modal before the stack restores the invoking control. A menu invocation captures
its persistent trigger before the selected row disappears.

Connection services retain account activation, serial credential operations,
two-step deletion, API-check evidence, explicit relay consent and scoped MCP
requests. Provider sign-in now uses native DS Dialog, Field, Input, RadioGroup,
LoadingIndicator and ListRow. Its picker retains connection ordering, search and
keyboard navigation. The existing controller still owns Location capture, OAuth
polling/cancellation, command login, conditional answers and catalog refresh.
React owns field drafts, numeric validation and custom choices. First-connection
model selection uses native radios and hands the selected model to the existing
draft or caller.

Model selection now uses native DS Popover, Dialog, Input, ListRow, Badge,
Tooltip and Button. React owns search, keyboard selection, favorites, router-offer
expansion and the desktop/mobile trigger content. Existing model controllers keep
catalog refresh, persistence, route presentation and variant preferences. Closed
pickers defer projecting their complete catalog until opened. Mobile keeps the
existing swipe, force-mount and final-focus drawer while its body and controls
render in React. The desktop list has its own bounded scroller so the real
provider catalog cannot push its search or actions outside the viewport.

Model visibility management also renders in React with native Dialog, Switch,
DropdownMenu, ScrollArea and search controls. Filtering temporarily expands
groups while retaining their collapse preference. Provider-wide changes include
models hidden by the filter. Existing services retain visibility preferences and
the provider-connection handoff; Console workspace grouping remains unchanged.

Home now renders its project picker, server actions, session search/list, context
menus, inline renaming and deletion confirmation in React with native DS controls.
The session viewport and search results use native ScrollArea; the retired custom
thumb/wheel plumbing is removed. Group-header opacity subscribes independently
so scrolling does not rerender the entire session list. Existing avatar/status
subscriptions retain their custom artwork in service-owned slots.

Project rows keep stable worktree keys through metadata refreshes. The same
renderer-independent drag engine retains mouse distance, touch delay/tolerance,
vertical bounds, auto-scroll and drop behavior. Native menus project ordered
extension actions with the original server/directory contract. Existing services
still own project order, selection, server authentication and session mutations.
The Home shortcut retains its pending focus request until the native search input
mounts; a direct Home-button click does not request search focus.

The directory and file picker also uses a native dialog, path input, suggestions
and actions. Its existing search, navigation generations, preload queue and
file-selection policy remain service-owned. React owns the imperative FileTree
mount and its wheel/touch listeners. The virtual tree remains the existing
renderer-independent widget, including lazy directory loading and its shadow
root; the DS does not expose that virtualization contract.

The initial sign-in screen and add/edit server forms also render in React with
native DS inputs, actions and Logo. Their existing health checks, pairing-token
redemption, address fallback, saved names and server registry remain service-owned.
The QR reader owns its video and camera engine in React, loads only when scanning
starts, and destroys that engine when the reader unmounts.

Settings' shared server controls now use native React DS add/manage menus and
connection indicators. Ordered extension add actions retain their callback
contracts. Management retains HTTP editing/removal and builtin-server
hide/show restrictions. The extension SDK's contributed server bodies and
`ServerRowItems` remain under their existing owners.

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
- Sortable tab strip, previews/context menus, recently-closed menu, mobile tabs drawer,
  Windows/Linux app menu, notification/upload hosts and GUI extension SDK/renderers.
- Agents workspace bodies beyond their migrated scope selectors.
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

Shell/navigation verification on 2026-10-22:

- Root checks passed all 27 package type checks with no lint warnings/errors;
  the app's browser-test types also passed. Web and Desktop production builds passed.
- Navigation model and palette search/session-loading unit tests: 22 passed,
  with 78 assertions. The moved archive-filter contract rejected its mutation.
  File-icon lookup rules remained byte-for-byte identical after extraction.
- Chromium production: 88 cases passed together without retries across navigation,
  command palette, all mobile-session keepers, Settings/search/WSL/SSH and shell
  spacing in LTR and RTL. The native menu's Settings destination also keeps its
  current-page indication on the mobile dock.
- The final dock current-page refinement passed the same eight focused cases in
  an optimized production build.
- Eight focused development keepers passed without retries, including extension
  import, asynchronous palette selection, mobile focus and current-page indication,
  persisted navigation state and Settings history/geometry.
- Browser recording stalled during teardown even after the isolated tests had
  completed every interaction/assertion. A temporary runner override disabled
  video; the same isolated cases passed in 10.5 seconds. This override is not a
  production flag or a committed runner change.
- Three Home-suite failures were reproduced on the pre-migration production
  build: the context-menu expectation omits Pin, Ctrl+B is expected to open Home
  rather than toggle the sidebar, and the signed-out pairing case fails while
  waiting for its Authenticate button. They are not counted as passing coverage.
- Authenticated browser checks loaded real sessions and the native palette,
  drawer and light/dark surfaces while preserving the elected server. The 390px
  viewport had no horizontal overflow. Chrome Unstable reported two startup
  `UnknownError: Internal error` rejections; their cause remains unverified, so
  this is not a claim of an error-free live run.

Production benchmarks recorded 24 passing runs before the migration and 24 after
it (eight scenarios, three repetitions, one worker, Chromium, video/trace off).
The after-run overlapped unrelated DS builds/checks: load exceeded 16 on eight
CPUs, with CPU pressure above 50%. A separate immutable build of the prior
revision succeeded, but its comparison run and a later attempt on the new build
hit browser crashes/timeouts. These interrupted runs are not passing evidence.

Observed median stable render times in milliseconds:

| Scenario                         | Initial baseline | After, under contention |
| -------------------------------- | ---------------: | ----------------------: |
| entry: new session from home     |              267 |                   505.4 |
| entry: new session from session  |            198.1 |                   331.2 |
| entry: cold session from Home    |            735.6 |                  1735.8 |
| tab switch: cold, review closed  |            284.1 |                   820.3 |
| tab switch: cold, review open    |            307.2 |                   771.1 |
| tab switch: warm, review closed  |            150.7 |                   253.1 |
| tab switch: warm, review open    |            115.5 |                   342.6 |
| tab switch: warm, review resized |            123.8 |                   436.8 |

The recorded after-times are slower. The changing load and browser failures
prevent attributing that difference to the framework change or ruling out a
regression. Controlled latency verification remains pending; the passing
benchmark assertions establish rendering correctness, not performance parity.

Titlebar verification on 2026-10-22:

- Root checks passed all 27 package type checks with no lint warnings/errors;
  browser-test types passed as well.
- History, tab-title and visible-order unit tests: 12 passed with 29 assertions.
  A separate direct Bun attempt to load Solid TSX tests failed on `jsxDEV`
  resolution and is excluded from those pass counts.
- Web production build with fixture entry points and Desktop production build passed.
- Optimized Chromium: all 44 cases passed together without retries across tabs,
  command palette, mobile sessions/touch, multiserver behavior, history and LTR/RTL
  shell spacing. The temporary runner override disabled video only.
- Ten distinct development keepers passed without retries across history buttons,
  tab command ownership, rename, visible order, responsive tab selection, Windows
  menu actions, LTR/RTL spacing and mobile touch density.
- Authenticated optimized-browser checks opened an existing live session in light
  desktop and dark mobile views. The mobile drawer opened, its titlebar stayed
  36px high, and neither viewport had horizontal overflow or uncaught script errors.
  The installed app/server remained running throughout.

The Settings history keeper now exercises the visible back/forward buttons and
both disabled boundaries as well as keyboard history. It reproduced the SVG
click failure: a tooltip update replaced the pressed path before release.
Memoizing its markup keeps the same target through the click. The mobile density
keeper also caught the More trigger's 42px content box inside its bordered dock
entry; the actual control now retains a 44px minimum.

The retired vertical-sidebar tests were replaced by the current drawer-to-strip
selection contract. `settings/model.test.ts` retains retired-setting decoding,
and `navigation labels preserve rail and panel geometry and survive reload`
retains current navigation geometry. The multiserver keeper uses the native
switch's accessible name and current Settings destinations. File-tab retention
opens files through the current command palette and still checks their selected
identity and content after switching between sessions and folders.

Early browser attempts encountered temporary-file quota errors and failed module
loads. Final correctness runs used task-owned temporary directories in `/var/tmp`
after the authorized cleanup; failed or interrupted attempts are excluded from
passing coverage. Benchmark browser profiles use `/tmp` to match the baseline.

The titlebar comparison starts at `90b9c9571a`: eight scenarios, three
repetitions each, one Chromium worker, production builds, trace/video off. All
24 runs passed before and all 24 after. Raw logs and complete metric JSON were
retained during verification. Median first-correct / stable observations (ms):

| Scenario                         |        Before |           After |
| -------------------------------- | ------------: | --------------: |
| entry: new session from home     | 238.9 / 302.5 |   535.8 / 641.5 |
| entry: new session from session  |  92.6 / 120.2 |   292.3 / 395.3 |
| entry: cold session from Home    | 658.5 / 733.3 | 1376.5 / 1460.3 |
| tab switch: cold, review closed  | 273.7 / 288.2 |   557.5 / 664.0 |
| tab switch: cold, review open    | 300.1 / 312.0 |   811.9 / 905.1 |
| tab switch: warm, review closed  |  87.8 / 151.4 |   120.7 / 173.9 |
| tab switch: warm, review open    |  98.5 / 150.1 |   146.0 / 221.0 |
| tab switch: warm, review resized | 115.5 / 127.3 |   372.9 / 582.2 |

Every recorded destination was correct. Warm switches had zero blank samples
and zero transcript requests; cold tab switches made one transcript request in
each repetition, matching the baseline. Initial blank samples remain present in
both versions for cold entry/switch scenarios.

The after medians are slower. Host load changed from the quiet initial baseline
to roughly 5.3 at the start and 5.0 after the second run, with CPU pressure
averaging about 8-10% over the final minutes. This comparison cannot establish
latency parity or attribute the difference to the migration. The earlier
navigation migration's controlled latency verification also remains pending.

An additional immutable archive of `90b9c9571a` was built and compared in a
nearby window with the final build: two scenarios, three repetitions each,
all six runs passing per version. Median first-correct / stable observations (ms):

| Scenario                         | Prior build, repeated | Final build, repeated |
| -------------------------------- | --------------------: | --------------------: |
| entry: new session from home     |         806.6 / 958.7 |       1589.1 / 1604.7 |
| tab switch: warm, review resized |         250.9 / 357.1 |         568.3 / 619.5 |

The prior build itself shifted from 302.5 to 958.7ms for new-session stability
and from 127.3 to 357.1ms for resized-tab stability. Host load rose above 14
during the final repeated run. The current build remained slower in this
comparison, so performance parity remains unverified and a regression has not
been ruled out. These passing benchmarks establish completion and metric
collection; the timing data requires an isolated comparison.

Connection and Agents scope verification on 2026-10-22:

- Root checks: all 27 package type checks passed, with no lint warnings/errors.
  Browser-test typing also passed. Web production with fixture entry points and
  Desktop production builds passed.
- Optimized Chromium: 105 cases passed together without retries across Agents,
  Settings/search/WSL/SSH, mobile navigation, MCPs, navigation and multiple servers.
  The camera keeper uses full Chromium with a synthetic capture device: it opens
  a real MediaStream and verifies that every track ends after cancelling the reader.
- Focused development keepers passed for section and host/project search, task
  drafts through metadata refresh, HTTPS consent/failure/recovery, saved-connection
  renaming/API-check recovery, scoped MCP requests, password recovery, server
  pairing, nested modals and camera cleanup.
- The provider connection-order units passed five cases and eight assertions.
  A direct Bun attempt to load pairing, sharing and remote-auth helper suites
  failed before execution with the existing Solid `jsxDEV` import error; those
  suites are excluded from the passing counts. Their changed rendered paths are
  exercised by the browser keepers.
- Live production preview connected to the elected authenticated server without
  changing it. Real session inventory, Agents scope search, server pairing and
  nested HTTPS views rendered in desktop light and mobile dark modes, with no
  horizontal overflow or uncaught script errors. Pairing and relay configuration
  were only inspected; the live server's settings and grants were preserved.

The browser keepers now wait for the harness output's End navigation to finish
before checking scroll retention, and for the Worktrees menu to open before
sending Escape. Both previously captured an earlier UI state under host load;
the Worktrees keeper passed three adjacent repetitions before the complete run.

The live preview forwards the existing service through a task-owned loopback
proxy. It requests uncompressed API responses so Bun's decompression cannot leave
a stale `Content-Encoding` header for the browser. This verification proxy is not
part of the shipped application.

This slice does not establish session-rendering latency parity. The earlier
performance comparison remains unresolved, and the required production baseline
must precede changes to session or timeline rendering.

Provider authentication and directory-picker verification on 2026-10-22:

- Seven focused development browser cases passed together: conditional answers,
  hidden defaults, custom-answer retention, integer/key validation and recovery,
  first-model handoff, command cancellation, OAuth code retry, Console device-code
  fallback/cancellation on mobile, directory loading with older browser APIs,
  project addition, server re-pairing and password replacement.
- The Home server keepers now open the current Projects dropdown before acting
  on a remote server. Their previous locators waited for a hidden retired panel.
- An optimized browser run passed 61 cases across Settings, search and desktop
  model pickers. Four mobile-model cases still reject the legacy row's 12px
  vertical inset, expecting 16px; this pre-existing model-selector boundary is
  the next migration surface. The run is not counted as a fully passing suite.
- The authenticated production preview displayed the actual provider inventory
  and OpenAI-compatible form. No credentials were submitted or sign-in started.
  Visual inspection caught a duplicated title and native dialog auto-height
  stretching; the native header now retains one visible title and fit-content
  sizing for forms.
- Before changing session/composer rendering, the current production reference
  completed all 24 entry/tab-switch benchmark runs (eight scenarios, three
  repetitions, one worker). Raw metrics and the reference build were retained.
  This establishes the next comparison baseline, not performance parity.

The final provider/directory slice passed root `bun run check` (27 package
checks, zero lint warnings/errors), browser-test typing, Web and Desktop
production builds, and all 14 focused optimized Chromium cases together without
retries. The focused run includes the real synthetic-camera lifecycle check.
The four outstanding mobile-model inset cases remain recorded above.

Model-selection performance verification on 2026-10-22:

The immutable prior build and the initial native picker each completed 24 serial
production benchmark runs (eight scenarios, three repetitions). Median first
correct/stable observations, in milliseconds, were:

| Scenario                   |   Prior build | Initial native picker |
| -------------------------- | ------------: | --------------------: |
| New session from Home      | 230.9 / 297.7 |         348.1 / 444.0 |
| New session from a session |  92.8 / 142.1 |         408.1 / 415.8 |
| Cold session from Home     | 634.8 / 705.6 |         948.0 / 952.9 |
| Cold tab, review closed    | 270.9 / 310.3 |         336.6 / 378.4 |
| Cold tab, review open      | 294.4 / 306.9 |         459.5 / 486.1 |
| Warm tab, review closed    |  82.7 / 159.5 |         104.7 / 167.1 |
| Warm tab, review open      |  93.3 / 149.0 |         131.3 / 193.6 |
| Warm tab, review resized   | 111.4 / 150.9 |         163.7 / 225.3 |

These observations were slower. The picker now defers its complete catalog
projection while closed and renders its trigger content directly in React.
All 24 scenarios completed after that change, but unrelated Rust/Vitest work
raised host load above 19 and CPU pressure above 50% during the run. That run
cannot establish whether the change recovered latency. Performance parity,
including the earlier shell/titlebar concern, remains unresolved.

All three runs observed zero wrong destinations and zero replaced review file
hosts. They did observe transient blank samples (78, 83 and 163 respectively)
and temporarily absent review file hosts during switching (39, 43 and 50).
Passing completion assertions must not be described as blank-free transitions.
Raw samples and the immutable reference build were retained outside the checkout.

The final model-selection slice passed root checks (27 package type checks,
zero lint warnings/errors), browser-test typing and Web/Desktop production builds.
All 42 optimized Chromium cases across model pickers, composer and new-session
keepers passed together without retries. Four focused development cases passed
together after the trigger/projection refinement: desktop favorites/search/refresh,
free-model handoff, mobile paid-model/variant selection and desktop model/variant
menus. The formerly failing four mobile inset cases are included in the passing
production suite.

The authenticated preview loaded the real RedRouter catalog in the final native
picker. Its desktop surface measured 340 by 502 pixels; the local list was 320
pixels high against 1277 pixels of content, with search/actions visible and no
horizontal overflow or browser script errors. No model was changed, provider
refreshed, prompt sent or credentials submitted. Earlier light/dark and mobile
checks retained the same catalog and mobile swipe boundary.

The long-catalog keeper now checks the last rendered row instead of assuming
alphabetical names determine release ordering. Existing composer/new-session
expectations follow the current slash order, neutral prompt text, semantic Brand
actions and dark panel ground; the retired expectations were independently
reproduced on the immutable prior build before replacement.


Home and model-visibility verification on 2026-10-22:

- Root checks passed all 27 packages with zero lint warnings/errors; browser-test
  typing and Web/Desktop production builds passed.
- All 46 optimized Chromium cases across Home, navigation, mobile sessions,
  shell spacing and model pickers passed together without retries. Focused
  development keepers also exercised closed-worktree recovery with an open tab
  preview, identical project paths on different servers, directory loading in
  older browsers and the model-visibility/provider handoff.
- The server-password fixture now changes its accepted password before the form
  starts pre-validating the replacement. Three adjacent production repetitions
  passed. This corrects fixture timing rather than weakening the authentication
  assertion.
- The authenticated preview displayed 64 actual sessions, with a 793px native
  scroll viewport against 2153px of content. Desktop and mobile inspection found
  no horizontal overflow or browser script errors. Scrolling retained the search
  and project headers. The native visibility manager displayed the actual
  RedRouter catalog without changing visibility, credentials or the selected model.
- Live inspection found that search styling depended on having opened Settings
  first. The reusable search input now imports its own stylesheet so the manager
  has the same layout when opened directly from a session.

The immutable provider reference, repeated model reference and final Home build
also completed 24 production benchmark cases each (eight scenarios, three serial
repetitions). Median first-correct/stable observations in milliseconds were:

| Scenario | Provider reference | Model reference | Home |
| --- | ---: | ---: | ---: |
| New session from Home | 880.9 / 1053.0 | 594.3 / 699.8 | 543.4 / 657.9 |
| New session from a session | 437.6 / 452.7 | 400.8 / 466.1 | 523.8 / 582.6 |
| Cold session from Home | 1976.2 / 1996.4 | 1263.2 / 1326.9 | 992.4 / 1000.8 |
| Cold tab, review closed | 775.1 / 902.4 | 341.2 / 355.6 | 337.9 / 436.4 |
| Cold tab, review open | 379.1 / 397.8 | 770.0 / 828.9 | 481.9 / 509.6 |
| Warm tab, review closed | 112.5 / 178.0 | 136.2 / 250.9 | 104.7 / 154.9 |
| Warm tab, review open | 162.0 / 242.3 | 288.8 / 317.3 | 124.6 / 227.2 |
| Warm tab, review resized | 151.6 / 208.3 | 305.5 / 386.3 | 294.7 / 430.0 |

Results remain mixed and host contention varied between batches; these data do
not establish performance parity or attribute a speedup/regression to Home.
An earlier, heavily contended model-reference batch is excluded from the table.
The three listed batches respectively recorded 109/92/108 blank timeline samples
and 41/44/47 temporarily missing review file-host samples. All recorded zero
wrong destinations and zero replaced review file hosts. Completion assertions do
not prove blank-free transitions. Raw measurements and immutable builds remain
outside the checkout; the earlier shell/titlebar latency concern remains open.

The final Home, model-manager and server-control build passed all 100 optimized
Chromium cases together without retries, spanning Home, navigation, mobile
sessions, shell spacing, model pickers, Settings and WSL/SSH connections. This
includes direct opening of the manager with its search stylesheet loaded. Root
checks passed all 27 packages with zero lint warnings/errors; browser-test typing
and Web/Desktop builds passed. Seven focused development cases covered server
menus, edit-dialog focus restoration, removal policies, builtin hide/show and
extension add actions. The authenticated production preview's native connection
menu displayed the expected Edit action without horizontal overflow or script
errors; no live server settings were changed.
