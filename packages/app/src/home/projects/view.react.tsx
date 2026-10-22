/** @jsxImportSource react */
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ComponentPropsWithRef } from "react"
import { DragDropManager, AutoScroller, Feedback, PointerSensor, PointerActivationConstraints } from "@dnd-kit/dom"
import { isSortable, Sortable } from "@dnd-kit/dom/sortable"
import { RestrictToVerticalAxis } from "@dnd-kit/abstract/modifiers"
import { RestrictToElement } from "@dnd-kit/dom/modifiers"
import { Button } from "@reddb-io/design-system/base/Button"
import { DropdownMenu, type DropdownMenuEntry } from "@reddb-io/design-system/base/DropdownMenu"
import { Popover } from "@reddb-io/design-system/base/Popover"
import { ScrollArea } from "@reddb-io/design-system/base/ScrollArea"
import { LoadingIndicator } from "@reddb-io/design-system/base/LoadingIndicator"
import { Tooltip } from "@reddb-io/design-system/base/Tooltip"
import { navItem } from "@reddb-io/design-system/app/recipes"
import { quietControl } from "@reddb-io/design-system/base/recipes"
import { Icon } from "@/runtime/react/icon.react"
import { ProjectTile } from "@/shell/layout/project-tile.react"
import type { createHomeProjectsViewServices } from "./view"

type Services = ReturnType<typeof createHomeProjectsViewServices>
type View = ReturnType<Services["snapshot"]["getSnapshot"]>
type Server = View["servers"][number]
type Project = Server["projects"][number]
type PanelProps = { view: View; services: Services; close: () => void }

export function HomeProjectsNativeView(props: { services: Services }) {
  const view = useSyncExternalStore(props.services.snapshot.subscribe, props.services.snapshot.getSnapshot)
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const server = view.servers.find((server) => server.key === view.selection.server)
  const selected = server?.projects.find((item) => item.project.worktree === view.selection.directory)
  useLayoutEffect(() => {
    root.current?.querySelector("[data-popover-trigger]")?.setAttribute("data-component", "home-projects-dropdown")
  }, [])
  const panel = { view, services: props.services, close: () => setOpen(false) }
  if (!view.dropdown) return <ProjectsPanel {...panel} />
  return (
    <div ref={root} className="w-full md:w-auto">
      <Popover
        open={open}
        onOpenChange={setOpen}
        triggerLabel={
          view.servers.length > 1 && server
            ? view.language.t("home.projects.scope.server", {
                selection: selected?.name ?? view.language.t("home.projects.all"),
                server: server.name,
              })
            : view.language.t("home.projects.scope", {
                selection: selected?.name ?? view.language.t("home.projects.all"),
              })
        }
        contentLabel={view.language.t("home.projects")}
        align="start"
        sideOffset={6}
        triggerClass="w-full min-w-0 justify-start gap-2 bg-v2-background-bg-base px-2 text-start font-normal md:w-auto md:max-w-80"
        trigger={
          <>
            {selected ? <ProjectTile project={selected.project} size="md" /> : <Icon name="folder" size="small" />}
            <span className="flex min-w-0 flex-1 flex-col text-start">
              <bdi className="truncate">{selected?.name ?? view.language.t("home.projects.all")}</bdi>
              {view.servers.length > 1 && server && (
                <bdi className="truncate text-caption text-ink-muted">{server.name}</bdi>
              )}
            </span>
            <Icon name="chevron-down" size="small" className="shrink-0 text-ink-muted" />
          </>
        }
        className="flex max-h-[70dvh] w-[max(18rem,var(--anchor-width))] max-w-[calc(100vw-24px)] flex-col overflow-hidden p-1"
      >
        {open && <ProjectsPanel {...panel} />}
      </Popover>
    </div>
  )
}

