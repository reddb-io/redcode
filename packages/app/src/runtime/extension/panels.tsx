import {
  batch,
  createEffect,
  createMemo,
  For,
  mergeProps,
  on,
  onCleanup,
  onMount,
  Show,
  untrack,
  type Accessor,
  type JSX,
} from "solid-js"
import { createStore } from "solid-js/store"
import { Schema } from "effect"
import { makeEventListener } from "@solid-primitives/event-listener"
import { createMediaQuery } from "@solid-primitives/media"
import { Icon } from "@opencode/ui/icon"
import { ResizeHandle } from "@opencode/ui/resize-handle"
import {
  SESSION_REVIEW_V2_SIDEBAR_WIDTH_DEFAULT,
  SESSION_REVIEW_V2_SIDEBAR_WIDTH_MAX,
  SESSION_REVIEW_V2_SIDEBAR_WIDTH_MIN,
} from "@opencode/session-ui/v2/session-review-v2"
import {
  Panel,
  PanelContext,
  type PanelFrame,
  type PanelSidebar,
  type PanelTab,
  type MountedSession,
  type SessionScreen,
} from "@opencode/gui-extensions/sdk"
import { same } from "@/runtime/persistence/equality"
import { Persist, persisted } from "@/runtime/persistence/storage"
import { Persistence } from "@/runtime/persistence/schema"
import { createSizing } from "@/session/helpers"
import { useSessionLayout } from "@/session/session-layout"
import { useExtensionHost } from "./host"
import { Contribution } from "./render"
import { useExtensionAttachment } from "./attachment"
import { legacyKeys, panelKey } from "./panel-keys"
import {
  adopt,
  arrange,
  companions,
  groupOf,
  move,
  pick,
  select,
  WORKBENCH_INITIAL,
  type WorkbenchGroup,
  type WorkbenchState,
} from "./workbench-model"

type Tabs = Accessor<{
  all(): string[]
  active(): string | undefined
  setAll(all: string[]): void
  setActive(tab: string | undefined): void
  close(tab: string): void
  remap(rewrite: (tab: string) => string): void
}>

export type RegionEntry = {
  readonly key: string
  readonly extension: string
  readonly tab: PanelTab
  readonly provider: Panel
}

const SidebarState = Persistence.struct({
  sidebarOpened: Schema.Boolean,
  sidebarWidth: Schema.Finite.check(
    Schema.isBetween({ minimum: SESSION_REVIEW_V2_SIDEBAR_WIDTH_MIN, maximum: SESSION_REVIEW_V2_SIDEBAR_WIDTH_MAX }),
  ),
  expandMode: Schema.Literals(["expand", "collapse"]),
})

/**
 * The inner sidebar preference every side panel shares. The key predates extensions. `Layout.sidebar` reads it while
 * the session screen that created it is mounted.
 */
export function createPanelSidebar(): PanelSidebar {
  const [store, setStore, , ready] = persisted(Persist.global("review-panel-v2"), SidebarState, {
    sidebarOpened: true,
    sidebarWidth: SESSION_REVIEW_V2_SIDEBAR_WIDTH_DEFAULT,
    expandMode: "collapse",
  })

  const sidebar: PanelSidebar = {
    opened: () => store.sidebarOpened,
    width: () => store.sidebarWidth,
    transition: ready,
    resize: (width) =>
      setStore(
        "sidebarWidth",
        Math.min(SESSION_REVIEW_V2_SIDEBAR_WIDTH_MAX, Math.max(SESSION_REVIEW_V2_SIDEBAR_WIDTH_MIN, width)),
      ),
    toggle: () => setStore("sidebarOpened", (opened) => !opened),
  }

  onCleanup(useExtensionAttachment().sidebar(sidebar))

  return sidebar
}

/** The workbench state the side region splits into groups with, for the routed shell tab. */
export type Workbench = {
  state: Accessor<WorkbenchState>
  update(change: (state: WorkbenchState) => WorkbenchState): void
}

