import { For, Show, createEffect, createMemo, createSignal, on, onCleanup, type JSX } from "solid-js"
import { createStore } from "solid-js/store"
import { createMediaQuery } from "@solid-primitives/media"
import { createEventListener, makeEventListener } from "@solid-primitives/event-listener"
import { DragDropProvider, PointerSensor } from "@dnd-kit/solid"
import { isSortable } from "@dnd-kit/solid/sortable"
import { Accessibility, AutoScroller, Feedback, PointerActivationConstraints } from "@dnd-kit/dom"
import { RestrictToHorizontalAxis } from "@dnd-kit/abstract/modifiers"
import { RestrictToElement } from "@dnd-kit/dom/modifiers"
import { splitView } from "@reddb-io/design-system/contracts/split-view"
import { Tabs } from "@opencode/ui/tabs"
import { IconButton } from "@opencode/ui/icon-button"
import { Icon } from "@opencode/ui/icon"
import type { IconName } from "@opencode/ui/icons/catalog"
import { ResizeHandle } from "@opencode/ui/resize-handle"
import { Tooltip } from "@opencode/ui/tooltip"
import type { MountedSession, SessionScreen, PanelSidebar } from "@opencode/gui-extensions/sdk"
import { useLanguage } from "@/runtime/i18n/language"
import { useLayout } from "@/shell/state/layout"
import { useSessionLayout } from "@/session/session-layout"
import type { Sizing } from "@/session/helpers"
import { PanelTrigger } from "./panel-trigger"
import { DockHost, RegionContent, type Region, type RegionEntry, type RegionGroup, type Workbench } from "./panels"
import { ExtensionSlot } from "./render"
import { createTabStripScroll } from "./tab-strip-scroll"
import { createLauncherItems, Launcher, type LauncherItem } from "./launcher"
import {
  otherGroup,
  resize,
  restore,
  shown,
  toggleExpanded,
  toggleMaximized,
  WORKBENCH_RATIO,
  type WorkbenchGroup,
} from "./workbench-model"

const FILE_TREE_WIDTH_MIN = 240

/** How long a launcher run claims the tab it opens for its group. Commands such as Side chat ask first. */
const LAUNCH_WINDOW = 15_000

/**
 * The side region: the workbench's top and bottom groups, each with its own tab strip and launcher, the dock among
 * their tabs, and the inner sidebar beside them.
 */
