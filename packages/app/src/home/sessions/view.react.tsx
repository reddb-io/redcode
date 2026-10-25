/** @jsxImportSource react */
import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type Dispatch,
  type MouseEvent,
  type SetStateAction,
} from "react"
import { Button } from "@reddb-io/design-system/base/Button"
import { Input } from "@reddb-io/design-system/base/Input"
import { LoadingIndicator } from "@reddb-io/design-system/base/LoadingIndicator"
import { ScrollArea } from "@reddb-io/design-system/base/ScrollArea"
import { Skeleton } from "@reddb-io/design-system/base/Skeleton"
import { ContextMenu } from "@reddb-io/design-system/app/ContextMenu"
import { Icon } from "@/runtime/react/icon.react"
import { SharedSlot } from "@/runtime/react/slot.react"
import { ProjectTile } from "@/shell/layout/project-tile.react"
import { shouldOpenSessionInBackground } from "./open"
import type { createHomeSessionsViewServices } from "./view"

type Services = ReturnType<typeof createHomeSessionsViewServices>
type View = ReturnType<Services["snapshot"]["getSnapshot"]>
type SessionRowData = View["groups"][number]["sessions"][number]
type Editor = { id: string; draft: string; busy: boolean }

export function HomeSessionsNativeView(props: { services: Services }) {
  const services = props.services
  const view = useSyncExternalStore(services.snapshot.subscribe, services.snapshot.getSnapshot)
  const [menu, setMenu] = useState<string>()
  const [editor, setEditor] = useState<Editor>()
  const formats = useMemo(
    () => ({
      clock: new Intl.DateTimeFormat(view.language.intl, { hour: "numeric", minute: "2-digit" }),
      weekday: new Intl.DateTimeFormat(view.language.intl, { weekday: "short" }),
      date: new Intl.DateTimeFormat(view.language.intl, { month: "short", day: "numeric" }),
      year: new Intl.DateTimeFormat(view.language.intl, { month: "short", day: "numeric", year: "numeric" }),
    }),
    [view.language.intl],
  )
  const time = (record: SessionRowData, group: string) => {
    const date = new Date(record.session.time.updated ?? record.session.time.created)
    if (group === "today" || group === "yesterday") return formats.clock.format(date)
    if (group === "week") return formats.weekday.format(date)
    return date.getFullYear() === new Date().getFullYear() ? formats.date.format(date) : formats.year.format(date)
  }
  return (
    <section
      data-component="home-sessions"
      className="flex min-h-0 min-w-0 flex-1 flex-col [--home-sticky:64px] md:[--home-sticky:80px]"
      aria-label={view.language.t("sidebar.project.recentSessions")}
    >
      <div className="sticky top-0 z-30 flex shrink-0 items-center gap-2 bg-v2-background-bg-base pb-3 pt-3 md:pb-4 md:pt-6">
        <HomeSearch view={view} services={services} />
        <Button variant="ghost" aria-pressed={view.archived} onClick={services.toggleArchived}>
          {view.language.t(view.archived ? "home.sessions.active" : "home.sessions.archived")}
        </Button>
        {view.groups.length > 0 && view.canCreateSession && (
          <Button
            data-action="home-new-session"
            variant="primary"
            className="h-10 shrink-0 max-md:w-10 max-md:px-0"
            aria-label={view.language.t("command.session.new")}
            onClick={services.create}
          >
            <Icon name="plus" />
            <span className="max-md:sr-only">{view.language.t("command.session.new")}</span>
          </Button>
        )}
      </div>
      <div className="min-h-[calc(100cqh-var(--home-sticky))]">
        {view.loading ? (
          <div role="status" aria-label={view.language.t("common.loading")} className="flex flex-col gap-3 pt-3">
            {[64, 48, 72, 40, 56, 44].map((width, index) => (
              <Skeleton key={index} shape="text" className="h-3" style={{ width: `${width}%` }} />
            ))}
          </div>
        ) : view.groups.length ? (
          <div ref={services.bindContent} className="flex flex-col gap-6 pb-16">
            {view.groups.map((group, index) => (
              <div
                key={group.id}
                role="group"
                aria-labelledby={`home-session-group-${group.id}`}
                className="flex flex-col"
              >
                <GroupHeader group={group} first={index === 0} services={services} />
                <div className="flex min-w-0 flex-col gap-px pt-1">
                  {group.sessions.map((record) => (
                    <SessionRow
                      key={record.session.id}
                      record={record}
                      time={time(record, group.id)}
                      view={view}
                      services={services}
                      menu={menu === record.session.id}
                      setMenu={setMenu}
                      editor={editor?.id === record.session.id ? editor : undefined}
                      setEditor={setEditor}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex min-h-[min(100%,24rem)] flex-col items-center justify-center gap-3 px-6 py-12 text-center">
            <h2 className="m-0 text-body font-medium text-foreground">{view.language.t("home.sessions.empty")}</h2>
            <p className="m-0 max-w-[32ch] text-caption text-ink-muted">
              {view.language.t("home.sessions.empty.description")}
            </p>
            {view.canCreateSession && (
              <Button data-action="home-new-session" variant="primary" className="mt-2" onClick={services.create}>
                <Icon name="plus" />
                {view.language.t("command.session.new")}
              </Button>
            )}
          </div>
        )}
      </div>
    </section>
  )
}

function GroupHeader(props: { group: View["groups"][number]; first: boolean; services: Services }) {
  const opacity = useSyncExternalStore(props.group.opacity.subscribe, props.group.opacity.getSnapshot)
  const element = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    if (element.current) props.services.bindHeader(props.group.id, element.current)
  }, [props.group.id, props.services])
  return (
    <div
      ref={element}
      className={`pointer-events-none sticky top-[var(--home-sticky)] flex h-8 min-w-0 items-center justify-between gap-3 border-b border-muted bg-v2-background-bg-base px-2 ${props.first ? "home-session-group-header z-[5]" : "z-10"}`}
    >
      <h3
        id={`home-session-group-${props.group.id}`}
        className="m-0 text-eyebrow uppercase text-ink-muted"
        style={{ opacity }}
      >
        {props.group.title}
      </h3>
      <span className="text-caption tabular-nums text-ink-muted" style={{ opacity }}>
        {props.group.sessions.length}
      </span>
    </div>
  )
}

function HomeSearch(props: { view: View; services: Services }) {
  const view = props.view
  const services = props.services
  return (
    <div ref={services.bindSearchRoot} data-component="home-session-search" className="relative z-30 min-w-0 flex-1">
      <div className="relative z-20 flex h-10 w-full items-center gap-2 rounded-md border border-control-edge bg-v2-background-bg-base ps-3 pe-1.5 text-ink-muted focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-focus">
        <Icon name="magnifying-glass" size="small" className="shrink-0" />
        <Input
          ref={services.bindSearchInput}
          type="text"
          className="h-full min-w-0 flex-1 border-0 bg-transparent px-0 shadow-none focus-visible:outline-none"
          value={view.searchValue}
          placeholder={view.searchPlaceholder}
          aria-label={view.searchPlaceholder}
          aria-expanded={view.searchOpen}
          aria-controls="home-session-search-results"
          aria-autocomplete="list"
          aria-activedescendant={
            view.searchActive && view.searchOpen ? `home-session-search-option-${view.searchActive}` : undefined
          }
          onFocus={services.searchFocus}
          onValueChange={services.searchInput}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault()
              services.searchClose()
              event.currentTarget.blur()
              return
            }
            if (!view.searchOpen || !view.searchResults.length || event.altKey || event.metaKey) return
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault()
              services.searchMove(event.key === "ArrowDown" ? 1 : -1)
              return
            }
            if (event.key === "Enter" && !event.nativeEvent.isComposing) {
              event.preventDefault()
              services.searchSelectActive()
            }
          }}
        />
        {!!view.searchValue && (
          <Button
            variant="ghost"
            size="sm"
            aria-label={view.language.t("common.clear")}
            onClick={() => {
              services.searchClose()
              services.searchFocus()
            }}
          >
            <Icon name="close" size="small" />
          </Button>
        )}
      </div>
      {view.searchOpen && (
        <div
          data-component="home-session-search-panel"
          className="absolute inset-x-0 top-full mt-1 flex flex-col overflow-hidden rounded-lg border border-elevation-overlay-border bg-elevation-overlay-surface p-1 shadow-elevation-overlay"
        >
          <div id="home-session-search-results" role="listbox" className="flex flex-col">
            {view.searchLoading ? (
              <LoadingIndicator className="justify-center px-3 py-3" label={view.language.t("common.loading")} />
            ) : view.searchResults.length ? (
              <>
                <p className="px-2 pb-1 pt-1.5 text-eyebrow uppercase text-ink-muted">
                  {view.language.t("home.sessions.search.sessions")}
                </p>
                <ScrollArea
                  ref={services.bindSearchList}
                  label={view.language.t("home.sessions.search.sessions")}
                  variant="plain"
                  className="max-h-[min(20rem,40dvh)]"
                >
                  <div className="flex flex-col gap-px">
                    {view.searchResults.map((record) => (
                      <button
                        key={record.key}
                        type="button"
                        id={`home-session-search-option-${record.key}`}
                        data-key={record.key}
                        data-component="home-session-search-row"
                        data-project-name={view.showProjectName}
                        role="option"
                        aria-selected={view.searchActive === record.key}
                        className={`flex h-[var(--reddb-spatial-control-height-md)] w-full shrink-0 cursor-default items-center gap-2 rounded-md px-2 text-start text-body text-foreground hover:bg-foreground/8 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus ${view.searchActive === record.key ? "bg-foreground/10 hover:bg-foreground/10" : ""}`}
                        onMouseEnter={() => {
                          services.searchHighlight(record)
                          services.reveal(record)
                        }}
                        onMouseDown={(event) => {
                          if (event.button === 1) event.preventDefault()
                        }}
                        onClick={(event) => services.searchSelect(record, { background: background(event) })}
                        onAuxClick={(event) => {
                          if (!background(event)) return
                          event.preventDefault()
                          services.searchSelect(record, { background: true })
                        }}
                      >
                        <SharedSlot mount={record.status} />
                        <span
                          dir="auto"
                          className={`min-w-0 flex-1 truncate ${view.searchActive === record.key ? "font-medium" : ""}`}
                        >
                          {record.title}
                        </span>
                        {view.showProjectName && (
                          <span className="flex min-w-0 max-w-[40%] shrink items-center gap-1.5 text-caption text-ink-muted">
                            <ProjectTile project={record.project} />
                            <span dir="auto" className="truncate">
                              {record.projectName}
                            </span>
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                </ScrollArea>
              </>
            ) : (
              <p className="px-3 py-2.5 text-body text-ink-muted">{view.searchNoResultsLabel}</p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function SessionRow(props: {
  record: SessionRowData
  time: string
  view: View
  services: Services
  menu: boolean
  setMenu: Dispatch<SetStateAction<string | undefined>>
  editor: Editor | undefined
  setEditor: Dispatch<SetStateAction<Editor | undefined>>
}) {
  const row = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const focus = useRef<"row" | "input" | undefined>(undefined)
  const statusID = `home-session-status-${props.record.session.id}`
  const bindEditor = useCallback((element: HTMLInputElement | null) => {
    input.current = element
    if (!element) return
    element.focus()
    element.select()
  }, [])
  useLayoutEffect(() => {
    const button = row.current?.querySelector<HTMLButtonElement>("[data-context-menu-trigger]")
    button?.setAttribute("data-component", "home-session-row")
    button?.setAttribute("aria-describedby", statusID)
    if (focus.current === "row" && !props.editor) {
      button?.focus()
      focus.current = undefined
    }
    if (focus.current === "input" && props.editor && !props.editor.busy) {
      input.current?.focus()
      focus.current = undefined
    }
  }, [props.editor, statusID])
  const cancel = () => {
    if (props.editor?.busy) return
    focus.current = "row"
    props.setEditor(undefined)
  }
  const save = async () => {
    const current = props.editor
    if (!current || current.busy) return
    props.setEditor({ ...current, busy: true })
    const saved = await props.services.rename(props.record.session, current.draft)
    const restore = document.activeElement === document.body || document.activeElement === input.current
    if (restore) focus.current = saved ? "row" : "input"
    props.setEditor((value) => (value?.id !== current.id ? value : saved ? undefined : { ...value, busy: false }))
  }
  const columns = (
    <>
      {props.view.showProjectName && (
        <span data-slot="home-session-project" className="flex min-w-0 items-center gap-1.5">
          <ProjectTile project={props.record.project} />
          <span data-component="home-session-project-name" dir="auto" className="min-w-0 truncate">
            {props.record.projectName}
          </span>
        </span>
      )}
      <span data-slot="home-session-branch" dir="ltr" className="flex min-w-0 items-center gap-1.5">
        {props.view.desktop && props.record.location.branch && (
          <>
            <Icon name="branch" size="small" className="shrink-0" />
            <span className="min-w-0 truncate">{props.record.location.branch}</span>
          </>
        )}
      </span>
      <time
        data-slot="home-session-time"
        dateTime={new Date(props.record.session.time.updated ?? props.record.session.time.created).toISOString()}
        className="text-end tabular-nums"
      >
        {props.time}
      </time>
    </>
  )
  return (
    <div
      ref={row}
      data-component="home-session-row-container"
      data-project-name={props.view.showProjectName}
      data-session-id={props.record.session.id}
      className="group/session relative flex h-[var(--reddb-spatial-control-height-md)] min-w-0 items-center rounded-md"
      onMouseDown={(event) => {
        if (event.button === 1) event.preventDefault()
      }}
      onClick={(event) => {
        if (
          !(event.target instanceof Element) ||
          !event.target.closest("[data-context-menu-trigger]") ||
          event.defaultPrevented ||
          (props.menu && event.detail !== 0)
        )
          return
        props.services.open(props.record.session, { background: background(event) })
      }}
      onAuxClick={(event) => {
        if (
          !(event.target instanceof Element) ||
          !event.target.closest("[data-context-menu-trigger]") ||
          !background(event)
        )
          return
        event.preventDefault()
        props.services.open(props.record.session, { background: true })
      }}
    >
      {props.editor ? (
        <div data-slot="home-session-editor" className="home-session-grid h-full w-full px-2">
          <SharedSlot mount={props.record.status} />
          <Input
            ref={bindEditor}
            type="text"
            data-component="home-session-rename"
            aria-label={props.view.language.t("common.rename")}
            dir="auto"
            value={props.editor.draft}
            disabled={props.editor.busy}
            className="h-full min-w-0 border-0 bg-transparent px-0 text-body font-medium text-foreground shadow-none"
            onValueChange={(draft) =>
              props.setEditor((value) => (value?.id === props.record.session.id ? { ...value, draft } : value))
            }
            onKeyDown={(event) => {
              event.stopPropagation()
              if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return
              if (event.key === "Enter") {
                event.preventDefault()
                void save()
                return
              }
              if (event.key === "Escape") {
                event.preventDefault()
                cancel()
              }
            }}
            onBlur={() => props.setEditor((value) => (value?.busy ? value : undefined))}
          />
          {columns}
        </div>
      ) : (
        <ContextMenu
          triggerLabel={[
            props.record.title,
            props.view.showProjectName ? props.record.projectName : undefined,
            props.view.desktop ? props.record.location.branch : undefined,
            props.time,
          ]
            .filter(Boolean)
            .join(" ")}
          contentLabel={props.record.title}
          open={props.menu}
          onOpenChange={(open) => props.setMenu(open ? props.record.session.id : undefined)}
          targetClass="home-session-grid h-full w-full cursor-default justify-start border-0 bg-transparent px-2 text-start text-body font-medium text-foreground shadow-none hover:bg-foreground/8"
          items={[
            {
              items: [
                {
                  id: "pin",
                  label: props.view.language.t(
                    props.record.pinned ? "navigation.session.unpin" : "navigation.session.pin",
                  ),
                  onselect: () => props.services.pin(props.record.session),
                },
                {
                  id: "rename",
                  label: props.view.language.t("common.rename"),
                  onselect: () =>
                    props.setEditor({ id: props.record.session.id, draft: props.record.title, busy: false }),
                },
                {
                  id: "archive",
                  label: props.view.language.t(
                    props.record.session.time.archived !== undefined ? "session.restore" : "common.archive",
                  ),
                  onselect: () => void props.services.archive(props.record.session),
                },
                {
                  id: "export",
                  label: `${props.view.language.t("common.export")}…`,
                  onselect: () => void props.services.export(props.record.session),
                },
              ],
            },
            {
              items: [
                {
                  id: "delete",
                  label: `${props.view.language.t("common.delete")}…`,
                  onselect: () => props.services.remove(props.record.session),
                },
              ],
            },
          ]}
        >
          <span id={statusID} className="contents">
            <SharedSlot mount={props.record.status} />
          </span>
          <span data-component="home-session-title" dir="auto" className="min-w-0 truncate">
            {props.record.title}
          </span>
          {columns}
        </ContextMenu>
      )}
    </div>
  )
}

function background(event: MouseEvent) {
  return shouldOpenSessionInBackground({
    button: event.button,
    mac: /(Mac|iPod|iPhone|iPad)/.test(navigator.platform),
    meta: event.metaKey,
    ctrl: event.ctrlKey,
    shift: event.shiftKey,
    alt: event.altKey,
  })
}