/**
 * Every panel extensions offer in one region of the routed session, merged with the stored strip. `view` returns the
 * routed session's object, a new one per routed session. On wide screens the open tabs, and the dock while
 * `dock.entry` returns it, split into the workbench's top and bottom groups.
 */
export function createRegion(input: {
  region: Panel["region"]
  view: Accessor<MountedSession>
  screen: SessionScreen
  tabs: Tabs
  workbench?: Workbench
  /** The side tabs show; while they do not, the column holds the dock alone. Defaults to shown. */
  sideOpen?: Accessor<boolean>
  /** The dock while it is open in the workbench, and how its tab closes it. */
  dock?: { entry: Accessor<RegionEntry | undefined>; close(): void }
}) {
  const host = useExtensionHost()
  const stored = () => input.tabs().all()
  const providers = createMemo(() => host.items(Panel).filter((item) => item.value.region === input.region))

  const entries = createMemo(() =>
    providers().flatMap((item) => {
      const prefix = `${item.extension}:`
      const open = stored().flatMap((key) => (key.startsWith(prefix) ? [key.slice(prefix.length)] : []))

      return item.value.list(panelInput(input.view, input.screen, { open })).map(
        (tab): RegionEntry => ({
          key: panelKey(item.extension, tab.id),
          extension: item.extension,
          tab,
          provider: item.value,
        }),
      )
    }),
  )

  const byKey = createMemo(() => new Map(entries().map((entry) => [entry.key, entry])))

  // Rewrites stored keys once their panel is present: keys stored before extensions (e.g. "context") or under an
  // extension's earlier id, and ids a panel writes more than one way. Duplicates collapse, so one file stored two ways
  // is one tab.
  createEffect(() => {
    const legacy = legacyKeys(providers())
    const normalizers = providers().flatMap((item) => (item.value.normalize ? [item] : []))

    if (legacy.size === 0 && normalizers.length === 0) return

    const rewrite = (key: string) => {
      const moved = legacy.get(key)

      if (moved) return moved
      const item = normalizers.find((provider) => key.startsWith(`${provider.extension}:`))

      if (!item?.value.normalize) return key

      return panelKey(
        item.extension,
        item.value.normalize(
          panelInput(input.view, input.screen, {
            id: key.slice(item.extension.length + 1),
          }),
        ),
      )
    }

    // remap reads the stored tabs and writes nothing once every key is canonical, so this settles in one rerun.
    input.tabs().remap(rewrite)
  })

  // Transient panels are not restored: their stored keys leave once the panel stops listing them.
  createEffect(() => {
    const listed = new Set(entries().map((entry) => entry.key))
    const transient = providers().flatMap((item) => (item.value.transient ? [`${item.extension}:`] : []))

    if (transient.length === 0) return
    const all = stored()
    const next = all.filter((key) => listed.has(key) || !transient.some((prefix) => key.startsWith(prefix)))

    if (next.length !== all.length) input.tabs().setAll(next)
  })

  const strip = createMemo(() => {
    const listed = stored().flatMap((key) => {
      const entry = byKey().get(key)

      return entry && !entry.tab.pinned ? [entry] : []
    })

    return [
      ...entries().filter((entry) => entry.tab.pinned),
      ...listed.filter((entry) => entry.tab.first),
      ...listed.filter((entry) => !entry.tab.first),
    ]
  })

  // Narrow screens never select a transient tab: a stored one falls back like a missing tab.
  const desktop = createMediaQuery("(min-width: 768px)")

  // Fallback selection order: regular tabs, then `first` tabs, then pinned tabs, each only with `fallback` set.
  const fallbackKeys = (list: readonly RegionEntry[]) => {
    const eligible = list.filter((entry) => entry.tab.fallback && (desktop() || !entry.tab.transient))

    return [
      ...eligible.filter((entry) => !entry.tab.pinned && !entry.tab.first),
      ...eligible.filter((entry) => !entry.tab.pinned && entry.tab.first),
      ...eligible.filter((entry) => entry.tab.pinned),
    ].map((entry) => entry.key)
  }

  // The narrow-screen selection: one strip, no groups.
  const stripActive = createMemo(() => {
    const value = input.tabs().active()

    if (value && strip().some((entry) => entry.key === value && (desktop() || !entry.tab.transient))) return value

    return fallbackKeys(strip())[0]
  })

  const workbench = () => input.workbench?.state() ?? WORKBENCH_INITIAL
  const dock = () => input.dock?.entry()
  const home = (key: string): WorkbenchGroup => (key === dock()?.key ? "bottom" : "top")

  // What the column holds: the side tabs while they show, then the dock.
  const column = createMemo(() => {
    const value = dock()

    return [...((input.sideOpen?.() ?? true) ? strip() : []), ...(value ? [value] : [])]
  })

  const columnByKey = createMemo(() => new Map(column().map((entry) => [entry.key, entry])))

  const arranged = createMemo(() => arrange(column().map((entry) => entry.key), workbench(), home), undefined, {
    equals: (a, b) => same(a.top, b.top) && same(a.bottom, b.bottom),
  })

  const groupEntries = (group: WorkbenchGroup) =>
    createMemo(() => arranged()[group].flatMap((key) => columnByKey().get(key) ?? []), [], { equals: same })

  const members = { top: groupEntries("top"), bottom: groupEntries("bottom") }

  // A group's selection: its stored tab, then the last focused tab, then its fallback, then its first drawn tab.
  const groupActive = (group: WorkbenchGroup) =>
    createMemo(() => {
      const list = members[group]()
      const keys = list.map((entry) => entry.key)
      const focused = input.tabs().active()

      return pick(keys, workbench()[group], [
        ...(focused === undefined ? [] : [focused]),
        ...fallbackKeys(list),
        ...list.filter((entry) => !entry.tab.hidden).map((entry) => entry.key),
      ])
    })

  const groupSelection = { top: groupActive("top"), bottom: groupActive("bottom") }

  // The last focused tab while a group shows it, otherwise the top group's selection.
  const focused = createMemo(() => {
    const key = input.tabs().active()

    if (key !== undefined && (key === groupSelection.top() || key === groupSelection.bottom())) return key

    return groupSelection.top() ?? groupSelection.bottom()
  })

  const active = createMemo(() => (desktop() ? focused() : stripActive()))

  // A tab focused through the stored strip (an extension opening it, or a click) becomes its group's selection.
  createEffect(
    on(
      () => input.tabs().active(),
      (key) => {
        if (key === undefined || !input.workbench) return
        const group = groupOf(untrack(workbench), key, home(key))
        input.workbench.update((state) => select(state, group, key))
      },
      { defer: true },
    ),
  )

  // The effect's own value marks its first run: the selection the region mounts with, stored or fallback.
  const focusOn = (selection: Accessor<string | undefined>, enabled: Accessor<boolean>) =>
    createEffect(
      on(selection, (key, _, restored: boolean = true) => {
        const entry = key && enabled() ? byKey().get(key) : undefined

        if (entry)
          entry.provider.focus?.(
            panelInput(input.view, input.screen, {
              tab: entry.tab,
              restored,
            }),
          )

        return false
      }),
    )

  focusOn(stripActive, () => !desktop())
  focusOn(groupSelection.top, desktop)
  focusOn(groupSelection.bottom, desktop)

  // Hidden tabs keep their place in the strip for selection, focus, and close, but draw no trigger.
  const drawn = createMemo(() => strip().filter((entry) => !entry.tab.hidden))

  const entry = (key: string) => byKey().get(key) ?? (key === dock()?.key ? dock() : undefined)

  const focusTab = (key: string) => input.tabs().setActive(key)

  const close = (key: string) => {
    if (key === dock()?.key) return input.dock?.close()

    const value = byKey().get(key)
    input.tabs().close(key)

    if (value)
      value.provider.close?.(
        panelInput(input.view, input.screen, {
          tab: value.tab,
        }),
      )
  }

  const group = (name: WorkbenchGroup) => ({
    name,
    /** Every member, hidden ones included, in strip order. */
    entries: members[name],
    /** Drawn trigger order by key. Renders iterate keys so a provider's fresh tab objects never remount a trigger. */
    keys: createMemo(() => members[name]().flatMap((item) => (item.tab.hidden ? [] : [item.key])), [], {
      equals: same,
    }),
    active: groupSelection[name],
    selected: createMemo(() => {
      const key = groupSelection[name]()

      return key ? columnByKey().get(key) : undefined
    }),
    lead: () => !!members[name]().find((item) => !item.tab.hidden && !item.tab.pinned)?.tab.first,
  })

  return {
    entries,
    /** Drawn strip order by key. Renders iterate keys so a provider's fresh tab objects never remount a trigger. */
    keys: createMemo(() => drawn().map((item) => item.key), [], { equals: same }),
    entry,
    active,
    selected: createMemo(() => {
      const key = active()

      return key ? entry(key) : undefined
    }),
    /** The workbench groups on wide screens. */
    groups: { top: group("top"), bottom: group("bottom") },
    /** Whether a group shows the tab, so the tab is on screen while its group is. */
    showing: (key: string) => groupSelection.top() === key || groupSelection.bottom() === key,
    /** The group a key is in, or would land in. */
    groupOf: (key: string) => groupOf(workbench(), key, home(key)),
    wide: createMemo(() => providers().some((item) => item.value.wide)),
    /** An extension's tab ids in the stored strip. */
    openFor: (extension: string) =>
      stored().flatMap((key) => (key.startsWith(`${extension}:`) ? [key.slice(extension.length + 1)] : [])),
    lead: () => !!drawn().find((item) => !item.tab.pinned)?.tab.first,
    select: focusTab,
    close,
    /** Moves a tab, and every tab that renders with it, to a group, and selects it there. */
    move(key: string, to: WorkbenchGroup) {
      const keys = companions(
        column().map((item) => ({
          key: item.key,
          group: item.tab.group === undefined ? undefined : `${item.extension}/${item.tab.group}`,
        })),
        key,
      )
      batch(() => {
        input.workbench?.update((state) => move(state, keys, to, home))
        focusTab(key)
      })
    },
    /** Places tabs that appear after `before` in `target`: a launcher opened in a group opens its tab there. */
    adopt(before: readonly string[], target: WorkbenchGroup) {
      const after = column().map((item) => item.key)
      input.workbench?.update((state) => adopt(state, { before, after, target, home }))
    },
    /** The column's keys right now, for `adopt`. */
    snapshot: () => column().map((item) => item.key),
  }
}