export function SideRegion(props: {
  view: MountedSession
  screen: SessionScreen
  region: Region
  sidebar: PanelSidebar
  workbench: Workbench
  /** The dock while it lives in the workbench, open or not. */
  dock?: RegionEntry
  fileTree: boolean
  present?: boolean
  size: Sizing
}) {
  const layout = useLayout()
  const language = useLanguage()
  const { tabs, view, params } = useSessionLayout()

  const isDesktop = createMediaQuery("(min-width: 768px)")
  const dockOpen = createMemo(() => isDesktop() && !!props.dock && view().dock.opened())
  const tabsOpen = createMemo(() => isDesktop() && view().side.opened())
  const columnOpen = createMemo(() => tabsOpen() || dockOpen())
  const columnVisible = createMemo(() => columnOpen() || !!props.present)
  const fileOpen = createMemo(() => isDesktop() && props.fileTree)
  const open = createMemo(() => columnOpen() || fileOpen())
  const visible = createMemo(() => columnVisible() || fileOpen())
  const fileTreeWidth = createMemo(() => Math.max(FILE_TREE_WIDTH_MIN, layout.fileTree.width()))

  const panelWidth = createMemo(() => {
    if (!visible()) return "0px"

    if (columnVisible()) return "auto"

    return `${fileTreeWidth()}px`
  })

  const treeWidth = createMemo(() => (fileOpen() ? `${fileTreeWidth()}px` : "0px"))

  const top = props.region.groups.top
  const bottom = props.region.groups.bottom
  const state = props.workbench.state
  const [launcher, setLauncher] = createStore<Record<WorkbenchGroup, boolean>>({ top: false, bottom: false })
  const [slots, setSlots] = createStore<Partial<Record<WorkbenchGroup, HTMLElement>>>({})
  const [column, setColumn] = createSignal<HTMLDivElement>()
  const empty = createMemo(() => top.entries().length === 0 && bottom.entries().length === 0)

  // The top group holds the launcher while the column has nothing else to show.
  const has = createMemo(() => ({
    top: top.entries().length > 0 || launcher.top || empty(),
    bottom: bottom.entries().length > 0 || launcher.bottom,
  }))

  const display = createMemo(() => shown(has(), state().maximized))
  const items = createLauncherItems({ region: props.region, dock: () => props.dock?.key })

  // A group's launcher closes once its group loses every tab some other way, so an emptied group does not linger.
  createEffect(() => {
    if (launcher.bottom && bottom.entries().length === 0 && !has().top) setLauncher("bottom", false)
  })

  const dockGroup = createMemo(() => (props.dock ? props.region.groupOf(props.dock.key) : undefined))

  const dockShown = createMemo(() => {
    const group = dockGroup()

    if (!group || !dockOpen() || launcher[group]) return false

    return display()[group] && props.region.groups[group].active() === props.dock?.key
  })

  // A launcher run waits for the tab it opens and places it in the launcher's group.
  let pending: { group: WorkbenchGroup; before: readonly string[]; active?: string; at: number } | undefined
  createEffect(
    on(
      () => [props.region.snapshot(), tabs().active()] as const,
      ([keys, active]) => {
        const run = pending

        if (!run) return

        if (Date.now() - run.at > LAUNCH_WINDOW) {
          pending = undefined

          return
        }

        if (keys.some((key) => !run.before.includes(key))) {
          pending = undefined
          props.region.adopt(run.before, run.group)

          return
        }

        if (active === undefined || active === run.active) return
        pending = undefined

        if (props.region.groupOf(active) !== run.group) props.region.move(active, run.group)
      },
      { defer: true },
    ),
  )

  const launch = (group: WorkbenchGroup, item: LauncherItem) => {
    setLauncher(group, false)

    // A tab the column already holds moves here instead of opening again.
    if (item.key && props.region.snapshot().includes(item.key)) {
      props.region.move(item.key, group)

      return
    }

    pending = { group, before: props.region.snapshot(), active: tabs().active(), at: Date.now() }
    item.run()
  }

  // Esc undoes full width, then a maximized group, unless focus is in a field, a terminal or a popup that owns it.
  makeEventListener(document, "keydown", (event) => {
    if (event.key !== "Escape" || event.defaultPrevented || !columnOpen()) return

    if (!state().expanded && !state().maximized) return

    if (
      event.target instanceof Element &&
      event.target.closest(
        'input, textarea, select, [contenteditable="true"], [data-component="terminal"], [role="dialog"], [role="menu"], [role="listbox"]',
      )
    )
      return

    event.preventDefault()
    props.workbench.update(restore)
  })

  const groupStyle = (group: WorkbenchGroup) => {
    if (!display().split) return { flex: "1 1 0px" }

    const ratio = state().ratio

    return { flex: `${group === "top" ? ratio : 1 - ratio} 1 0px` }
  }

  const actions = (group: WorkbenchGroup) => {
    const own = props.region.groups[group]
    const other = otherGroup(group)

    return (
      <>
        <Show when={has()[other] || own.entries().length > 1}>
          <GroupAction
            icon={group === "top" ? "arrow-down-to-line" : "arrow-up"}
            label={language.t(group === "top" ? "workbench.moveDown" : "workbench.moveUp")}
            disabled={own.active() === undefined}
            onClick={() => {
              const key = own.active()

              if (key) props.region.move(key, other)
            }}
          />
        </Show>
        <Show when={group === "top" && !has().bottom}>
          <GroupAction icon="layout-bottom" label={language.t("workbench.split")} onClick={() => setLauncher("bottom", true)} />
        </Show>
        <Show when={has()[other]}>
          <GroupAction
            icon={state().maximized === group ? "collapse" : "expand"}
            label={language.t(state().maximized === group ? "workbench.restore" : "workbench.maximize")}
            pressed={state().maximized === group}
            onClick={() => props.workbench.update((current) => toggleMaximized(current, group))}
          />
        </Show>
        <GroupAction
          icon={state().expanded ? "layout-right-partial" : "layout-right-full"}
          label={language.t(state().expanded ? "workbench.collapse" : "workbench.expand")}
          pressed={state().expanded}
          onClick={() => props.workbench.update(toggleExpanded)}
        />
      </>
    )
  }

  const group = (name: WorkbenchGroup) => (
    <Show when={has()[name]}>
      <WorkbenchGroupView
        name={name}
        group={props.region.groups[name]}
        region={props.region}
        view={props.view}
        screen={props.screen}
        sidebar={props.sidebar}
        size={props.size}
        hidden={!display()[name]}
        leading={name === "top" || !display().top}
        shown={() => tabsOpen() && display()[name]}
        present={columnVisible}
        launcher={launcher[name] || (name === "top" && empty())}
        items={items()}
        onLauncher={(value) => setLauncher(name, value)}
        onLaunch={(item) => launch(name, item)}
        dockKey={props.dock?.key}
        slot={(element) => setSlots(name, element)}
        style={groupStyle(name)}
        actions={actions(name)}
      />
    </Show>
  )

  return (
    <Show when={isDesktop() && !!params.id}>
      <aside
        id="review-panel"
        aria-label={language.t("session.panel.reviewAndFiles")}
        aria-hidden={!open()}
        inert={!open()}
        class="relative min-w-0 flex overflow-clip [overflow-clip-margin:8px]"
        classList={{
          "h-full shrink-0": true,
          "pointer-events-none": !open(),
          "transition-[width] duration-[240ms] ease-[cubic-bezier(0.22,1,0.36,1)] will-change-[width] motion-reduce:transition-none":
            !props.size.active(),
          "flex-1": columnVisible(),
        }}
        style={{ width: panelWidth() }}
      >
        <Show when={visible()}>
          <div
            data-slot="session-review-content"
            class="h-full flex gap-2 shrink-0"
            style={{ width: "var(--session-side-content-width, 100%)" }}
          >
            <Show when={columnVisible()}>
              <div
                ref={setColumn}
                data-component="workbench"
                data-split={display().split}
                data-maximized={state().maximized}
                class={splitView({ orientation: "vertical", class: "relative min-w-0 h-full flex-1" }).root()}
              >
                {group("top")}
                <Show when={display().split}>
                  <GroupDivider
                    ratio={state().ratio}
                    column={column}
                    size={props.size}
                    onResize={(ratio, height) => props.workbench.update((current) => resize(current, ratio, height))}
                  />
                </Show>
                {group("bottom")}
              </div>
            </Show>

            <Show when={fileOpen()}>
              <div
                id="file-tree-panel"
                class="relative min-w-0 h-full shrink-0 overflow-hidden rounded-lg bg-elevation-base-surface shadow-elevation-raised"
                classList={{
                  "transition-[width] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] will-change-[width] motion-reduce:transition-none":
                    !props.size.active(),
                }}
                style={{ width: treeWidth() }}
              >
                <div class="h-full flex flex-col overflow-hidden group/filetree">
                  <ExtensionSlot
                    at="session.panel.sidebar"
                    input={{
                      get session() {
                        return props.view
                      },
                      get screen() {
                        return props.screen
                      },
                    }}
                  />
                </div>
                <div onPointerDown={() => props.size.start()}>
                  <ResizeHandle
                    direction="horizontal"
                    edge="start"
                    size={fileTreeWidth()}
                    min={FILE_TREE_WIDTH_MIN}
                    max={480}
                    onResize={(width) => {
                      props.size.touch()
                      layout.fileTree.resize(width)
                    }}
                  />
                </div>
              </div>
            </Show>
          </div>
        </Show>
        <Show when={props.dock}>
          {(entry) => (
            <DockHost
              entry={entry()}
              view={props.view}
              screen={props.screen}
              sidebar={props.sidebar}
              target={dockOpen() && dockGroup() ? slots[dockGroup()!] : undefined}
              visible={dockShown()}
              animate={!props.size.active()}
            />
          )}
        </Show>
      </aside>
    </Show>
  )
}

