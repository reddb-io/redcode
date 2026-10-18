# Design system integration

Redcode vendors `reddb-io/design-system` at the immutable release selected in
`design-system.manifest.json`. Desktop and web share the Solid UI adapters in
`packages/ui` and the application shell in `packages/app`. The embedded designer
receives the same Application theme, light and dark schemes, all four densities,
fonts and favicon through its generated `brand.gen.ts`. A review inherits its
host's density when one is set; otherwise it uses tiny on narrow viewports and
compact on wider ones. Editable text and toolbar controls retain the DS touch
floor on devices with a coarse pointer.

The distribution uses source files. Redcode imports framework-neutral appearance
contracts, tokens and assets; Svelte components are retained as reference source
and are not added to the Solid runtime. Interaction behavior from an upstream
Svelte component must be adapted and validated in its Solid counterpart.

## Synchronizing

Check out the manifest's exact tag in a clean design-system checkout, then run
from the Redcode root:

```sh
bun scripts/sync-design-system.ts /path/to/design-system
```

The wrapper runs that release's own producer, copies its platform icons and
regenerates the embedded designer's theme. The delivery receipt records the
upstream commit and file hashes. Its consumer section preserves the upstream
package-manifest hash before adapting exports for Solid; the delivered hashes
include that adaptation and the platform icons.

Run `bun run check` and the affected application regression tests after updating.
Do not edit vendored components or generated theme files by hand.

## Adapter contracts

- Primary actions explicitly request the primary button variant. The upstream
  default is secondary; the shared Solid button already defaults to neutral.
- Card bodies own spacing between ordinary blocks. Bodies with an explicit flex
  or grid gap disable the default block spacing with `space-y-0`, so the two
  layout mechanisms do not accumulate.
- Selection lists use collision handling and the available viewport height from
  Kobalte. Long options wrap and remain scrollable on short screens.
- Switch tracks and thumbs use Density tokens independently of their interactive
  target, including the minimum touch target on mobile.
- The desktop rail uses the shared badge and indicator contracts. Counts above
  99 display as `99+`; the accessible description retains the exact count.
  Its labels are visible by default and can be disabled in Settings → Preferences
  → Navigation labels. The grid follows the rail's intrinsic width in either mode.
- Mobile uses `BottomNavigation` with Home, Browse, Agents, Search and More.
  Browse opens the current contextual sidemenu; More retains new-session,
  settings, server and help actions. The dock participates in shell layout, so
  the composer and settings keep their space above it. Safe-area padding belongs
  to the dock or, when selected, the bottom titlebar, and is not added twice.
  Dismissing the contextual sidebar returns focus to Browse. Programmatic dialogs
  restore their connected opener unless an explicit focus callback takes over.
  The mobile Agents header also exposes its current section through the shared
  searchable selector. Changing sections keeps the selected host in the URL;
  dismissing a search preserves both. New session remains a labelled touch
  action, and the workspace uses density-aware insets instead of fixed padding.
- The Design session panel uses the App kit's `SidebarPanel` toolbar, action and
  body contracts in both desktop and web. Its existing approval, refresh and
  external-browser actions retain their behavior.
- `SearchSelect` adapts the DS appearance and accent-insensitive filter to
  Kobalte's Solid combobox. Agents uses it for host scopes, connected machines,
  remote project paths, coding agents, native sessions and task worker placement. Search is local;
  only explicit selection changes the host, checkout or selected run. Active search text and focus survive metadata refreshes. Names,
  descriptions and supplied aliases participate in filtering.
- Remote worker setup and dispatch use density-aware forms with persistent action
  footers, essential connection fields first and optional settings in a disclosure.
  Draft task cards show their saved routing, tags and resource requirements across
  the full available width. Metadata refreshes preserve worker row identity and an
  explicit selection; an unavailable registered target blocks dispatch without
  changing the saved task to automatic placement.
- Worker patch review and worktree review use the same `SidebarPanel` contract:
  the diff scrolls independently while Back and contextual actions remain visible.
  On phones, review takes the place of setup and task inventory; returning restores
  focus to the original action and preserves unsent setup or dispatch drafts.
  Worker patches identify their task and worker and remain downloads. Worktree
  review shows the integration target and source/target revisions; integration
  retains its revision checks and archiving still requires confirmation.
- Native harness details use `SidebarPanel` with a persistent header and an
  independently scrolling body. Closing details does not stop the harness.
  Mobile prioritizes that inspector over setup, provides a shortcut to pending
  requests and collapses output/execution controls. Its maximum height follows
  the measured Agents content region. Reopening the same run retains drafts;
  selecting another clears them. Hidden inspectors pause their detail polling.
  Inbox requests retain their button identity across metadata refreshes. On
  mobile, the selected review is placed first, and explicit back navigation
  restores focus without submitting or advancing to another request.