export type Region = ReturnType<typeof createRegion>

export type RegionGroup = Region["groups"]["top"]

/** Grouped content stays mounted while any member is listed; other tabs mount only while selected. */
export function RegionContent(props: {
  group: Pick<RegionGroup, "entries" | "selected">
  openFor: (extension: string) => readonly string[]
  view: MountedSession
  screen: SessionScreen
  frame: Omit<PanelFrame, "visible" | "open"> & { shown: Accessor<boolean> }
}) {
  // The dock renders once for the whole column; see `DockHost`.
  const listed = createMemo(() => props.group.entries().filter((entry) => entry.provider.region !== "dock"))

  const groups = createMemo(() =>
    Array.from(new Set(listed().flatMap((entry) => (entry.tab.group ? [groupKey(entry)] : [])))),
  )

  const single = createMemo(() => {
    const entry = props.group.selected()

    return entry && !entry.tab.group && entry.provider.region !== "dock" ? entry.key : undefined
  })

  return (
    <>
      <For each={groups()}>
        {(group) => {
          const active = () => {
            const entry = props.group.selected()

            return !!entry && groupKey(entry) === group
          }

          // The last selected member keeps rendering while the group is hidden.
          const member = createMemo<RegionEntry | undefined>((previous) => {
            const members = listed().filter((entry) => groupKey(entry) === group)
            const selected = props.group.selected()

            if (selected && groupKey(selected) === group) return selected

            return members.find((entry) => entry.key === previous?.key) ?? members[0]
          })

          return (
            <Show when={member()?.extension} keyed>
              {(extension) => (
                <div
                  id={member()?.tab.dom?.panel}
                  role="tabpanel"
                  aria-labelledby={active() && !member()?.tab.hidden ? member()?.tab.dom?.tab : undefined}
                  data-slot="tabs-content"
                  class="h-full min-h-0 overflow-hidden"
                  classList={{ hidden: !active() }}
                  inert={!active() || undefined}
                >
                  <PanelContext.Provider
                    value={{
                      ...props.frame,
                      visible: () => props.frame.shown() && active(),
                      open: () => props.openFor(extension),
                    }}
                  >
                    <Contribution extension={extension}>
                      {() =>
                        member()!.provider.render(
                          panelInput(() => props.view, props.screen, {
                            get tab() {
                              return member()!.tab
                            },
                          }),
                        )
                      }
                    </Contribution>
                  </PanelContext.Provider>
                </div>
              )}
            </Show>
          )
        }}
      </For>
      <Show when={single()} keyed>
        {(key) => {
          const entry = createMemo(() => listed().find((item) => item.key === key))

          return (
            <Show when={entry()?.extension} keyed>
              {(extension) => (
                <div
                  id={entry()?.tab.dom?.panel}
                  role="tabpanel"
                  aria-labelledby={entry()?.tab.hidden ? undefined : entry()?.tab.dom?.tab}
                  tabIndex={entry()?.tab.tabbable ? 0 : undefined}
                  data-slot="tabs-content"
                  class="flex flex-col h-full overflow-hidden contain-strict"
                >
                  <PanelContext.Provider
                    value={{ ...props.frame, visible: props.frame.shown, open: () => props.openFor(extension) }}
                  >
                    <Contribution extension={extension}>
                      {() =>
                        entry()!.provider.render(
                          panelInput(() => props.view, props.screen, {
                            get tab() {
                              return entry()!.tab
                            },
                          }),
                        )
                      }
                    </Contribution>
                  </PanelContext.Provider>
                </div>
              )}
            </Show>
          )
        }}
      </Show>
    </>
  )
}