/** One workbench group: its tab strip with "+", its actions, and the selected tab, the dock, or the launcher. */
function WorkbenchGroupView(props: {
  name: WorkbenchGroup
  group: RegionGroup
  region: Region
  view: MountedSession
  screen: SessionScreen
  sidebar: PanelSidebar
  size: Sizing
  /** Out of sight while the other group is maximized; it stays mounted. */
  hidden: boolean
  /** The column's first group on screen, whose strip lines up with the session header. */
  leading: boolean
  shown: () => boolean
  present: () => boolean
  launcher: boolean
  items: readonly LauncherItem[]
  onLauncher: (open: boolean) => void
  onLaunch: (item: LauncherItem) => void
  dockKey?: string
  slot: (element: HTMLDivElement) => void
  style: JSX.CSSProperties
  actions: JSX.Element
}) {
  const language = useLanguage()
  const { tabs } = useSessionLayout()
  let tabList: HTMLDivElement | undefined
  let selectionEvent: Event | undefined

  const value = () => (props.launcher ? "launcher" : (props.group.active() ?? "empty"))

  return (
    <section
      data-component="workbench-group"
      data-group={props.name}
      aria-label={language.t(props.name === "top" ? "workbench.group.top" : "workbench.group.bottom")}
      class="relative min-h-0 min-w-0 flex flex-col overflow-hidden rounded-lg bg-elevation-base-surface shadow-elevation-raised"
      classList={{ hidden: props.hidden }}
      inert={props.hidden || undefined}
      style={props.style}
    >
      <DragDropProvider
        sensors={[
          PointerSensor.configure({
            activationConstraints: [new PointerActivationConstraints.Distance({ value: 4 })],
            preventActivation: (event) =>
              event.target instanceof Element &&
              (!!event.target.closest('[data-slot="tabs-trigger-close-button"]') ||
                !!event.target.closest(".session-review-v2-open-in-app-slot")),
          }),
        ]}
        modifiers={[RestrictToHorizontalAxis, RestrictToElement.configure({ element: () => tabList ?? null })]}
        plugins={(defaults) => [
          ...defaults.filter((plugin) => plugin !== Accessibility),
          AutoScroller.configure({ acceleration: 8, threshold: { x: 0.05, y: 0 } }),
          Feedback.configure({ dropAnimation: null }),
        ]}
        onDragEnd={(event) => {
          const source = event.operation.source

          if (event.canceled || !isSortable(source) || source.initialIndex === source.index) return
          tabs().move(source.id.toString(), source.index)
        }}
      >
        <Tabs
          value={value()}
          onChange={(next) => {
            // Kobalte selects the first tab while triggers register, including while a click is still dispatching.
            // Persist input events on a tab only; the region owns fallback selection.
            if (
              !selectionEvent ||
              selectionEvent.eventPhase === Event.NONE ||
              !(selectionEvent.target instanceof Element) ||
              !selectionEvent.target.closest('[role="tab"]') ||
              next === "launcher"
            )
              return

            props.onLauncher(false)
            props.region.select(next)
          }}
        >
          {/* The leading strip shares the session header's 48px row; a lower group's strip is 40px. */}
          <div
            class="session-review-v2-tabs-bar sticky top-0 shrink-0 flex items-center"
            style={{ "--tabs-bar-height": props.leading ? "48px" : "40px" }}
          >
            <Tabs.List
              ref={(el: HTMLDivElement) => {
                tabList = el
                createEventListener(el, ["pointerdown", "click", "keydown"], (event) => (selectionEvent = event), {
                  capture: true,
                })
                onCleanup(createTabStripScroll({ el, lead: props.group.lead }))
              }}
            >
              <For each={props.group.keys()}>
                {(key) => (
                  <Show when={props.region.entry(key)}>
                    {(entry) => (
                      <PanelTrigger
                        value={key}
                        extension={entry().extension}
                        tab={entry().tab}
                        session={props.view}
                        index={tabs().all().indexOf(key)}
                        active={!props.launcher && props.group.active() === key}
                        preview={tabs().preview() === key}
                        onClose={props.region.close}
                        onPromote={(value) => void tabs().open(value)}
                      />
                    )}
                  </Show>
                )}
              </For>
              <Show when={props.launcher && props.group.entries().length > 0}>
                <Tabs.Trigger
                  value="launcher"
                  closeButton={
                    <Tabs.CloseButton
                      onClick={() => props.onLauncher(false)}
                      aria-label={language.t("workbench.launcher.close")}
                    />
                  }
                  hideCloseButton
                >
                  <span class="flex items-center gap-1.5">
                    <Icon name="grid-plus" size="small" />
                    <span>{language.t("workbench.launcher.tab")}</span>
                  </span>
                </Tabs.Trigger>
              </Show>
              <div class="h-full shrink-0 sticky end-0 z-10 flex items-center justify-center bg-v2-background-bg-base">
                <Tooltip value={language.t("workbench.launcher.open")} placement="bottom" class="flex items-center">
                  <IconButton
                    icon={<Icon name="plus" />}
                    variant="ghost-muted"
                    size="large"
                    aria-label={language.t("workbench.launcher.open")}
                    aria-pressed={props.launcher}
                    onClick={() => props.onLauncher(!props.launcher)}
                  />
                </Tooltip>
              </div>
            </Tabs.List>
            <div
              data-slot="session-side-panel-actions"
              class="session-review-v2-open-in-app-slot h-[var(--tabs-bar-height)] shrink-0 flex items-center gap-1 pe-2"
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => event.stopPropagation()}
            >
              <Show when={props.name === "top"}>
                <ExtensionSlot
                  at="session.panel.end"
                  input={{
                    get session() {
                      return props.view
                    },
                    get screen() {
                      return props.screen
                    },
                  }}
                />
              </Show>
              {props.actions}
            </div>
          </div>

          <div class="relative flex-1 min-h-0 overflow-hidden">
            <div class="size-full" classList={{ hidden: props.launcher }}>
              <RegionContent
                group={props.group}
                openFor={props.region.openFor}
                view={props.view}
                screen={props.screen}
                frame={{
                  shown: () => props.shown() && !props.launcher,
                  present: props.present,
                  placement: () => "side",
                  reserve: () => false,
                  animate: () => !props.size.active(),
                  sidebar: props.sidebar,
                }}
              />
            </div>
            <div
              ref={props.slot}
              data-slot="workbench-dock-slot"
              class="absolute inset-0"
              classList={{ hidden: props.launcher || !props.dockKey || props.group.active() !== props.dockKey }}
            />
            <Show when={props.launcher || props.group.active() === undefined}>
              <div class="absolute inset-0">
                <Launcher items={props.items} onRun={props.onLaunch} />
              </div>
            </Show>
          </div>
        </Tabs>
      </DragDropProvider>
    </section>
  )
}