- The serialized designer uses the panel's spatial roles in its shadow-root
  CSS. Feedback, Assets, Details and Params keep persistent tabs, keyboard
  navigation and scrollable bodies; changing sections preserves unsent notes.
  At narrow widths, the canvas fills the workspace and the Inspector button
  opens those same sections in a modal sheet. History and device controls are
  under More → Preview settings; approval remains available in More. The sheet
  restores focus when closed, and resizing to desktop restores the side panel.
- Fixed Design frames (mobile, slides and creatives) adapt the `PanZoomViewport`
  interaction to the existing native iframe host. Zoom anchors at the viewport
  center; Fit restores framing and Actual size uses 100%. Pan enables a separate
  gesture surface, leaving prototype scrolling and controls available when off.
  Focused canvas shortcuts are `+`/`-`, `0` for Fit and `1` for Actual size;
  arrow keys pan only while Pan is enabled. Annotation cards use the measured
  frame transform, and zoom/pan do not remount the preview iframe.
- Implementation evidence shows completed checks for the current revision and
  applicable variant, severity counts and measured reuse. A missing measurement
  is not displayed as zero. Assessment cards retain the backend's judgments,
  evidence and limitations, and explicitly identify unavailable results. They
  add no inferred score, confidence or approval.

## Available upstream patterns

The vendored App and Base kits also provide labelled rails, responsive navigation
docks, contextual sidebar panels, searchable selects and inline editing. Adopting
them in Redcode requires a Solid interaction adapter and a product-specific use
case; vendoring their source does not enable them automatically.

The upstream Data kit now includes charts, diagrams, traces, virtual lists and a
terminal presentation component. It is outside the current App-only manifest.
Its transport, agent execution, terminal ownership and telemetry remain the
consumer's responsibility. Enable that kit when implementing a concrete surface
rather than adding its chart or Svelte dependencies to application startup.

## Opportunities by surface