function groupKey(entry: RegionEntry) {
  return `${entry.extension}/${entry.tab.group ?? entry.key}`
}

/** Keeps session and tab getters live while the owning screen stays constant. Spreading would snapshot getters. */
function panelInput<T extends object>(view: Accessor<MountedSession>, screen: SessionScreen, fields: T) {
  return mergeProps(
    {
      get session() {
        return view()
      },
      screen,
    },
    fields,
  )
}

/**
 * The dock as a workbench tab: the first tab the first dock panel lists. The strip tab wraps the panel's tab, kept per
 * panel tab object so its trigger never remounts, and never drags: the dock is not in the stored strip.
 */
export function createDockEntry(view: Accessor<MountedSession>, screen: SessionScreen) {
  const host = useExtensionHost()
  const wrapped = new WeakMap<PanelTab, PanelTab>()

  return createMemo(
    (): RegionEntry | undefined => {
      const item = host.items(Panel).find((candidate) => candidate.value.region === "dock")
      const tab = item?.value.list(panelInput(view, screen, { open: [] }))[0]

      if (!item || !tab) return
      const strip = wrapped.get(tab) ?? dockTab(tab)
      wrapped.set(tab, strip)

      return { key: panelKey(item.extension, tab.id), extension: item.extension, tab: strip, provider: item.value }
    },
    undefined,
    { equals: (a, b) => a?.key === b?.key && a?.tab === b?.tab && a?.provider === b?.provider },
  )
}

