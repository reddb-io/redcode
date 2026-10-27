/** @jsxImportSource react */
import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react"
import { Button } from "@reddb-io/design-system/base/Button"
import { Input } from "@reddb-io/design-system/base/Input"
import { DropdownMenu } from "@reddb-io/design-system/base/DropdownMenu"
import { ScrollArea } from "@reddb-io/design-system/base/ScrollArea"
import { Tooltip } from "@reddb-io/design-system/base/Tooltip"
import { disclosure, quietControl } from "@reddb-io/design-system/base/recipes"
import { sidebarNavigation, navItem } from "@reddb-io/design-system/app/recipes"
import { Icon } from "@/runtime/react/icon.react"
import type { SharedLanguage } from "@/runtime/react/language"
import { shouldOpenSessionInBackground } from "@/home/sessions/open"
import { sessionLabel } from "@/session/title"
import { getFilename } from "@opencode/util/path"
import { ProjectTile } from "@/shell/layout/project-tile.react"
import type { NavigationController } from "./controller"
import type { NavigationView } from "./view"
import {
  groupByDay,
  NAVIGATION_PROJECT_LIMIT,
  navigationAge,
  navigationElapsed,
  sessionAwaitsUser,
  type NavigationDay,
  type SessionStatus,
} from "./model"

const nav = sidebarNavigation()
const section = disclosure()
const EYEBROW = "text-eyebrow uppercase text-ink-muted"
const ROW_ACTION =
  "hover-reveal flex shrink-0 items-center gap-0.5 group-hover/row:opacity-100 focus-within:opacity-100"

type NavigationProps = { view: NavigationView; navigation: NavigationController }
type RowProps = NavigationProps & { now: number; menu: string | undefined; onMenu: (id: string | undefined) => void }