function ProjectsPanel(props: PanelProps) {
  const view = props.view
  const language = view.language
  const [menu, setMenu] = useState<string>()
  const multi = view.servers.length > 1 || view.servers.some((server) => server.authentication || server.connecting)
  const single = view.servers[0]
  useEffect(() => {
    if (!menu) return
    if (
      view.servers.some(
        (server) =>
          menu === server.key || server.projects.some((item) => menu === `${server.key}:${item.project.worktree}`),
      )
    )
      return
    setMenu(undefined)
  }, [menu, view.servers])
  const actions = { ...props, menu, setMenu }
  return (
    <aside
      aria-label={language.t("home.projects")}
      className={`flex min-h-0 min-w-0 flex-col overflow-hidden ${view.dropdown ? "max-h-[60dvh]" : "h-full"}`}
    >
      {!view.dropdown && (
        <div className="mt-3 flex h-10 shrink-0 items-center justify-between px-2 md:mt-6">
          <h2 className="m-0 text-eyebrow uppercase text-ink-muted">{language.t("home.projects")}</h2>
          {single && view.servers.length === 1 && (
            <Button
              variant="ghost"
              size="sm"
              aria-label={language.t("home.project.add")}
              disabled={single.health?.healthy === false}
              onClick={() => props.services.choose(single.server)}
            >
              <Icon name="folder-add-left" />
            </Button>
          )}
        </div>
      )}
      <ScrollArea
        label={language.t("home.projects")}
        variant="plain"
        data-slot="home-projects-scroll"
        className="min-h-0 min-w-0 shrink overscroll-contain"
      >
        {single && view.servers.length === 1 && (view.dropdown || single.projects.length > 1) && (
          <NavButton
            data-action="home-all-projects"
            selected={!view.selection.directory}
            onClick={() => {
              props.close()
              props.services.focus(single.server)
            }}
          >
            <Icon name="grid-plus" size="small" />
            <span className="min-w-0 flex-1 truncate">{language.t("home.projects.all")}</span>
          </NavButton>
        )}
        {multi ? (
          <div className="flex min-w-0 flex-col gap-1">
            {view.servers.map((server) => (
              <div key={server.key} className="flex min-w-0 flex-col gap-px">
                <ServerRow {...actions} server={server} />
                {(server.authentication || server.connecting) && (
                  <div className="ps-2 py-1">
                    <Button
                      data-action="home-server-authenticate"
                      block
                      disabled={server.connecting}
                      loading={server.connecting}
                      onClick={() => {
                        props.close()
                        props.services.authenticate(server.server)
                      }}
                    >
                      {language.t(server.connecting ? "server.status.connecting" : "server.action.authenticate")}
                    </Button>
                  </div>
                )}
                {server.health?.healthy && !server.authentication && !server.connecting && !server.collapsed && (
                  <ProjectList {...actions} server={server} />
                )}
              </div>
            ))}
          </div>
        ) : (
          single && (
            <>
              <ProjectList {...actions} server={single} />
              {(!single.projects.length || view.dropdown) && (
                <NavButton
                  data-action="home-add-project-row"
                  disabled={single.health?.healthy === false}
                  onClick={() => {
                    props.close()
                    props.services.choose(single.server)
                  }}
                >
                  <Icon name="folder-add-left" size="small" />
                  <span className="min-w-0 flex-1 truncate">{language.t("home.project.add")}</span>
                </NavButton>
              )}
              {!single.projects.length && single.recentlyClosed.length > 0 && (
                <>
                  <h3 className="m-0 mt-5 flex h-7 items-center ps-2.5 text-eyebrow uppercase text-ink-muted">
                    {language.t("home.recentlyClosed")}
                  </h3>
                  {single.recentlyClosed.map((item) => {
                    const worktree = item.project.worktree
                    const path =
                      view.homedir && (worktree === view.homedir || worktree.startsWith(`${view.homedir}/`))
                        ? `~${worktree.slice(view.homedir.length)}`
                        : worktree
                    return (
                      <Tooltip
                        key={worktree}
                        content={path}
                        child={({ props: trigger }) => (
                          <NavButton
                            {...trigger}
                            data-component="home-recently-closed-row"
                            disabled={single.health?.healthy === false}
                            onClick={() => {
                              props.close()
                              props.services.add(single.server, [worktree])
                            }}
                          >
                            <ProjectTile project={item.project} size="md" outline />
                            <span className="min-w-0 flex-1 truncate">{item.name}</span>
                          </NavButton>
                        )}
                      />
                    )
                  })}
                </>
              )}
            </>
          )
        )}
      </ScrollArea>
      {!view.dropdown && (
        <div className="mt-auto flex shrink-0 flex-col border-t border-muted py-2">
          <NavButton data-action="home-settings" onClick={props.services.settings}>
            <Icon name="settings-gear" size="small" />
            {language.t("sidebar.settings")}
          </NavButton>
          <NavButton data-action="home-help" onClick={props.services.help}>
            <Icon name="help" size="small" />
            {language.t("sidebar.help")}
          </NavButton>
        </div>
      )}
    </aside>
  )
}

