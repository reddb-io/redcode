import type { SessionInfo } from "@opencode/client/promise"
import { disclosure } from "@reddb-io/design-system/contracts/disclosure"
import { input } from "@reddb-io/design-system/contracts/input"
import { navItem } from "@reddb-io/design-system/contracts/nav-item"
import { quietControl } from "@reddb-io/design-system/contracts/quiet-control"
import { sidebarNavigation } from "@reddb-io/design-system/contracts/sidebar-navigation"
import { Icon } from "@opencode/ui/icon"
import { IconButton } from "@opencode/ui/icon-button"
import { Menu } from "@opencode/ui/menu"
import { ScrollView } from "@opencode/ui/scroll-view"
import { Tooltip } from "@opencode/ui/tooltip"
import { Key } from "@solid-primitives/keyed"
import { createEffect, createMemo, createSignal, For, type JSX, onCleanup, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { shouldOpenSessionInBackground } from "@/home/sessions/open"
import { fileManagerApp } from "@/home/projects/file-manager"
import { usePlatform } from "@/runtime/platform/platform"
import { sessionLabel } from "@/session/title"
import { ProjectTile } from "@/shell/layout/project-tile"
import type { LocalProject } from "@/shell/state/layout"
import type { NavigationController } from "./controller"
import {
  groupByDay,
  NAVIGATION_PROJECT_LIMIT,
  navigationAge,
  type NavigationDay,
  navigationElapsed,
  type NavigationSession,
  sessionAwaitsUser,
  type SessionStatus,
} from "./model"

const nav = sidebarNavigation()
const section = disclosure()
const EYEBROW = "text-eyebrow uppercase text-ink-muted"
const ROW_ACTION =
  "hover-reveal flex shrink-0 items-center gap-0.5 group-hover/row:opacity-100 focus-within:opacity-100"

type NavigationSessionItem = NavigationSession<LocalProject>

/**
 * The rail's sidemenu: a filter, pinned sessions, every open project with its newest sessions,
 * and a flat tail of recent work. Rows wear the DS navigation selection language.
 */
export function NavigationSidemenu(props: { navigation: NavigationController }) {
  const language = props.navigation.language
  const [menu, setMenu] = createStore({ open: undefined as string | undefined })
  const now = createNow(60_000)
  const tree = props.navigation.tree
  const empty = createMemo(
    () => tree().filtered && tree().pinned.length === 0 && tree().projects.length === 0 && tree().recents.length === 0,
  )
  let filter: HTMLInputElement | undefined

  return (
    <nav
      data-component="navigation-sidemenu"
      aria-label={language.t("sidebar.nav.projectsAndSessions")}
      class={nav.root({ class: "h-full min-h-0 border-0 bg-transparent shadow-none" })}
    >
      <div class="flex shrink-0 items-center gap-1 px-2 pb-2 pt-2">
        <label class="relative flex min-w-0 flex-1 items-center">
          <span class="sr-only">{language.t("navigation.filter.placeholder")}</span>
          <Icon name="magnifying-glass" size="small" class="pointer-events-none absolute start-2 text-ink-muted" />
          <input
            ref={filter}
            data-action="navigation-filter"
            type="search"
            autocomplete="off"
            spellcheck={false}
            value={props.navigation.filter.value()}
            placeholder={language.t("navigation.filter.placeholder")}
            class={input({ size: "sm", class: "ps-7 pe-7 bg-transparent [&::-webkit-search-cancel-button]:hidden" })}
            onInput={(event) => props.navigation.filter.set(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key !== "Escape" || !props.navigation.filter.value()) return
              event.preventDefault()
              event.stopPropagation()
              props.navigation.filter.clear()
            }}
          />
          <Show when={props.navigation.filter.value()}>
            <button
              type="button"
              class={quietControl({
                focus: "inset",
                class: "absolute end-1 flex size-5 items-center justify-center rounded-sm",
              })}
              aria-label={language.t("navigation.filter.clear")}
              onClick={() => {
                props.navigation.filter.clear()
                filter?.focus()
              }}
            >
              <Icon name="xmark-small" size="small" />
            </button>
          </Show>
        </label>
      </div>
      <ScrollView class="min-h-0 flex-1" data-slot="navigation-scroll">
        <div class="flex flex-col gap-3 px-2 pb-4">
          <Show when={empty()}>
            <p class="m-0 px-2 py-3 text-caption text-ink-muted">
              {language.t("navigation.filter.empty", { query: props.navigation.filter.value().trim() })}
            </p>
          </Show>
          <Show when={tree().pinned.length > 0}>
            <NavigationSection id="pinned" title={language.t("navigation.pinned")} navigation={props.navigation}>
              <ul class={nav.list({ class: "gap-px" })}>
                <Key each={tree().pinned} by={(item) => item.session.id}>
                  {(item) => (
                    <SessionRow
                      navigation={props.navigation}
                      item={item()}
                      now={now()}
                      menu={menu.open}
                      onMenu={(id) => setMenu("open", id)}
                    />
                  )}
                </Key>
              </ul>
            </NavigationSection>
          </Show>
          <Show when={!tree().filtered || tree().projects.length > 0}>
            <NavigationSection
              id="projects"
              title={language.t("home.projects")}
              navigation={props.navigation}
              action={
                <Tooltip placement="bottom" value={language.t("home.project.add")}>
                  <IconButton
                    data-action="navigation-add-project"
                    variant="ghost-muted"
                    size="small"
                    icon={<Icon name="folder-add-left" />}
                    aria-label={language.t("home.project.add")}
                    onClick={props.navigation.project.add}
                  />
                </Tooltip>
              }
            >
              <Show
                when={tree().projects.length > 0}
                fallback={
                  <button
                    type="button"
                    data-action="navigation-add-project-row"
                    class={quietControl({
                      focus: "inset",
                      class: navItem().root({ class: "text-start text-body" }),
                    })}
                    onClick={props.navigation.project.add}
                  >
                    <span class="flex size-4 items-center justify-center rounded-sm border border-dashed border-control-edge">
                      <Icon name="plus" size="small" />
                    </span>
                    <span class={navItem().label()}>{language.t("home.project.add")}</span>
                  </button>
                }
              >
                <ul class={nav.list({ class: "gap-1" })}>
                  <Key each={tree().projects} by={(project) => project.key}>
                    {(project) => (
                      <ProjectNode
                        navigation={props.navigation}
                        project={project()}
                        now={now()}
                        menu={menu.open}
                        onMenu={(id) => setMenu("open", id)}
                      />
                    )}
                  </Key>
                </ul>
              </Show>
            </NavigationSection>
          </Show>
          <Show when={tree().recents.length > 0}>
            <NavigationSection id="recents" title={language.t("navigation.recents")} navigation={props.navigation}>
              <div class="flex flex-col gap-2">
                <For
                  each={groupByDay(
                    tree().recents,
                    (item) => item.session.time.updated ?? item.session.time.created,
                    new Date(now()),
                  )}
                >
                  {(group) => (
                    <div role="group" aria-label={dayLabel(language, group.id)} class="flex flex-col">
                      <div class="flex h-6 items-center ps-2.5 text-caption text-ink-muted">
                        {dayLabel(language, group.id)}
                      </div>
                      <ul class={nav.list({ class: "gap-px" })}>
                        <Key each={group.items} by={(item) => item.session.id}>
                          {(item) => (
                            <SessionRow
                              navigation={props.navigation}
                              item={item()}
                              now={now()}
                              menu={menu.open}
                              onMenu={(id) => setMenu("open", id)}
                              idPrefix="recent:"
                            />
                          )}
                        </Key>
                      </ul>
                    </div>
                  )}
                </For>
              </div>
            </NavigationSection>
          </Show>
        </div>
      </ScrollView>
    </nav>
  )
}