This assessment uses the stable [v2026.10.20 release](https://github.com/reddb-io/design-system/releases/tag/v2026.10.20).
The manifest and receipt identify the delivered version; a later showcase commit
does not move that pin. The tables distinguish integrated adapters from the
opportunities that still require product work.

### Desktop

Desktop renders the shared application through
[`DesktopApp`](../packages/desktop/src/renderer/desktop-app.tsx). Most UI adoption
therefore benefits the browser too; native window controls and Electron browser
ownership remain desktop concerns.

| DS capability                                 | Concrete opportunity                                                                                                    | Integration boundary                                                                                                                                                                                                                                                                                                                |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Labelled `SidebarRail` and navigation markers | Make Agents, projects and Settings easier to identify while showing background work and approval counts.                | Integrated in [`rail.tsx`](../packages/app/src/shell/navigation/rail.tsx), with a persisted label preference. [`shell.tsx`](../packages/app/src/shell/shell.tsx) uses the rendered rail's intrinsic width instead of an icon-only calculation. Running counts remain on Agents; per-session approval states remain in the sidemenu. |
| `SidebarPanel`                                | Give Design and browser inspectors a consistent toolbar, independent scrolling body and contextual actions.             | The Design session panel already adopts these slots. The review itself remains in the browser pane beside its chat; its embedded mode continues to omit duplicate conversation content.                                                                                                                                             |
| `SearchSelect`                                | Search hosts, harnesses and remote project directories by name, path or alias instead of scanning a long native select. | Integrated in [`Agents`](../packages/app/src/shell/navigation/agents-machines.tsx) through a shared Solid adapter. Model/provider selection retains its existing state owner.                                                                                                                                                       |
| `TerminalSession`                             | Standardize terminal appearance, resize, loading failure, retry and read-only views.                                    | Keep the current terminal engine and PTY transport. The DS supplies presentation and adapter lifecycle; a Solid adapter must retain abort/dispose behavior and avoid importing the engine before the terminal opens.                                                                                                                |

### Web and installed PWA

Web uses the same shell with different constraints: browser permissions, narrow
screens, safe areas and no Electron browser service.

| DS capability                                          | Concrete opportunity                                                                                                                        | Integration boundary                                                                                                                                                                                                                                                                                                                   |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Responsive `SidebarLayout` with labelled dock          | Offer four stable primary destinations plus More on phones, giving clearer discovery than an icon rail while preserving conversation width. | Integrated with the shared navigation controller. The dock's normal layout height reserves its space, Browse opens the current scope, and More preserves the other actions. Resized mobile viewport and touch navigation are covered; physical-device keyboard and installed-PWA safe-area behavior still require device verification. |
| `SidebarPanel` and Drawer                              | Turn host/workspace details into a drawer on narrow screens and a contextual panel on wide screens.                                         | Native harness details now use a bounded inline inspector. A responsive drawer remains future work; it must preserve focus restoration and the user's current server selection.                                                                                                                                                        |
| Data `Table`, `KpiCard`, `BreakdownBar`, `MetricChart` | Make worker fleets comparable with filtering, sorting and CPU/RAM/capacity summaries.                                                       | [`agents-hosts.tsx`](../packages/app/src/shell/navigation/agents-hosts.tsx) currently reads snapshots. Historical charts need timestamped retained samples; an unavailable or stale sample must remain visibly different from zero.                                                                                                    |
| `TraceWaterfall`, `Diagram`, `SequenceDiagram`         | Explain coordinator → worker dispatch, queue time, execution and retries.                                                                   | Supply actual task/session events, timings and stable identities. DS selection opens the existing task details; it does not acquire execution ownership or infer a successful retry.                                                                                                                                                   |

### Designer: web pages, mobile, slides and creatives

The designer has two compositions: the session panel in
[`gui-extensions/design`](../packages/gui-extensions/src/design/panel.tsx), and
the serialized review in [`core/design/ui`](../packages/core/src/design/ui/review.ts).
The latter runs both embedded and standalone. Updating the global app stylesheet
alone cannot update that shadow-root interface.

| DS capability                                        | Concrete opportunity                                                                                                                                            | Integration boundary                                                                                                                                                                                                                                                                                                    |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Density and editable type roles                      | Keep the standalone review and embedded review consistent, with compact reading and usable touch controls.                                                      | All four density styles are now generated into the designer. The toolbar uses DS control/target roles, fields use editable text roles, and density changes follow the host or viewport.                                                                                                                                 |
| `SidebarPanel`, tabs and `ScrollArea` plain          | Organize Screens/Slides, Variants, Parameters and Feedback into contextual sections with one independent scrolling body and persistent approval/export actions. | The current inspector adopts spatial roles, persistent scrollable tabs and keyboard-scrollable panels. Screens and variants retain their existing canvas navigation; consolidating those sections is future work.                                                                                                       |
| `SearchSelect` and `InlineEdit`                      | Find a screen, slide, revision or variant quickly; rename a supported item in place.                                                                            | Search can use the existing identifiers. Renaming needs a real persistence operation with validation and revision conflict handling; a visual edit alone must not imply it was saved.                                                                                                                                   |
| `PanZoomViewport`                                    | Add keyboard zoom, fit and touch navigation around a page, slide or creative canvas.                                                                            | Native iframe adaptation is integrated for mobile, slides and creatives, using DS spatial roles and anchored zoom behavior without importing the optional Data kit. Web pages retain their responsive width selector; free canvas navigation for responsive pages remains future work. The whiteboard keeps its engine. |
| `Meter`, `KpiCard`, `BreakdownBar`, optional `Radar` | Show structure, accessibility, implementation checks and creative-analysis results with evidence and confidence.                                                | Check summaries and a native neutral reuse meter now use existing audit results. Assessment judgments expose recorded evidence and limitations. The current schema provides no numeric confidence or quality score, so neither is synthesized. Charts and richer Data-kit compositions remain future work.              |
| `VirtualList` and thumbnail compositions             | Keep large screen/slide/creative libraries responsive without mounting every inspector card.                                                                    | Use the fixed-height list contract only where rows have stable heights. Preserve selected items and keyboard focus; retain the existing session timeline's virtualization.                                                                                                                                              |
| SVG diagrams and static visualizations               | Put structured analysis and architecture figures into reviews and exported reports.                                                                             | Static DS output is HTML with inline SVG and surrounding styles, not a self-contained SVG download. [`export.ts`](../packages/core/src/design/export.ts) must still resolve fonts/assets and validate PDF or raster output.                                                                                             |

## Adoption sequence

1. Keep the current source pin, integrity receipt and shared adapters reproducible.
   The Design panel and density integration are part of this step.
2. Adopt searchable host/project/harness selection and contextual inspector
   panels across desktop and web. These use existing data and need no new worker
   telemetry service. The selectors and native harness inspector are integrated;
   responsive host/workspace drawers remain pending.
3. Design the labelled rail and responsive mobile dock together, including measured
   widths/heights, keyboard focus, badges and composer clearance. The labelled
   rail and mobile dock are integrated; physical-device PWA verification remains.
4. Reorganize the designer inspector, then add canvas navigation and structured
   feedback presentation. Preserve review state and annotation geometry at each
   cutover. Density spacing, persistent tabs and keyboard panel scrolling are
   integrated. On narrow screens, the live preview fills the workspace and the
   same inspector opens as a modal sheet. History and device controls move into
   its Details panel, while canvas actions stay in one row. Preview iframes keep
   their DOM parent and state when the inspector opens or the layout changes.
   Fixed-frame zoom/pan, annotation anchoring and structured check/
   assessment evidence are also integrated; responsive-page canvas navigation
   and richer Data-kit visuals remain pending.
5. Route the Data kit for a concrete fleet or analysis surface. Add history/event
   inputs before charts that depend on them, and load optional chart/terminal
   engines only when the relevant panel opens.