type RowsProps = PanelProps & { server: Server; menu: string | undefined; setMenu: (key: string | undefined) => void }

function ServerRow(props: RowsProps) {
  const server = props.server
  const language = props.view.language
  const selected = props.view.selection.server === server.key && !props.view.selection.directory
  const canToggle = !!server.health?.healthy && server.projects.length > 0
  const tooltip = server.authentication
    ? language.t("server.status.authentication")
    : server.health?.incompatible
      ? language.t("server.row.incompatible", { version: server.health.version ?? "1" })
      : undefined
  const row = (
    <div
      data-home-row
      data-dimmed={!server.health?.healthy && !server.health?.incompatible}
      data-selected={selected ? "" : undefined}
      className="group/server relative flex h-[var(--reddb-spatial-control-height-md)] w-full min-w-0 items-center rounded-md"
    >
      <NavButton
        selected={selected}
        disabled={!server.health?.healthy && !server.authentication}
        onClick={() => {
          props.close()
          props.services.focus(server.server)
        }}
      >
        <span
          data-action="home-server-collapse"
          className={`-me-1 inline-flex size-5 shrink-0 items-center justify-center rounded-sm text-ink-muted ${canToggle ? "hover:bg-foreground/8 hover:text-foreground" : "opacity-50"}`}
          aria-label={language.t(server.collapsed ? "home.server.expand" : "home.server.collapse")}
          aria-disabled={!canToggle}
          aria-expanded={canToggle ? !server.collapsed : undefined}
          onPointerDown={(event) => event.preventDefault()}
          onClick={(event) => {
            event.preventDefault()
            event.stopPropagation()
            if (canToggle) props.services.collapse(server.server)
          }}
        >
          <Icon
            name="chevron-down"
            size="small"
            style={{ transform: `rotate(${server.collapsed || !canToggle ? -90 : 0}deg)` }}
          />
        </span>
        <span className="flex size-4 shrink-0 items-center justify-center">
          <ServerStatus server={server} view={props.view} />
        </span>
        <span
          data-slot="home-row-label"
          className={`flex min-w-0 flex-1 items-center gap-1 ${!server.health?.healthy && !server.health?.incompatible ? "opacity-50" : ""}`}
        >
          <span className="truncate">{server.name}</span>
          {server.server.label && (
            <span className="shrink-0 rounded-sm border border-control-edge px-1 text-eyebrow uppercase text-ink-muted">
              {server.server.label}
            </span>
          )}
        </span>
      </NavButton>
      <div
        data-slot="home-row-actions"
        data-menu={props.menu === server.key}
        className="hover-reveal absolute bottom-0 end-1 top-0 flex items-center gap-0.5 rounded-e-md ps-2 group-hover/server:opacity-100 focus-within:opacity-100 data-[menu=true]:opacity-100"
      >
        <RowMenu
          label={language.t("common.moreOptions")}
          heading={language.t("settings.section.server")}
          open={props.menu === server.key}
          onOpenChange={(open) => props.setMenu(open ? server.key : undefined)}
          items={[
            {
              heading: language.t("settings.section.server"),
              items: [
                {
                  id: "edit",
                  label: language.t("dialog.server.menu.edit"),
                  disabled: !server.canEdit,
                  onselect: () => {
                    if (server.server.type === "http") {
                      props.close()
                      props.services.editServer(server.server)
                    }
                  },
                },
                ...(server.canHide
                  ? [
                      {
                        id: "hide",
                        label: language.t("dialog.server.menu.hide"),
                        onselect: () => props.services.hideServer(server.server),
                      },
                    ]
                  : []),
              ],
            },
            ...(server.canRemove
              ? [
                  {
                    items: [
                      {
                        id: "remove",
                        label: language.t("dialog.server.menu.remove"),
                        onselect: () => props.services.removeServer(server.server),
                      },
                    ],
                  },
                ]
              : []),
          ]}
        />
        <Button
          variant="ghost"
          size="sm"
          data-action="home-add-project"
          aria-label={language.t("home.project.add")}
          disabled={server.health?.healthy === false && !server.authentication}
          onClick={() => {
            props.close()
            props.services.choose(server.server)
          }}
        >
          <Icon name="folder-add-left" />
        </Button>
      </div>
    </div>
  )
  return tooltip ? (
    <Tooltip
      content={tooltip}
      child={({ props: trigger }) => (
        <div {...trigger} tabIndex={0}>
          {row}
        </div>
      )}
    />
  ) : (
    row
  )
}