function dockTab(tab: PanelTab): PanelTab {
  return {
    id: tab.id,
    get title() {
      return tab.title
    },
    label: () => (
      <span class="flex items-center gap-1.5">
        <Icon name="terminal" size="small" />
        <span>{tab.title}</span>
      </span>
    ),
    draggable: false,
    closable: "hover",
    dom: { tab: "workbench-dock-tab", panel: "terminal-panel" },
  }
}

/** The dock region: host frame, sizing, and resize around the dock panel an extension renders. */
export function DockRegion(props: {
  view: MountedSession
  screen: SessionScreen
  sidebar: PanelSidebar
  stacked?: boolean
  fill?: boolean
  framed?: boolean
  present?: boolean
  contentHeight?: string
  embedded?: boolean
  animate?: boolean
  reserve?: boolean
}) {
  const host = useExtensionHost()
  const { view } = useSessionLayout()
  const isDesktop = createMediaQuery("(min-width: 768px)")
  const size = createSizing()

  const [store, setStore] = createStore({
    viewport: typeof window === "undefined" ? 1000 : (window.visualViewport?.height ?? window.innerHeight),
  })

  const entry = createMemo(() =>
    host
      .items(Panel)
      .filter((item) => item.value.region === "dock")
      .flatMap((item) =>
        item.value.list(panelInput(() => props.view, props.screen, { open: [] })).map(
          (tab): RegionEntry => ({
            key: panelKey(item.extension, tab.id),
            extension: item.extension,
            tab,
            provider: item.value,
          }),
        ),
      )
      .at(0),
  )

  const opened = createMemo(() => view().dock.opened())
  const height = createMemo(() => view().dock.height())
  const max = () => store.viewport * 0.6
  const regionHeight = () => Math.min(height(), max())
  const stacked = createMemo(() => isDesktop() && !!props.stacked)

  const panelHeight = createMemo(() => {
    if (props.fill) return "100%"

    if (!opened()) return "0px"

    if (isDesktop()) return stacked() ? `${regionHeight()}px` : "100%"

    return `${regionHeight()}px`
  })

  const contentHeight = createMemo(
    () => props.contentHeight ?? (isDesktop() ? (stacked() ? `${regionHeight()}px` : "100%") : `${regionHeight()}px`),
  )

  const present = createMemo(() => opened() || !!props.present)
  let root: HTMLElement | undefined

  onMount(() => {
    const sync = () => setStore("viewport", window.visualViewport?.height ?? window.innerHeight)
    sync()
    makeEventListener(window, "resize", sync)

    if (window.visualViewport) makeEventListener(window.visualViewport, "resize", sync)
  })

  createEffect(() => {
    if (opened()) return
    const active = document.activeElement

    if (!(active instanceof HTMLElement)) return

    if (!root?.contains(active)) return
    active.blur()
  })

  return (
    <aside
      ref={root}
      id="terminal-panel"
      data-component="terminal-panel"
      data-opened={opened()}
      data-size-animated={props.animate !== false && !props.embedded && !size.active() && (!isDesktop() || stacked())}
      role="region"
      aria-label={entry()?.tab.title}
      aria-hidden={!opened()}
      inert={!opened()}
      class="relative shrink-0 overflow-hidden bg-elevation-base-surface"
      classList={{
        "w-full": !isDesktop() || stacked(),
        "min-w-0 h-full flex-1": isDesktop() && present() && !stacked(),
        "w-0 h-full pointer-events-none": isDesktop() && !present(),
        "rounded-lg border border-elevation-base-border": isDesktop() && (props.framed ?? true),
        "will-change-[height]": !props.embedded && !size.active() && (!isDesktop() || stacked()),
      }}
      style={{ height: panelHeight(), "--terminal-panel-height": contentHeight() }}
    >
      <div classList={{ "md:hidden": !stacked(), hidden: stacked() || props.embedded }} onPointerDown={size.start}>
        <ResizeHandle
          class="-top-1"
          direction="vertical"
          size={regionHeight()}
          min={100}
          max={max()}
          collapseThreshold={50}
          onResize={(next) => {
            size.touch()
            view().dock.resize(next)
          }}
          onCollapse={() => view().dock.close()}
        />
      </div>
      <div
        data-slot="terminal-panel-content"
        class="absolute inset-x-0 top-0 flex flex-col overflow-hidden"
        classList={{
          "border-t border-elevation-base-border": opened() && !isDesktop() && !props.embedded,
          "pointer-events-none": !opened(),
        }}
        style={{ height: contentHeight() }}
      >
        <Show when={entry()?.extension} keyed>
          {(extension) => (
            <PanelContext.Provider
              value={{
                visible: opened,
                present,
                placement: () => (props.embedded ? "mobile" : stacked() ? "bottom" : "side"),
                reserve: () => !!props.reserve,
                animate: () => !size.active(),
                sidebar: props.sidebar,
                open: () => [],
              }}
            >
              <Contribution extension={extension}>
                {() =>
                  entry()!.provider.render(
                    panelInput(() => props.view, props.screen, {
                      get tab() {
                        return entry()!.tab
                      },
                    }),
                  )
                }
              </Contribution>
            </PanelContext.Provider>
          )}
        </Show>
      </div>
    </aside>
  )
}