function NavigationSection(props: {
  id: string
  title: string
  navigation: NavigationController
  action?: JSX.Element
  children: JSX.Element
}) {
  const open = () => props.navigation.filter.value().trim() !== "" || props.navigation.section.open(props.id)
  const contentID = `navigation-section-${props.id}`
  return (
    <section data-section={props.id} class="flex min-w-0 flex-col">
      <div class="group/section flex h-7 min-w-0 items-center gap-1">
        <h2 class="m-0 flex min-w-0 flex-1">
          <button
            type="button"
            class={quietControl({
              focus: "inset",
              class: section.trigger({ class: "flex h-6 min-w-0 flex-1 items-center gap-1 rounded-md ps-2 pe-1" }),
            })}
            aria-expanded={open()}
            aria-controls={contentID}
            onClick={() => props.navigation.section.toggle(props.id)}
          >
            <span class={`truncate ${EYEBROW}`}>{props.title}</span>
            <Icon
              name="chevron-down"
              size="small"
              class={section.indicator({
                class: `ms-0 group-hover/section:opacity-100 group-focus-visible:opacity-100 ${open() ? "opacity-0" : ""}`,
              })}
            />
          </button>
        </h2>
        <Show when={props.action}>
          <div class="flex shrink-0 items-center">{props.action}</div>
        </Show>
      </div>
      <div id={contentID} hidden={!open()} class="min-w-0">
        {props.children}
      </div>
    </section>
  )
}