function ServerStatus(props: { server: Server; view: View }) {
  const server = props.server
  if (server.authentication)
    return (
      <span role="status" aria-label={props.view.language.t("server.status.authentication")}>
        <Icon name="lock" size="small" />
      </span>
    )
  if (server.connecting || server.health?.checking)
    return <LoadingIndicator size="sm" label={props.view.language.t("server.status.connecting")} />
  if (server.health?.incompatible)
    return <Icon name="warning" size="small" className="text-feedback-warning-foreground" />
  return (
    <span
      className={`size-1.5 shrink-0 rounded-full ${server.health?.healthy ? "bg-feedback-success-foreground" : server.health?.healthy === false ? "bg-feedback-danger-foreground" : "bg-muted"}`}
    />
  )
}

function ProjectList(props: RowsProps) {
  const root = useRef<HTMLDivElement>(null)
  const latest = useRef(props)
  latest.current = props
  const [manager, setManager] = useState<DragDropManager>()
  const [dragging, setDragging] = useState<string>()
  useLayoutEffect(() => {
    const manager = new DragDropManager({
      sensors: (defaults) => [
        ...defaults.filter((sensor) => sensor !== PointerSensor),
        PointerSensor.configure({
          activationConstraints: (event) =>
            event.pointerType === "touch"
              ? [new PointerActivationConstraints.Delay({ value: 250, tolerance: 5 })]
              : [new PointerActivationConstraints.Distance({ value: 4 })],
          preventActivation: (event) => event.target instanceof Element && !!event.target.closest("[data-action]"),
        }),
      ],
      modifiers: [RestrictToVerticalAxis, RestrictToElement.configure({ element: () => root.current })],
      plugins: (defaults) => [
        ...defaults.filter((plugin) => plugin !== AutoScroller && plugin !== Feedback),
        AutoScroller.configure({ acceleration: 8, threshold: { x: 0, y: 0.05 } }),
        Feedback.configure({ dropAnimation: null }),
      ],
    })
    manager.monitor.addEventListener("dragstart", (event) => setDragging(event.operation.source?.id.toString()))
    manager.monitor.addEventListener("dragend", (event) => {
      setDragging(undefined)
      const source = event.operation.source
      if (event.canceled || !isSortable(source)) return
      const props = latest.current
      if (source.initialIndex !== source.index)
        props.services.move(props.server.server, source.id.toString(), source.index)
      if (props.view.selection.server !== props.server.key) {
        props.close()
        props.services.select(props.server.server, source.id.toString())
      }
    })
    setManager(manager)
    return () => manager.destroy()
  }, [])
  return (
    <div ref={root} className="flex min-w-0 flex-col gap-1">
      {props.server.projects.map((item, index) => (
        <ProjectRow
          key={item.project.worktree}
          {...props}
          item={item}
          index={index}
          manager={manager}
          dragging={dragging === item.project.worktree}
        />
      ))}
    </div>
  )
}