/**
 * The dock inside the workbench. It renders once and moves between the groups' slots, so moving the terminal to the
 * other group or selecting another tab never remounts its sessions. With no slot (the dock closed, or its group not
 * drawn) it waits in a hidden parking element, cached like the side dock was.
 */
export function DockHost(props: {
  entry: RegionEntry
  view: MountedSession
  screen: SessionScreen
  sidebar: PanelSidebar
  target: HTMLElement | undefined
  visible: boolean
  animate: boolean
}) {
  let park: HTMLDivElement | undefined

  const node = (
    <div
      id="terminal-panel"
      data-component="terminal-panel"
      role="region"
      aria-label={props.entry.tab.title}
      class="size-full flex flex-col overflow-hidden bg-elevation-base-surface"
    >
      <Show when={props.entry.extension} keyed>
        {(extension) => (
          <PanelContext.Provider
            value={{
              visible: () => props.visible,
              present: () => true,
              placement: () => "side",
              reserve: () => false,
              animate: () => props.animate,
              sidebar: props.sidebar,
              open: () => [],
            }}
          >
            <Contribution extension={extension}>
              {() =>
                props.entry.provider.render(
                  panelInput(() => props.view, props.screen, {
                    get tab() {
                      return props.entry.tab
                    },
                  }),
                )
              }
            </Contribution>
          </PanelContext.Provider>
        )}
      </Show>
    </div>
  ) as HTMLDivElement

  createEffect(() => {
    const target = props.target ?? park

    if (target && node.parentElement !== target) target.appendChild(node)
  })
  onCleanup(() => node.remove())

  return <div ref={park} class="hidden" aria-hidden="true" />
}

/** Renders one panel as a narrow-screen view. */
export function MobilePanel(props: {
  entry: RegionEntry
  view: MountedSession
  screen: SessionScreen
  sidebar: PanelSidebar
  visible: boolean
  open: Accessor<readonly string[]>
}): JSX.Element {
  return (
    <PanelContext.Provider
      value={{
        visible: () => props.visible,
        present: () => props.visible,
        placement: () => "mobile",
        reserve: () => false,
        animate: () => true,
        sidebar: props.sidebar,
        open: props.open,
      }}
    >
      <Contribution extension={props.entry.extension}>
        {() =>
          props.entry.provider.render(
            panelInput(() => props.view, props.screen, {
              get tab() {
                return props.entry.tab
              },
            }),
          )
        }
      </Contribution>
    </PanelContext.Provider>
  )
}