function ProjectNode(props: {
  navigation: NavigationController
  project: ReturnType<NavigationController["tree"]>["projects"][number]
  now: number
  menu: string | undefined
  onMenu: (id: string | undefined) => void
}) {
  const language = props.navigation.language
  const platform = usePlatform()
  const actions = props.navigation.project.actions
  const unseen = () => props.navigation.project.unseen(props.project.project)
  const menuID = () => `project:${props.project.key}`
  const current = () => props.navigation.current.project() === props.project.key
  const listID = () => `navigation-project-${encodeURIComponent(props.project.key)}`
  const canReveal = () => {
    const conn = props.navigation.server()
    return !!conn && actions.canReveal(conn)
  }
  const run = (action: (conn: NonNullable<ReturnType<NavigationController["server"]>>) => void) => {
    const conn = props.navigation.server()
    if (conn) action(conn)
  }
  onCleanup(() => {
    if (props.menu === menuID()) props.onMenu(undefined)
  })
  return (
    <li data-project={props.project.key} class="flex min-w-0 flex-col">
      <div
        class="group/row relative flex min-w-0 items-center rounded-e-md"
        onContextMenu={(event) => {
          event.preventDefault()
          props.onMenu(menuID())
        }}
      >
        <button
          type="button"
          data-action="navigation-project"
          class={quietControl({
            ink: "foreground",
            focus: "inset",
            class: navItem().root({ class: "min-w-0 flex-1 gap-2 pe-16 text-start text-body" }),
          })}
          aria-expanded={props.project.expanded}
          aria-controls={listID()}
          onClick={() => props.navigation.project.toggle(props.project.key)}
        >
          <Icon
            name="chevron-down"
            size="small"
            class="-ms-0.5 shrink-0 text-ink-muted transition-transform motion-reduce:transition-none"
            style={{ transform: props.project.expanded ? undefined : "rotate(-90deg)" }}
          />
          <ProjectTile project={props.project.project} size="sm" />
          <bdi class={navItem().label({ class: current() ? "font-medium" : "" })}>{props.project.name}</bdi>
        </button>
        <Show when={props.project.status}>
          {(status) => (
            <span
              data-slot="navigation-project-status"
              class="pointer-events-none absolute inset-y-0 end-2 flex items-center group-hover/row:invisible group-focus-within/row:invisible"
              classList={{ invisible: props.menu === menuID() }}
            >
              <StatusMark status={status()} language={language} />
            </span>
          )}
        </Show>
        <div
          class={`${ROW_ACTION} absolute inset-y-0 end-1 data-[menu=true]:opacity-100`}
          data-menu={props.menu === menuID()}
        >
          <Menu
            gutter={4}
            modal={false}
            placement="bottom-end"
            open={props.menu === menuID()}
            onOpenChange={(open) => props.onMenu(open ? menuID() : undefined)}
          >
            <Menu.Trigger
              as={IconButton}
              data-action="navigation-project-menu"
              variant="ghost-muted"
              size="small"
              icon={<Icon name="outline-dots" />}
              aria-label={language.t("common.moreOptions")}
            />
            <Menu.Portal>
              <Menu.Content>
                <Menu.Item onSelect={() => props.navigation.project.newSession(props.project.project)}>
                  {language.t("command.session.new")}
                </Menu.Item>
                <Show when={actions.canImportSession}>
                  <Menu.Item onSelect={() => run((conn) => actions.importSession(conn, props.project.project))}>
                    {language.t("command.session.import")}
                  </Menu.Item>
                </Show>
                <Menu.Item onSelect={() => run((conn) => actions.edit(conn, props.project.project))}>
                  {language.t("dialog.project.edit.title")}
                </Menu.Item>
                <Show when={canReveal()}>
                  <Menu.Item onSelect={() => run((conn) => actions.reveal(conn, props.project.project))}>
                    {language.t(
                      fileManagerApp(platform.platform === "desktop" ? (platform.os ?? "unknown") : "unknown")
                        .actionLabel,
                    )}
                  </Menu.Item>
                </Show>
                <Menu.Item
                  disabled={unseen() === 0}
                  onSelect={() => run((conn) => actions.clearNotifications(conn, props.project.project))}
                >
                  {language.t("sidebar.project.clearNotifications")}
                </Menu.Item>
                <Menu.Separator />
                <Menu.Item onSelect={() => run((conn) => actions.close(conn, props.project.project.worktree))}>
                  {language.t("common.close")}
                </Menu.Item>
              </Menu.Content>
            </Menu.Portal>
          </Menu>
          <Tooltip placement="bottom" value={language.t("command.session.new")}>
            <IconButton
              data-action="navigation-project-new-session"
              variant="ghost-muted"
              size="small"
              icon={<Icon name="plus" />}
              aria-label={language.t("navigation.project.newSession", { project: props.project.name })}
              onClick={() => props.navigation.project.newSession(props.project.project)}
            />
          </Tooltip>
        </div>
      </div>
      <Show when={props.project.expanded}>
        <ul id={listID()} class={nav.list({ class: "gap-px" })}>
          <Key each={props.project.sessions} by={(item) => item.session.id}>
            {(item) => (
              <SessionRow
                navigation={props.navigation}
                item={item()}
                now={props.now}
                menu={props.menu}
                onMenu={props.onMenu}
                nested
              />
            )}
          </Key>
          <Show when={props.project.total === 0}>
            <li class="flex h-7 items-center ps-[calc(var(--reddb-spatial-inset-sm)+2.875rem)] text-caption text-ink-muted">
              {language.t("navigation.project.empty")}
            </li>
          </Show>
          <Show
            when={
              props.project.hidden > 0 ||
              (props.navigation.project.showingAll(props.project.key) && props.project.total > NAVIGATION_PROJECT_LIMIT)
            }
          >
            <li>
              <button
                type="button"
                data-action="navigation-show-more"
                class={quietControl({
                  focus: "inset",
                  class:
                    "flex h-7 w-full items-center gap-2 rounded-e-md ps-[calc(var(--reddb-spatial-inset-sm)+2.875rem)] pe-2 text-caption",
                })}
                onClick={() => props.navigation.project.showAll(props.project.key, props.project.hidden > 0)}
              >
                <span>{language.t(props.project.hidden > 0 ? "navigation.showMore" : "navigation.showLess")}</span>
                <Show when={props.project.hidden > 0}>
                  <span class="tabular-nums">{props.project.hidden}</span>
                </Show>
              </button>
            </li>
          </Show>
        </ul>
      </Show>
    </li>
  )
}