export function NavigationSidemenu(props: NavigationProps) {
  const view = props.view
  const language = view.language
  const [menu, setMenu] = useState<string>()
  const now = useNow(60_000)
  const tree = view.tree
  const empty =
    tree.filtered && !tree.pinned.length && !tree.projects.length && !tree.recents.length && !tree.activity.length
  const filter = useRef<HTMLInputElement>(null)
  const rows = { ...props, now, menu, onMenu: setMenu }
  // A filtered, collapsed or removed row must not retain the controlled menu selection.
  useEffect(() => {
    if (!menu) return
    const ids = [
      ...tree.pinned.map((item) => `session:${item.session.id}`),
      ...tree.projects.flatMap((item) => [
        `project:${item.key}`,
        ...(item.expanded ? item.sessions.map((item) => `session:${item.session.id}`) : []),
      ]),
      ...tree.recents.map((item) => `recent:session:${item.session.id}`),
      ...tree.activity.flatMap((group) => group.items.map((item) => `activity:session:${item.session.id}`)),
    ]
    if (!ids.includes(menu)) setMenu(undefined)
  }, [tree, menu])
  return (
    <nav
      data-component="navigation-sidemenu"
      aria-label={language.t("sidebar.nav.projectsAndSessions")}
      className={nav.root({ class: "h-full min-h-0 border-0 bg-transparent shadow-none" })}
    >
      <div className="flex shrink-0 items-center gap-1 px-2 pb-2 pt-2">
        <label className="relative flex min-w-0 flex-1 items-center">
          <span className="sr-only">{language.t("navigation.filter.placeholder")}</span>
          <Icon name="magnifying-glass" size="small" className="pointer-events-none absolute start-2 text-ink-muted" />
          <Input
            ref={filter}
            data-action="navigation-filter"
            type="search"
            autoComplete="off"
            spellCheck={false}
            controlSize="sm"
            value={view.query}
            placeholder={language.t("navigation.filter.placeholder")}
            className="ps-7 pe-7 bg-transparent [&::-webkit-search-cancel-button]:hidden"
            onValueChange={props.navigation.filter.set}
            onKeyDown={(event) => {
              if (event.key !== "Escape" || !view.query) return
              event.preventDefault()
              event.stopPropagation()
              props.navigation.filter.clear()
            }}
          />
          {view.query && (
            <button
              type="button"
              className={quietControl({
                focus: "inset",
                class: "absolute end-1 flex size-5 items-center justify-center rounded-sm",
              })}
              aria-label={language.t("navigation.filter.clear")}
              onClick={() => {
                props.navigation.filter.clear()
                filter.current?.focus()
              }}
            >
              <Icon name="xmark-small" size="small" />
            </button>
          )}
        </label>
      </div>
      <div
        role="group"
        aria-label={language.t("navigation.grouping")}
        className="mx-2 mb-2 flex rounded-md bg-muted p-0.5"
      >
        {(["attention", "projects"] as const).map((mode) => (
          <Button
            key={mode}
            size="sm"
            variant="ghost"
            aria-pressed={tree.grouping === mode}
            onClick={() => props.navigation.grouping.set(mode)}
            className={`min-w-0 flex-1 ${tree.grouping === mode ? "bg-elevation-raised-surface font-medium" : "text-ink-muted"}`}
          >
            {language.t(mode === "attention" ? "navigation.byAttention" : "navigation.byProject")}
          </Button>
        ))}
      </div>
      <ScrollArea
        variant="plain"
        label={language.t("sidebar.nav.projectsAndSessions")}
        className="min-h-0 flex-1"
        data-slot="navigation-scroll"
      >
        <div className="flex flex-col gap-[var(--reddb-spatial-layout-gap-sm)] px-2 pb-4">
          {empty && (
            <p className="m-0 px-2 py-3 text-caption text-ink-muted">
              {language.t("navigation.filter.empty", { query: view.query.trim() })}
            </p>
          )}
          {tree.pinned.length > 0 && (
            <NavigationSection {...props} id="pinned" title={language.t("navigation.pinned")}>
              <ul className={nav.list({ class: "gap-px" })}>
                {tree.pinned.map((item) => (
                  <SessionRow key={item.session.id} {...rows} item={item} />
                ))}
              </ul>
            </NavigationSection>
          )}
          {tree.grouping === "attention" &&
            tree.activity.map((group) => (
              <NavigationSection {...props} key={group.id} id={group.id} title={language.t(`navigation.${group.id}`)}>
                <ul className={nav.list({ class: "gap-1" })}>
                  {group.items.map((item) => (
                    <SessionRow key={item.session.id} {...rows} item={item} idPrefix="activity:" />
                  ))}
                </ul>
              </NavigationSection>
            ))}
          {tree.grouping === "projects" && (!tree.filtered || tree.projects.length > 0) && (
            <NavigationSection
              {...props}
              id="projects"
              title={language.t("home.projects")}
              action={
                <Tooltip
                  label={language.t("home.project.add")}
                  content={language.t("home.project.add")}
                  child={({ props: trigger }) => (
                    <Button
                      {...trigger}
                      data-action="navigation-add-project"
                      variant="ghost"
                      size="sm"
                      aria-label={language.t("home.project.add")}
                      onClick={props.navigation.project.add}
                    >
                      <Icon name="folder-add-left" />
                    </Button>
                  )}
                />
              }
            >
              {tree.projects.length > 0 ? (
                <ul className={nav.list({ class: "gap-1" })}>
                  {tree.projects.map((project) => (
                    <ProjectNode key={project.key} {...rows} project={project} />
                  ))}
                </ul>
              ) : (
                <button
                  type="button"
                  data-action="navigation-add-project-row"
                  className={quietControl({ focus: "inset", class: navItem().root({ class: "text-start text-body" }) })}
                  onClick={props.navigation.project.add}
                >
                  <span className="flex size-4 items-center justify-center rounded-sm border border-dashed border-control-edge">
                    <Icon name="plus" size="small" />
                  </span>
                  <span className={navItem().label()}>{language.t("home.project.add")}</span>
                </button>
              )}
            </NavigationSection>
          )}
          {tree.grouping === "projects" && tree.recents.length > 0 && (
            <NavigationSection {...props} id="recents" title={language.t("navigation.recents")}>
              <div className="flex flex-col gap-2">
                {groupByDay(
                  tree.recents,
                  (item) => item.session.time.updated ?? item.session.time.created,
                  new Date(now),
                ).map((group) => (
                  <div key={group.id} role="group" aria-label={dayLabel(language, group.id)} className="flex flex-col">
                    <div className="flex h-6 items-center ps-2.5 text-caption text-ink-muted">
                      {dayLabel(language, group.id)}
                    </div>
                    <ul className={nav.list({ class: "gap-px" })}>
                      {group.items.map((item) => (
                        <SessionRow key={item.session.id} {...rows} item={item} idPrefix="recent:" />
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </NavigationSection>
          )}
        </div>
      </ScrollArea>
    </nav>
  )
}

function NavigationSection(
  props: NavigationProps & { id: string; title: string; action?: ReactNode; children: ReactNode },
) {
  const open = props.view.query.trim() !== "" || props.view.sections[props.id]
  const contentID = `navigation-section-${props.id}`
  return (
    <section data-section={props.id} className="flex min-w-0 flex-col">
      <div className="group/section flex h-7 min-w-0 items-center gap-1">
        <h2 className="m-0 flex min-w-0 flex-1">
          <button
            type="button"
            className={quietControl({
              focus: "inset",
              class: section.trigger({ class: "flex h-6 min-w-0 flex-1 items-center gap-1 rounded-md ps-2 pe-1" }),
            })}
            aria-expanded={open}
            aria-controls={contentID}
            onClick={() => props.navigation.section.toggle(props.id)}
          >
            <span className={`truncate ${EYEBROW}`}>{props.title}</span>
            <Icon
              name="chevron-down"
              size="small"
              className={section.indicator({
                class: `ms-0 group-hover/section:opacity-100 group-focus-visible:opacity-100 ${open ? "opacity-0" : ""}`,
              })}
            />
          </button>
        </h2>
        {props.action && <div className="flex shrink-0 items-center">{props.action}</div>}
      </div>
      <div id={contentID} hidden={!open} className="min-w-0">
        {props.children}
      </div>
    </section>
  )
}

function ProjectNode(props: RowProps & { project: NavigationView["tree"]["projects"][number] }) {
  const view = props.view
  const language = view.language
  const actions = props.navigation.project.actions
  const menuID = `project:${props.project.key}`
  const listID = `navigation-project-${encodeURIComponent(props.project.key)}`
  const run = (action: (conn: NonNullable<NavigationView["server"]>) => void) => {
    if (view.server) action(view.server)
  }
  return (
    <li data-project={props.project.key} className="flex min-w-0 flex-col">
      <div
        className="group/row relative flex min-w-0 items-center rounded-e-md"
        onContextMenu={(event) => {
          event.preventDefault()
          props.onMenu(menuID)
        }}
      >
        <button
          type="button"
          data-action="navigation-project"
          className={quietControl({
            ink: "foreground",
            focus: "inset",
            class: navItem().root({ class: "min-w-0 flex-1 gap-2 pe-16 text-start text-body" }),
          })}
          aria-expanded={props.project.expanded}
          aria-controls={listID}
          onClick={() => props.navigation.project.toggle(props.project.key)}
        >
          <Icon
            name="chevron-down"
            size="small"
            className="-ms-0.5 shrink-0 text-ink-muted transition-transform motion-reduce:transition-none"
            style={{ transform: props.project.expanded ? undefined : "rotate(-90deg)" }}
          />
          <ProjectTile project={props.project.project} size="sm" />
          <bdi className={navItem().label({ class: view.current.project === props.project.key ? "font-medium" : "" })}>
            {props.project.name}
          </bdi>
        </button>
        {props.project.status && (
          <span
            data-slot="navigation-project-status"
            className={`pointer-events-none absolute inset-y-0 end-2 flex items-center group-hover/row:invisible group-focus-within/row:invisible ${props.menu === menuID ? "invisible" : ""}`}
          >
            <StatusMark status={props.project.status} language={language} />
          </span>
        )}
        <div
          className={`${ROW_ACTION} absolute inset-y-0 end-1 data-[menu=true]:opacity-100`}
          data-menu={props.menu === menuID}
        >
          <span data-action="navigation-project-menu" className="inline-flex">
            <DropdownMenu
              triggerLabel={language.t("common.moreOptions")}
              contentLabel={language.t("common.moreOptions")}
              variant="ghost"
              size="sm"
              align="end"
              trigger={<Icon name="outline-dots" />}
              open={props.menu === menuID}
              onOpenChange={(open) => props.onMenu(open ? menuID : undefined)}
              items={[
                {
                  items: [
                    {
                      id: "new",
                      label: language.t("command.session.new"),
                      onselect: () => props.navigation.project.newSession(props.project.project),
                    },
                    ...(actions.canImportSession
                      ? [
                          {
                            id: "import",
                            label: language.t("command.session.import"),
                            onselect: () => run((conn) => actions.importSession(conn, props.project.project)),
                          },
                        ]
                      : []),
                    ...view.contributions.map((item) => ({
                      id: `extension:${item.id}`,
                      label: item.title,
                      onselect: () => {
                        if (view.serverKey) item.run(view.serverKey, props.project.project.worktree)
                      },
                    })),
                    {
                      id: "edit",
                      label: language.t("dialog.project.edit.title"),
                      onselect: () => run((conn) => actions.edit(conn, props.project.project)),
                    },
                    ...(view.canReveal
                      ? [
                          {
                            id: "reveal",
                            label: view.revealLabel,
                            onselect: () => run((conn) => actions.reveal(conn, props.project.project)),
                          },
                        ]
                      : []),
                    {
                      id: "clear",
                      label: language.t("sidebar.project.clearNotifications"),
                      disabled: !view.projects[props.project.key]?.unseen,
                      onselect: () => run((conn) => actions.clearNotifications(conn, props.project.project)),
                    },
                  ],
                },
                {
                  items: [
                    {
                      id: "close",
                      label: language.t("common.close"),
                      onselect: () => run((conn) => actions.close(conn, props.project.project.worktree)),
                    },
                  ],
                },
              ]}
            />
          </span>
          <Tooltip
            label={language.t("command.session.new")}
            content={language.t("command.session.new")}
            child={({ props: trigger }) => (
              <Button
                {...trigger}
                data-action="navigation-project-new-session"
                variant="ghost"
                size="sm"
                aria-label={language.t("navigation.project.newSession", { project: props.project.name })}
                onClick={() => props.navigation.project.newSession(props.project.project)}
              >
                <Icon name="plus" />
              </Button>
            )}
          />
        </div>
      </div>
      {props.project.expanded && (
        <ul id={listID} className={nav.list({ class: "gap-px" })}>
          {props.project.sessions.map((item) => (
            <SessionRow key={item.session.id} {...props} item={item} nested />
          ))}
          {props.project.total === 0 && (
            <li className="flex h-7 items-center ps-[calc(var(--reddb-spatial-inset-sm)+2.875rem)] text-caption text-ink-muted">
              {language.t("navigation.project.empty")}
            </li>
          )}
          {(props.project.hidden > 0 ||
            (view.projects[props.project.key]?.showingAll && props.project.total > NAVIGATION_PROJECT_LIMIT)) && (
            <li>
              <button
                type="button"
                data-action="navigation-show-more"
                className={quietControl({
                  focus: "inset",
                  class:
                    "flex h-7 w-full items-center gap-2 rounded-e-md ps-[calc(var(--reddb-spatial-inset-sm)+2.875rem)] pe-2 text-caption",
                })}
                onClick={() => props.navigation.project.showAll(props.project.key, props.project.hidden > 0)}
              >
                <span>{language.t(props.project.hidden > 0 ? "navigation.showMore" : "navigation.showLess")}</span>
                {props.project.hidden > 0 && <span className="tabular-nums">{props.project.hidden}</span>}
              </button>
            </li>
          )}
        </ul>
      )}
    </li>
  )
}

function SessionRow(
  props: RowProps & {
    item: NavigationView["tree"]["recents"][number]
    nested?: boolean
    idPrefix?: string
  },
) {
  const language = props.view.language
  const id = props.item.session.id
  const menuID = `${props.idPrefix ?? ""}session:${id}`
  const current = props.view.current.session === id
  const state = props.view.sessions[id]
  const vcs = state.vcs
  const branch = vcs?.branch.current ?? (vcs?.repository ? language.t("navigation.branch.detached") : undefined)
  const worktree = vcs?.worktree
    ? vcs.worktree.main
      ? language.t("navigation.worktree.main")
      : getFilename(vcs.worktree.directory)
    : undefined
  const since = state.status === "working" ? state.since : undefined
  const open = (event: MouseEvent) =>
    props.navigation.session.open(props.item.session, {
      background: shouldOpenSessionInBackground({
        button: event.button,
        mac: /(Mac|iPod|iPhone|iPad)/.test(navigator.platform),
        meta: event.metaKey,
        ctrl: event.ctrlKey,
        shift: event.shiftKey,
        alt: event.altKey,
      }),
    })
  return (
    <li
      className="group/row relative flex min-w-0 items-center"
      onContextMenu={(event) => {
        event.preventDefault()
        props.onMenu(menuID)
      }}
    >
      <button
        type="button"
        data-action="navigation-session"
        data-session={id}
        title={[
          vcs?.repository && language.t("navigation.session.repository", { name: vcs.repository.name }),
          branch && language.t("navigation.session.branch", { name: branch }),
          vcs?.worktree && language.t("navigation.session.worktree", { directory: vcs.worktree.directory }),
          language.t("navigation.session.directory", { directory: props.item.session.location.directory }),
        ]
          .filter(Boolean)
          .join("\n")}
        aria-current={current ? "page" : undefined}
        className={quietControl({
          selected: current,
          focus: "inset",
          class: navItem({ current }).root({
            class: `h-auto min-h-10 min-w-0 flex-1 items-start gap-2 py-[var(--reddb-spatial-gap-md)] pe-2 text-start text-body ${props.nested ? "ps-[calc(var(--reddb-spatial-inset-sm)+1.25rem)]" : ""} ${sessionAwaitsUser(state.status) ? "text-foreground" : ""}`,
          }),
        })}
        onClick={open}
        onAuxClick={(event) => {
          if (event.button !== 1) return
          event.preventDefault()
          open(event)
        }}
      >
        <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center">
          {state.status ? (
            <StatusMark status={state.status} language={language} />
          ) : (
            !props.nested && (
              <ProjectTile
                project={props.item.project ?? { worktree: props.item.session.location.directory }}
                size="sm"
              />
            )
          )}
        </span>
        <span dir="auto" className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex min-w-0 items-center gap-2">
            <span className={navItem().label({ class: "min-w-0 flex-1 font-medium" })}>
              {sessionLabel(props.item.session)}
            </span>
            <span
              className={`shrink-0 text-caption tabular-nums text-ink-muted group-hover/row:invisible group-focus-within/row:invisible ${props.menu === menuID ? "invisible" : ""}`}
            >
              {since ? (
                <Elapsed since={since} language={language} />
              ) : (
                formatAge(language, props.now - (props.item.session.time.updated ?? props.item.session.time.created))
              )}
            </span>
          </span>
          {(vcs?.repository || branch) && (
            <span className="flex min-w-0 items-center gap-1.5 text-caption text-ink-muted">
              {vcs?.repository && <span className="min-w-0 flex-1 truncate">{vcs.repository.name}</span>}
              {branch && (
                <span className="flex min-w-0 max-w-[55%] items-center gap-1">
                  <Icon name="branch" size="small" className="size-3 shrink-0" />
                  <span className="truncate">{branch}</span>
                </span>
              )}
            </span>
          )}
          <span className="flex min-w-0 items-center gap-1 text-caption text-ink-muted">
            {worktree && (
              <>
                <Icon name="outline-worktree" size="small" className="size-3 shrink-0" />
                <span className="max-w-[40%] shrink-0 truncate">{worktree}</span>
                <span aria-hidden="true">·</span>
              </>
            )}
            <span className="min-w-0 truncate" dir="auto">
              {props.item.session.location.directory}
            </span>
          </span>
        </span>
      </button>
      <div
        className={`${ROW_ACTION} absolute inset-y-0 end-1 data-[menu=true]:opacity-100`}
        data-menu={props.menu === menuID}
      >
        <span data-action="navigation-session-menu" className="inline-flex">
          <DropdownMenu
            triggerLabel={language.t("common.moreOptions")}
            contentLabel={language.t("common.moreOptions")}
            variant="ghost"
            size="sm"
            align="end"
            trigger={<Icon name="outline-dots" />}
            open={props.menu === menuID}
            onOpenChange={(open) => props.onMenu(open ? menuID : undefined)}
            items={[
              {
                id: "pin",
                label: language.t(state.pinned ? "navigation.session.unpin" : "navigation.session.pin"),
                onselect: () => props.navigation.session.togglePin(id),
              },
              {
                id: "read",
                label: language.t("navigation.session.markRead"),
                disabled: !state.unread,
                onselect: () => props.navigation.session.markRead(id),
              },
              {
                id: "background",
                label: language.t("navigation.session.openBackground"),
                onselect: () => props.navigation.session.open(props.item.session, { background: true }),
              },
            ]}
          />
        </span>
      </div>
    </li>
  )
}

const STATUS_MARK: Record<SessionStatus, string> = {
  approval: "bg-v2-status-attention",
  input: "bg-v2-status-attention",
  working: "bg-v2-status-working motion-safe:animate-pulse",
  queued: "border border-v2-status-queued",
  failed: "bg-v2-status-failed",
  done: "bg-v2-status-done",
}

function StatusMark(props: { status: SessionStatus; language: SharedLanguage }) {
  const label = props.language.t(`navigation.status.${props.status}`)
  return (
    <span data-status={props.status} className="flex size-4 items-center justify-center" title={label}>
      <span className={`size-2 shrink-0 rounded-full ${STATUS_MARK[props.status]}`} aria-hidden="true" />
      <span className="sr-only">{label}</span>
    </span>
  )
}

function Elapsed(props: { since: number; language: SharedLanguage }) {
  const now = useNow(1000)
  const elapsed = navigationElapsed(now - props.since)
  const number = new Intl.NumberFormat(props.language.intl)
  if (elapsed.unit === "second")
    return props.language.t("navigation.elapsed.seconds", { seconds: number.format(elapsed.seconds) })
  if (elapsed.unit === "minute")
    return props.language.t("navigation.elapsed.minutes", { minutes: number.format(elapsed.minutes) })
  return props.language.t("navigation.elapsed.hoursMinutes", {
    hours: number.format(elapsed.hours),
    minutes: number.format(elapsed.minutes),
  })
}

function useNow(interval: number) {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), interval)
    return () => clearInterval(timer)
  }, [interval])
  return now
}

function formatAge(language: SharedLanguage, elapsed: number) {
  const age = navigationAge(elapsed)
  if (!age) return language.t("navigation.time.now")
  return new Intl.NumberFormat(language.intl, { style: "unit", unit: age.unit, unitDisplay: "narrow" }).format(
    age.value,
  )
}

function dayLabel(language: SharedLanguage, day: NavigationDay) {
  const keys = {
    today: "home.sessions.group.today",
    yesterday: "home.sessions.group.yesterday",
    week: "home.sessions.group.week",
    older: "home.sessions.group.older",
  } as const
  return language.t(keys[day])
}