function GroupAction(props: {
  icon: IconName
  label: string
  pressed?: boolean
  disabled?: boolean
  onClick: () => void
}): JSX.Element {
  return (
    <Tooltip value={props.label} placement="bottom" class="flex items-center">
      <IconButton
        icon={<Icon name={props.icon} />}
        variant="ghost-muted"
        size="large"
        aria-label={props.label}
        aria-pressed={props.pressed === undefined ? undefined : props.pressed}
        state={props.pressed ? "pressed" : undefined}
        disabled={props.disabled}
        onClick={() => props.onClick()}
      />
    </Tooltip>
  )
}

/** The DS split-view divider between the groups: drag it, or focus it and use the arrow keys. */
function GroupDivider(props: {
  ratio: number
  column: () => HTMLElement | undefined
  size: Sizing
  onResize: (ratio: number, height: number) => void
}): JSX.Element {
  const language = useLanguage()
  const [dragging, setDragging] = createSignal(false)

  const height = () => props.column()?.getBoundingClientRect().height ?? 0

  const step = (delta: number) => props.onResize(props.ratio + delta, height())

  return (
    <div
      role="separator"
      aria-orientation="horizontal"
      aria-label={language.t("workbench.resize")}
      aria-valuemin={Math.round(WORKBENCH_RATIO.min * 100)}
      aria-valuemax={Math.round(WORKBENCH_RATIO.max * 100)}
      aria-valuenow={Math.round(props.ratio * 100)}
      tabIndex={0}
      data-slot="workbench-divider"
      class={splitView({ orientation: "vertical", dragging: dragging() }).divider({ class: "my-0.5 mx-4 rounded-full" })}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId)
        setDragging(true)
        props.size.start()
      }}
      onPointerMove={(event) => {
        const column = props.column()

        if (!dragging() || !column) return
        const rect = column.getBoundingClientRect()
        props.size.touch()
        props.onResize((event.clientY - rect.top) / rect.height, rect.height)
      }}
      onPointerUp={() => setDragging(false)}
      onPointerCancel={() => setDragging(false)}
      onKeyDown={(event) => {
        if (event.key === "ArrowUp") step(-0.05)

        if (event.key === "ArrowDown") step(0.05)

        if (event.key === "Home") props.onResize(WORKBENCH_RATIO.min, height())

        if (event.key === "End") props.onResize(WORKBENCH_RATIO.max, height())

        if (["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) event.preventDefault()
      }}
    />
  )
}