function SessionRow(props: {
  navigation: NavigationController
  item: NavigationSessionItem
  now: number
  menu: string | undefined
  onMenu: (id: string | undefined) => void
  nested?: boolean
  idPrefix?: string
}) {
  const language = props.navigation.language
  const id = () => props.item.session.id
  const menuID = () => `${props.idPrefix ?? ""}session:${id()}`
  const current = () => props.navigation.current.session() === id()
  const status = () => props.navigation.session.status(id())
  const since = () => (status() === "working" ? props.navigation.session.since(id()) : undefined)
  const unread = () => props.navigation.session.unread(id())
  const pinned = () => props.navigation.session.pinned(id())
  const title = () => sessionLabel(props.item.session)
  const age = () =>
    formatAge(language, props.now - (props.item.session.time.updated ?? props.item.session.time.created))
  onCleanup(() => {
    if (props.menu === menuID()) props.onMenu(undefined)
  })
  const open = (session: SessionInfo, event: MouseEvent) => {
    const background = shouldOpenSessionInBackground({
      button: event.button,
      mac: typeof navigator === "object" && /(Mac|iPod|iPhone|iPad)/.test(navigator.platform),
      meta: event.metaKey,
      ctrl: event.ctrlKey,
      shift: event.shiftKey,
      alt: event.altKey,
    })
    props.navigation.session.open(session, { background })
  }
  return (
    <li
      class="group/row relative flex min-w-0 items-center"
      onContextMenu={(event) => {
        event.preventDefault()
        props.onMenu(menuID())
      }}
    >
      <button
        type="button"
        data-action="navigation-session"
        data-session={id()}
        class={quietControl({
          selected: current(),
          focus: "inset",
          class: navItem({ current: current() }).root({
            // Nested rows put their status under the project tile and their title under its name. A row
            // waiting on the user keeps full ink; idle and seen rows stay quiet.
            class: `min-w-0 flex-1 gap-2 pe-2 text-start text-body ${props.nested ? "ps-[calc(var(--reddb-spatial-inset-sm)+1.25rem)]" : ""} ${sessionAwaitsUser(status()) ? "text-foreground" : ""}`,
          }),
        })}
        aria-current={current() ? "page" : undefined}
        onClick={(event) => open(props.item.session, event)}
        onAuxClick={(event) => {
          if (event.button !== 1) return
          event.preventDefault()
          open(props.item.session, event)
        }}
      >
        <span class="flex size-4 shrink-0 items-center justify-center">
          {/* Nested rows show only their status; flat rows trade the project tile for it. */}
          <Show
            when={status()}
            fallback={
              <Show when={!props.nested}>
                <ProjectTile
                  project={props.item.project ?? { worktree: props.item.session.location.directory }}
                  size="sm"
                />
              </Show>
            }
          >
            {(value) => <StatusMark status={value()} language={language} />}
          </Show>
        </span>
        <span dir="auto" class={navItem().label({ class: "min-w-0 flex-1" })}>
          {title()}
        </span>
        <span
          class="shrink-0 text-caption tabular-nums text-ink-muted group-hover/row:invisible group-focus-within/row:invisible"
          classList={{ invisible: props.menu === menuID() }}
        >
          <Show when={since()} fallback={age()}>
            {(start) => <Elapsed since={start()} language={language} />}
          </Show>
        </span>
      </button>
      <div
        class={`${ROW_ACTION} absolute inset-y-0 end-1 data-[menu=true]:opacity-100`}
        data-menu={props.menu === menuID()}
      >
        <Menu
          gutter={4}
          modal={false}
          placement="bottom-end"
          open={props.menu === menuID()}
          onOpenChange={(open) => props.onMenu(open ? menuID() : undefined)}
        >
          <Menu.Trigger
            as={IconButton}
            data-action="navigation-session-menu"
            variant="ghost-muted"
            size="small"
            icon={<Icon name="outline-dots" />}
            aria-label={language.t("common.moreOptions")}
          />
          <Menu.Portal>
            <Menu.Content>
              <Menu.Item onSelect={() => props.navigation.session.togglePin(id())}>
                {language.t(pinned() ? "navigation.session.unpin" : "navigation.session.pin")}
              </Menu.Item>
              <Menu.Item disabled={!unread()} onSelect={() => props.navigation.session.markRead(id())}>
                {language.t("navigation.session.markRead")}
              </Menu.Item>
              <Menu.Item onSelect={() => props.navigation.session.open(props.item.session, { background: true })}>
                {language.t("navigation.session.openBackground")}
              </Menu.Item>
            </Menu.Content>
          </Menu.Portal>
        </Menu>
      </div>
    </li>
  )
}