function ProjectRow(
  props: RowsProps & { item: Project; index: number; manager: DragDropManager | undefined; dragging: boolean },
) {
  const root = useRef<HTMLDivElement>(null)
  const sortable = useRef<Sortable | undefined>(undefined)
  const pointer = useRef<boolean | undefined>(undefined)
  const worktree = props.item.project.worktree
  const server = props.server
  const key = `${server.key}:${worktree}`
  const selected = props.view.selection.server === server.key && props.view.selection.directory === worktree
  const language = props.view.language
  useLayoutEffect(() => {
    if (!props.manager || !root.current) return
    const item = new Sortable({ id: worktree, index: props.index, element: root.current }, props.manager)
    sortable.current = item
    return () => {
      sortable.current = undefined
      item.destroy()
    }
  }, [props.manager, worktree])
  useLayoutEffect(() => {
    if (sortable.current) sortable.current.index = props.index
  }, [props.index])
  const closeThen = (action: () => void) => {
    props.close()
    action()
  }
  return (
    <div
      ref={root}
      data-home-row
      data-dimmed={server.health?.healthy === false}
      data-dragging={props.dragging}
      data-selected={selected ? "" : undefined}
      className={`group/project relative flex h-[var(--reddb-spatial-control-height-md)] min-w-0 items-center rounded-md ${props.dragging ? "z-10" : ""}`}
      onContextMenu={(event) => {
        event.preventDefault()
        props.setMenu(key)
      }}
    >
      <NavButton
        data-component="home-project-row"
        selected={selected}
        disabled={server.health?.healthy === false}
        onPointerDown={(event) => {
          pointer.current = undefined
          if (
            props.view.dropdown ||
            event.button !== 0 ||
            event.pointerType === "touch" ||
            props.view.selection.server !== server.key
          )
            return
          pointer.current = selected
          if (!selected) props.services.select(server.server, worktree)
        }}
        onClick={(event) => {
          if (event.defaultPrevented) return
          if (event.detail === 0 || pointer.current === undefined) {
            closeThen(() => props.services.select(server.server, worktree))
            return
          }
          if (pointer.current) props.services.select(server.server, worktree)
          pointer.current = undefined
        }}
      >
        <ProjectTile project={props.item.project} size="md" unread={props.item.unseen > 0} />
        <span data-slot="home-row-label" className="min-w-0 flex-1 truncate">
          {props.item.name}
        </span>
      </NavButton>
      <div
        data-slot="home-row-actions"
        data-menu={props.menu === key}
        className="hover-reveal absolute bottom-0 end-1 top-0 flex items-center gap-0.5 rounded-e-md ps-2 group-hover/project:opacity-100 focus-within:opacity-100 data-[menu=true]:opacity-100"
      >
        <RowMenu
          action="home-project-menu"
          label={language.t("common.moreOptions")}
          heading={props.item.name}
          open={props.menu === key}
          onOpenChange={(open) => props.setMenu(open ? key : undefined)}
          items={[
            {
              items: [
                {
                  id: "new",
                  label: language.t("command.session.new"),
                  onselect: () => closeThen(() => props.services.newSession(server.server, worktree)),
                },
                ...(props.view.canImport
                  ? [
                      {
                        id: "import",
                        label: language.t("command.session.import"),
                        onselect: () => closeThen(() => props.services.import(server.server, props.item.project)),
                      },
                    ]
                  : []),
                ...props.view.extensions.map((item, index) => ({
                  id: `extension:${index}`,
                  label: item.title,
                  onselect: () => closeThen(() => item.run(server.key, worktree)),
                })),
                {
                  id: "edit",
                  label: language.t("dialog.project.edit.title"),
                  onselect: () => closeThen(() => props.services.edit(server.server, props.item.project)),
                },
                ...(server.canReveal
                  ? [
                      {
                        id: "reveal",
                        label: props.view.revealLabel,
                        onselect: () => props.services.reveal(server.server, props.item.project),
                      },
                    ]
                  : []),
                {
                  id: "clear",
                  label: language.t("sidebar.project.clearNotifications"),
                  disabled: props.item.unseen === 0,
                  onselect: () => props.services.clear(server.server, props.item.project),
                },
              ],
            },
            {
              items: [
                {
                  id: "close",
                  label: language.t("common.close"),
                  onselect: () => props.services.close(server.server, worktree),
                },
              ],
            },
          ]}
        />
        <Button
          variant="ghost"
          size="sm"
          data-action="home-project-new-session"
          aria-label={language.t("command.session.new")}
          onClick={() => closeThen(() => props.services.newSession(server.server, worktree))}
        >
          <Icon name="edit" />
        </Button>
      </div>
    </div>
  )
}

function RowMenu(props: {
  label: string
  heading: string
  action?: string
  open: boolean
  onOpenChange: (open: boolean) => void
  items: DropdownMenuEntry[]
}) {
  const root = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    if (props.action)
      root.current?.querySelector("[data-dropdown-menu-trigger]")?.setAttribute("data-action", props.action)
  }, [props.action])
  return (
    <div ref={root} className="contents">
      <DropdownMenu
        triggerLabel={props.label}
        contentLabel={props.heading}
        trigger={<Icon name="outline-dots" />}
        variant="ghost"
        size="sm"
        align="end"
        sideOffset={6}
        open={props.open}
        onOpenChange={props.onOpenChange}
        items={props.items}
      />
    </div>
  )
}

function NavButton(props: ComponentPropsWithRef<"button"> & { selected?: boolean }) {
  const { selected, className, ...rest } = props
  return (
    <button
      {...rest}
      type="button"
      data-selected={selected ? "" : undefined}
      aria-current={selected ? "page" : undefined}
      className={quietControl({
        focus: "inset",
        selected,
        class: navItem().root({
          class: `h-[var(--reddb-spatial-control-height-md)] w-full shrink-0 cursor-default gap-2 rounded-md px-2 text-start text-body ${className ?? ""}`,
        }),
      })}
    />
  )
}