// Each status paints its own theme role; the live one pulses unless the user reduces motion.
const STATUS_MARK: Record<SessionStatus, string> = {
  approval: "bg-v2-status-attention",
  input: "bg-v2-status-attention",
  working: "bg-v2-status-working motion-safe:animate-pulse",
  queued: "border border-v2-status-queued",
  failed: "bg-v2-status-failed",
  done: "bg-v2-status-done",
}

function StatusMark(props: { status: SessionStatus; language: NavigationController["language"] }) {
  const label = () => props.language.t(`navigation.status.${props.status}`)
  return (
    <span data-status={props.status} class="flex size-4 items-center justify-center" title={label()}>
      <span class={`size-2 shrink-0 rounded-full ${STATUS_MARK[props.status]}`} aria-hidden="true" />
      <span class="sr-only">{label()}</span>
    </span>
  )
}

/** A live execution's elapsed time, ticking each second while it is shown. */
function Elapsed(props: { since: number; language: NavigationController["language"] }) {
  const now = createNow(1000)
  const text = () => {
    const elapsed = navigationElapsed(now() - props.since)
    const number = new Intl.NumberFormat(props.language.intl())
    if (elapsed.unit === "second")
      return props.language.t("navigation.elapsed.seconds", { seconds: number.format(elapsed.seconds) })
    if (elapsed.unit === "minute")
      return props.language.t("navigation.elapsed.minutes", { minutes: number.format(elapsed.minutes) })
    return props.language.t("navigation.elapsed.hoursMinutes", {
      hours: number.format(elapsed.hours),
      minutes: number.format(elapsed.minutes),
    })
  }
  return <>{text()}</>
}

/** A clock that ticks every `interval` milliseconds while its owner lives. */
function createNow(interval: number) {
  const [now, setNow] = createSignal(Date.now())
  createEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), interval)
    onCleanup(() => clearInterval(timer))
  })
  return now
}

function formatAge(language: NavigationController["language"], elapsed: number) {
  const age = navigationAge(elapsed)
  if (!age) return language.t("navigation.time.now")
  return new Intl.NumberFormat(language.intl(), { style: "unit", unit: age.unit, unitDisplay: "narrow" }).format(
    age.value,
  )
}

function dayLabel(language: NavigationController["language"], day: NavigationDay) {
  const keys = {
    today: "home.sessions.group.today",
    yesterday: "home.sessions.group.yesterday",
    week: "home.sessions.group.week",
    older: "home.sessions.group.older",
  } as const
  return language.t(keys[day])
}
