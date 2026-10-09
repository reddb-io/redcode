import type { SessionInfo } from "@opencode/client/promise"
import { Key } from "@solid-primitives/keyed"
import { createEffect, createMemo, For, Index, on, onCleanup, Show } from "solid-js"
import { createStore, type SetStoreFunction } from "solid-js/store"
import { InlineInput } from "@opencode/ui/inline-input"
import { Spinner } from "@opencode/ui/spinner"
import { ScrollView } from "@opencode/ui/scroll-view"
import { Button } from "@opencode/ui/button"
import { Icon } from "@opencode/ui/icon"
import { IconButton } from "@opencode/ui/icon-button"
import { Menu } from "@opencode/ui/menu"
import { Tooltip } from "@opencode/ui/tooltip"
import { useLanguage } from "@/runtime/i18n/language"
import { ServerConnection } from "@/runtime/server/registry"
import { ProjectTile } from "@/shell/layout/project-tile"
import { sessionLabel } from "@/session/title"
import { shouldOpenSessionInBackground } from "./open"
import "./view.css"
import {
  HomeSessionStatusController,
  homeSessionSearchKey,
  type HomeSessionGroup,
  type HomeSessionRecord,
  type OpenSessionOptions,
} from "./controller"

const SHOW_HOME_SESSION_ARCHIVE = false
const HOME_SESSION_SEARCH_RESULTS_ID = "home-session-search-results"
const HOME_SESSION_LONG_PRESS_MS = 500
const HOME_EYEBROW = "text-eyebrow uppercase text-ink-muted"

// Middle-click or Cmd+click on macOS (Ctrl+click elsewhere) opens a session
// tab in the background without navigating, matching browser conventions.
function isBackgroundOpen(event: MouseEvent) {
  return shouldOpenSessionInBackground({
    button: event.button,
    mac: typeof navigator === "object" && /(Mac|iPod|iPhone|iPad)/.test(navigator.platform),
    meta: event.metaKey,
    ctrl: event.ctrlKey,
    shift: event.shiftKey,
    alt: event.altKey,
  })
}

export type HomeSessionsViewProps = {
  language: ReturnType<typeof useLanguage>
  groups: HomeSessionGroup[]
  loading: boolean
  desktop: boolean
  location: (record: HomeSessionRecord) => { worktree: string; branch: string | undefined }
  onRevealLocations: (record?: HomeSessionRecord) => void
  showProjectName: boolean
  server: ServerConnection.Key
  canCreateSession: boolean
  searchValue: string
  searchPlaceholder: string
  searchOpen: boolean
  searchLoading: boolean
  searchResults: HomeSessionRecord[]
  searchActive: string
  searchNoResultsLabel: string
  titleOpacity: (id: HomeSessionGroup["id"]) => number
  isOpenTab: (record: HomeSessionRecord) => boolean
  onCreateSession: () => void
  onOpenSession: (session: SessionInfo, options?: OpenSessionOptions) => void
  onArchiveSession: (session: SessionInfo) => Promise<void>
  onRenameSession: (server: ServerConnection.Key, session: SessionInfo, title: string) => Promise<boolean>
  onExportSession: (server: ServerConnection.Key, session: SessionInfo) => Promise<void>
  onDeleteSession: (server: ServerConnection.Key, session: SessionInfo) => void
  isPinned: (session: SessionInfo) => boolean
  onTogglePin: (session: SessionInfo) => void
  onSetHoverTarget: (element: HTMLElement) => void
  onSetThumbTrack: (element: HTMLDivElement) => void
  onSetContent: (element: HTMLDivElement) => void
  onSetHeader: (id: HomeSessionGroup["id"], element: HTMLDivElement) => void
  onWheel: (event: WheelEvent) => void
  onSetSearchRoot: (element: HTMLDivElement) => void
  onSetSearchInput: (element: HTMLInputElement) => void
  onSetSearchList: (element: HTMLDivElement) => void
  onSearchFocus: () => void
  onSearchInput: (value: string) => void
  onSearchClose: () => void
  onSearchMove: (delta: number) => void
  onSearchSelectActive: () => void
  onSearchHighlight: (record: HomeSessionRecord) => void
  onSearchSelect: (record: HomeSessionRecord, options?: OpenSessionOptions) => void
}

// Session store updates recreate row components, so row-local state would
// close an open context menu or drop an in-progress rename. Keep both keyed
// by session ID at the view root, like the projects list does.
type HomeSessionRowUI = {
  menu: { id: string; x: number; y: number } | undefined
  editor: { id: string; draft: string; renaming: boolean } | undefined
}

type HomeSessionTimeFormat = (record: HomeSessionRecord, group: HomeSessionGroup["id"]) => string

export function HomeSessionsView(props: HomeSessionsViewProps) {
  const [rowUI, setRowUI] = createStore<HomeSessionRowUI>({ menu: undefined, editor: undefined })
  const time = createHomeSessionTime(props.language)
  // Branches render as a column, so resolve every visible location once the index lands.
  createEffect(
    on(
      () => props.loading,
      (loading) => {
        if (!loading) props.onRevealLocations()
      },
    ),
  )
  return (
    <section
      ref={props.onSetHoverTarget}
      data-component="home-sessions"
      class="flex min-h-0 min-w-0 flex-1 flex-col [--home-sticky:64px] md:[--home-sticky:80px]"
      aria-label={props.language.t("sidebar.project.recentSessions")}
    >
      <div
        class="sticky top-0 z-30 flex shrink-0 items-center gap-2 bg-v2-background-bg-base pb-3 pt-3 md:pb-4 md:pt-6"
        onWheel={props.onWheel}
      >
        <HomeSessionSearch {...props} time={time} />
        <Show when={props.groups.length > 0 && props.canCreateSession}>
          <Button
            data-action="home-new-session"
            variant="contrast"
            size="large"
            icon="plus"
            class="h-10 shrink-0 max-md:w-10 max-md:px-0 max-md:[&>span]:sr-only"
            aria-label={props.language.t("command.session.new")}
            onClick={props.onCreateSession}
          >
            <span>{props.language.t("command.session.new")}</span>
          </Button>
        </Show>
      </div>
      <div class="pointer-events-none sticky top-[var(--home-sticky)] z-40 h-0 -me-3">
        <div
          ref={props.onSetThumbTrack}
          data-component="home-session-scroll-track"
          class="relative ms-auto h-[calc(100cqh-var(--home-sticky))] w-3"
        />
      </div>
      <div class="min-h-[calc(100cqh-var(--home-sticky))]">
        <Show when={!props.loading} fallback={<HomeSessionSkeleton label={props.language.t("common.loading")} />}>
          <Show
            when={props.groups.length > 0}
            fallback={
              <HomeSessionsEmpty
                onNewSession={props.canCreateSession ? props.onCreateSession : undefined}
                language={props.language}
              />
            }
          >
            <div ref={props.onSetContent} class="flex flex-col gap-6 pb-16">
              {/* Index keeps group subtrees mounted when the group arrays are
                  rebuilt, so store updates cannot recreate rows mid-gesture. */}
              <Index each={props.groups}>
                {(group, index) => (
                  <div role="group" aria-labelledby={`home-session-group-${group().id}`} class="flex flex-col">
                    <HomeSessionGroupHeader
                      id={group().id}
                      title={group().title}
                      count={group().sessions.length}
                      titleOpacity={props.titleOpacity(group().id)}
                      onSetRef={(element) => props.onSetHeader(group().id, element)}
                      elevated={index === 0}
                    />
                    <div class="flex min-w-0 flex-col gap-px pt-1">
                      {/* Rows key by session ID: session.sync replaces the
                          stored session object wholesale, so reference-keyed
                          rows would be disposed mid-interaction whenever a
                          sync response lands. */}
                      <Key each={group().sessions} by={(record) => record.session.id}>
                        {(record) => (
                          <HomeSessionRow
                            {...props}
                            record={record()}
                            group={group().id}
                            time={time}
                            rowUI={rowUI}
                            setRowUI={setRowUI}
                          />
                        )}
                      </Key>
                    </div>
                  </div>
                )}
              </Index>
            </div>
          </Show>
        </Show>
      </div>
    </section>
  )
}

// Today and yesterday read as a clock time under their day header; the last week
// by weekday; anything older by date, with the year once it is not this year's.
function createHomeSessionTime(language: HomeSessionsViewProps["language"]): HomeSessionTimeFormat {
  const formats = createMemo(() => {
    const locale = language.intl()
    return {
      clock: new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit" }),
      weekday: new Intl.DateTimeFormat(locale, { weekday: "short" }),
      date: new Intl.DateTimeFormat(locale, { month: "short", day: "numeric" }),
      year: new Intl.DateTimeFormat(locale, { month: "short", day: "numeric", year: "numeric" }),
    }
  })
  return (record, group) => {
    const date = new Date(record.session.time.updated ?? record.session.time.created)
    if (group === "today" || group === "yesterday") return formats().clock.format(date)
    if (group === "week") return formats().weekday.format(date)
    if (date.getFullYear() === new Date().getFullYear()) return formats().date.format(date)
    return formats().year.format(date)
  }
}

function HomeSessionStatus(props: {
  server: HomeSessionsViewProps["server"]
  isOpenTab: HomeSessionsViewProps["isOpenTab"]
  record: HomeSessionRecord
  workingLabel: string
}) {
  return (
    <HomeSessionStatusController
      server={props.server}
      record={props.record}
      isOpenTab={props.isOpenTab}
      render={(state) => (
        <span data-slot="home-session-status" class="flex size-4 shrink-0 items-center justify-center">
          <Show
            when={state.loading()}
            fallback={
              <Show when={state.unread() || state.open()}>
                <span
                  aria-hidden="true"
                  class="size-1.5 rounded-full"
                  classList={{
                    "bg-foreground": state.unread(),
                    "border border-ink-muted": !state.unread(),
                  }}
                />
              </Show>
            }
          >
            <span
              role="img"
              aria-label={props.workingLabel}
              title={props.workingLabel}
              class="relative flex size-2 items-center justify-center"
            >
              <span class="absolute inset-0 rounded-full bg-feedback-success-foreground opacity-40 motion-safe:animate-ping" />
              <span class="relative size-2 rounded-full bg-feedback-success-foreground" />
            </span>
          </Show>
        </span>
      )}
    />
  )
}

function HomeSessionSearch(props: HomeSessionsViewProps & { time: HomeSessionTimeFormat }) {
  return (
    <div ref={props.onSetSearchRoot} data-component="home-session-search" class="relative z-30 min-w-0 flex-1">
      <label
        class={`
          relative z-20 flex h-10 w-full items-center gap-2 rounded-md border border-control-edge bg-v2-background-bg-base
          ps-3 pe-1.5 text-ink-muted focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-focus
        `}
      >
        <Icon name="magnifying-glass" size="small" class="shrink-0" />
        <input
          ref={props.onSetSearchInput}
          class="min-w-0 flex-1 border-0 bg-transparent text-body text-foreground outline-0 placeholder:text-ink-muted"
          value={props.searchValue}
          placeholder={props.searchPlaceholder}
          aria-label={props.searchPlaceholder}
          aria-expanded={props.searchOpen}
          aria-controls={HOME_SESSION_SEARCH_RESULTS_ID}
          aria-autocomplete="list"
          aria-activedescendant={
            props.searchActive && props.searchOpen ? `home-session-search-option-${props.searchActive}` : undefined
          }
          onFocus={props.onSearchFocus}
          onInput={(event) => props.onSearchInput(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault()
              props.onSearchClose()
              event.currentTarget.blur()
              return
            }
            if (!props.searchOpen || props.searchResults.length === 0) return
            if (event.altKey || event.metaKey) return
            if (event.key === "ArrowDown") {
              event.preventDefault()
              props.onSearchMove(1)
              return
            }
            if (event.key === "ArrowUp") {
              event.preventDefault()
              props.onSearchMove(-1)
              return
            }
            if (event.key === "Enter" && !event.isComposing) {
              event.preventDefault()
              props.onSearchSelectActive()
            }
          }}
        />
        <Show when={props.searchValue}>
          <IconButton
            type="button"
            variant="ghost-muted"
            size="small"
            class="shrink-0"
            icon={<Icon name="close" />}
            aria-label={props.searchPlaceholder}
            onClick={() => {
              props.onSearchClose()
              props.onSearchFocus()
            }}
          />
        </Show>
      </label>
      <Show when={props.searchOpen}>
        <div
          data-component="home-session-search-panel"
          class={`
            absolute inset-x-0 top-full mt-1 flex flex-col overflow-hidden rounded-lg border
            border-elevation-overlay-border bg-elevation-overlay-surface p-1 shadow-elevation-overlay
          `}
        >
          <div id={HOME_SESSION_SEARCH_RESULTS_ID} role="listbox" class="flex flex-col">
            <Show
              when={!props.searchLoading}
              fallback={
                <div class="flex items-center justify-center px-3 py-3 text-ink-muted">
                  <Spinner class="size-4" />
                </div>
              }
            >
              <Show
                when={props.searchResults.length > 0}
                fallback={<p class="px-3 py-2.5 text-body text-ink-muted">{props.searchNoResultsLabel}</p>}
              >
                <p class={`${HOME_EYEBROW} px-2 pb-1 pt-1.5`}>{props.language.t("home.sessions.search.sessions")}</p>
                <ScrollView class="max-h-[min(20rem,40dvh)]" viewportRef={props.onSetSearchList}>
                  <div class="flex flex-col gap-px">
                    <For each={props.searchResults}>
                      {(record) => (
                        <HomeSessionSearchResultRow
                          {...props}
                          record={record}
                          selected={props.searchActive === homeSessionSearchKey(record)}
                        />
                      )}
                    </For>
                  </div>
                </ScrollView>
              </Show>
            </Show>
          </div>
        </div>
      </Show>
    </div>
  )
}

function HomeSessionSearchResultRow(
  props: HomeSessionsViewProps & {
    record: HomeSessionRecord
    selected: boolean
    time: HomeSessionTimeFormat
  },
) {
  const title = createMemo(() => sessionLabel(props.record.session))
  const key = () => homeSessionSearchKey(props.record)
  return (
    <button
      type="button"
      id={`home-session-search-option-${key()}`}
      data-key={key()}
      data-component="home-session-search-row"
      data-project-name={props.showProjectName}
      role="option"
      aria-selected={props.selected}
      class={`
        flex h-[var(--reddb-spatial-control-height-md)] w-full shrink-0 cursor-default items-center gap-2 rounded-md
        px-2 text-start text-body text-foreground hover:bg-foreground/8 focus-visible:outline-2
        focus-visible:-outline-offset-2 focus-visible:outline-focus
      `}
      classList={{ "bg-foreground/10 hover:bg-foreground/10": props.selected }}
      onMouseEnter={() => {
        props.onSearchHighlight(props.record)
        props.onRevealLocations(props.record)
      }}
      onMouseDown={(event) => {
        if (event.button === 1) event.preventDefault()
      }}
      onClick={(event) => props.onSearchSelect(props.record, { background: isBackgroundOpen(event) })}
      onAuxClick={(event) => {
        if (!isBackgroundOpen(event)) return
        event.preventDefault()
        props.onSearchSelect(props.record, { background: true })
      }}
    >
      <HomeSessionStatus
        server={props.server}
        isOpenTab={props.isOpenTab}
        record={props.record}
        workingLabel={props.language.t("session.timeline.working")}
      />
      <span dir="auto" class="min-w-0 flex-1 truncate" classList={{ "font-medium": props.selected }}>
        {title()}
      </span>
      <Show when={props.showProjectName}>
        <span class="flex min-w-0 max-w-[40%] shrink items-center gap-1.5 text-caption text-ink-muted">
          <ProjectTile project={props.record.project} />
          <span dir="auto" class="truncate">
            {props.record.projectName}
          </span>
        </span>
      </Show>
    </button>
  )
}

function HomeSessionGroupHeader(props: {
  id: HomeSessionGroup["id"]
  title: string
  count: number
  titleOpacity: number
  onSetRef: (element: HTMLDivElement) => void
  elevated?: boolean
}) {
  return (
    <div
      ref={props.onSetRef}
      class={`
        pointer-events-none sticky top-[var(--home-sticky)] flex h-8 min-w-0 items-center justify-between gap-3
        border-b border-muted bg-v2-background-bg-base px-2
      `}
      classList={{ "home-session-group-header z-[5]": !!props.elevated, "z-10": !props.elevated }}
    >
      <h3 id={`home-session-group-${props.id}`} class={`${HOME_EYEBROW} m-0`} style={{ opacity: props.titleOpacity }}>
        {props.title}
      </h3>
      <span class="text-caption tabular-nums text-ink-muted" style={{ opacity: props.titleOpacity }}>
        {props.count}
      </span>
    </div>
  )
}

function HomeSessionRow(
  props: HomeSessionsViewProps & {
    record: HomeSessionRecord
    group: HomeSessionGroup["id"]
    time: HomeSessionTimeFormat
    rowUI: HomeSessionRowUI
    setRowUI: SetStoreFunction<HomeSessionRowUI>
  },
) {
  const title = createMemo(() => sessionLabel(props.record.session))
  const location = createMemo(() => props.location(props.record))
  const sessionID = () => props.record.session.id
  const menu = () => (props.rowUI.menu?.id === sessionID() ? props.rowUI.menu : undefined)
  const editor = () => (props.rowUI.editor?.id === sessionID() ? props.rowUI.editor : undefined)
  let longPressTimer: ReturnType<typeof setTimeout> | undefined
  let longPressStart: { x: number; y: number } | undefined
  let suppressClick = false
  let menuInteractedOutside = false

  // Focus targets are looked up by session ID: session store updates recreate
  // row components, so instance refs can point at detached nodes by the time
  // deferred focus runs.
  const rowSelector = () => `[data-component="home-session-row-container"][data-session-id="${sessionID()}"]`
  const rowButton = () =>
    document.querySelector<HTMLButtonElement>(`${rowSelector()} [data-component="home-session-row"]`)
  const renameInput = () =>
    document.querySelector<HTMLInputElement>(`${rowSelector()} [data-component="home-session-rename"]`)

  const clearLongPress = () => {
    if (longPressTimer !== undefined) clearTimeout(longPressTimer)
    longPressTimer = undefined
    longPressStart = undefined
  }
  onCleanup(clearLongPress)

  const openMenu = (element: HTMLElement, clientX: number, clientY: number) => {
    const bounds = element.getBoundingClientRect()
    props.setRowUI("menu", { id: sessionID(), x: clientX - bounds.left, y: clientY - bounds.top })
  }

  const openEditor = () => {
    props.setRowUI("editor", { id: sessionID(), draft: title(), renaming: false })
    requestAnimationFrame(() => {
      const input = renameInput()
      input?.focus()
      input?.select()
    })
  }
  const closeEditor = () => {
    if (editor()?.renaming) return
    props.setRowUI("editor", (value) => (value?.id === sessionID() ? undefined : value))
  }
  const saveEditor = async () => {
    const current = editor()
    if (!current || current.renaming) return
    props.setRowUI("editor", { ...current, renaming: true })
    const saved = await props.onRenameSession(props.server, props.record.session, current.draft)
    // Disabling the input during the request drops focus to the body; restore
    // it unless the user focused another control while the rename was pending.
    const restore = document.activeElement === document.body || document.activeElement === renameInput()
    props.setRowUI("editor", (value) => {
      if (value?.id !== sessionID()) return value
      return saved ? undefined : { ...value, renaming: false }
    })
    if (!restore) return
    requestAnimationFrame(() => {
      if (saved) {
        rowButton()?.focus()
        return
      }
      renameInput()?.focus()
    })
  }

  const columns = () => (
    <>
      <Show when={props.showProjectName}>
        <span data-slot="home-session-project" class="flex min-w-0 items-center gap-1.5">
          <ProjectTile project={props.record.project} />
          <span data-component="home-session-project-name" dir="auto" class="min-w-0 truncate">
            {props.record.projectName}
          </span>
        </span>
      </Show>
      <span data-slot="home-session-branch" dir="ltr" class="flex min-w-0 items-center gap-1.5">
        <Show when={props.desktop && location().branch}>
          {(branch) => (
            <>
              <Icon name="branch" size="small" class="shrink-0" />
              <span class="min-w-0 truncate">{branch()}</span>
            </>
          )}
        </Show>
      </span>
      <time
        data-slot="home-session-time"
        datetime={new Date(props.record.session.time.updated ?? props.record.session.time.created).toISOString()}
        class="text-end tabular-nums"
      >
        {props.time(props.record, props.group)}
      </time>
    </>
  )

  return (
    <div
      data-component="home-session-row-container"
      data-project-name={props.showProjectName}
      data-session-id={props.record.session.id}
      class="group/session relative flex h-[var(--reddb-spatial-control-height-md)] min-w-0 items-center rounded-md"
      onContextMenu={(event) => {
        // While renaming, keep the native menu so paste and spelling work.
        if (editor()) return
        event.preventDefault()
        openMenu(event.currentTarget, event.clientX, event.clientY)
      }}
    >
      <Show
        when={!editor()}
        fallback={
          <div data-slot="home-session-editor" class="home-session-grid h-full w-full px-2">
            <HomeSessionStatus
              server={props.server}
              isOpenTab={props.isOpenTab}
              record={props.record}
              workingLabel={props.language.t("session.timeline.working")}
            />
            <InlineInput
              data-component="home-session-rename"
              aria-label={props.language.t("common.rename")}
              dir="auto"
              value={editor()?.draft ?? ""}
              disabled={editor()?.renaming ?? false}
              class="block min-w-0 truncate text-body font-medium text-foreground outline-none"
              style={{ "--inline-input-shadow": "none", "text-align": "start" }}
              onInput={(event) => {
                const draft = event.currentTarget.value
                props.setRowUI("editor", (value) => (value?.id === sessionID() ? { ...value, draft } : value))
              }}
              onKeyDown={(event) => {
                event.stopPropagation()
                // Enter and Escape during IME composition commit or cancel
                // the composition, not the rename. Safari can report the
                // composition-confirming keydown with isComposing false but
                // keyCode 229.
                if (event.isComposing || event.keyCode === 229) return
                if (event.key === "Enter") {
                  event.preventDefault()
                  void saveEditor()
                  return
                }
                if (event.key !== "Escape") return
                event.preventDefault()
                closeEditor()
                requestAnimationFrame(() => rowButton()?.focus())
              }}
              onBlur={closeEditor}
            />
            {columns()}
          </div>
        }
      >
        <button
          type="button"
          data-component="home-session-row"
          aria-haspopup="menu"
          aria-expanded={!!menu()}
          class={`
            home-session-grid h-full w-full cursor-default rounded-md border-0 bg-transparent px-2 text-start text-body text-foreground
            hover:bg-foreground/8 active:bg-foreground/12 aria-expanded:bg-foreground/10
            focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus
          `}
          onMouseDown={(event) => {
            if (event.button === 1) event.preventDefault()
          }}
          onMouseEnter={() => props.onRevealLocations(props.record)}
          onPointerDown={(event) => {
            suppressClick = false
            if (event.pointerType !== "touch") return
            clearLongPress()
            const element = event.currentTarget
            const x = event.clientX
            const y = event.clientY
            longPressStart = { x, y }
            longPressTimer = setTimeout(() => {
              suppressClick = true
              clearLongPress()
              openMenu(element, x, y)
            }, HOME_SESSION_LONG_PRESS_MS)
          }}
          onPointerMove={(event) => {
            if (!longPressStart) return
            if (Math.abs(event.clientX - longPressStart.x) <= 8 && Math.abs(event.clientY - longPressStart.y) <= 8)
              return
            clearLongPress()
          }}
          onPointerUp={clearLongPress}
          onPointerCancel={() => {
            clearLongPress()
            suppressClick = false
          }}
          onKeyDown={(event) => {
            if (event.key !== "ContextMenu" && (event.key !== "F10" || !event.shiftKey)) return
            event.preventDefault()
            const bounds = event.currentTarget.getBoundingClientRect()
            openMenu(event.currentTarget, bounds.left + 12, bounds.bottom)
          }}
          onClick={(event) => {
            // The flag stays set until the long-press compatibility click
            // arrives, however delayed; keyboard activation (detail 0) is
            // never that click and passes through.
            if (suppressClick) {
              suppressClick = false
              if (event.detail !== 0) {
                event.preventDefault()
                return
              }
            }
            props.onOpenSession(props.record.session, { background: isBackgroundOpen(event) })
          }}
          onAuxClick={(event) => {
            if (!isBackgroundOpen(event)) return
            event.preventDefault()
            props.onOpenSession(props.record.session, { background: true })
          }}
        >
          <HomeSessionStatus
            server={props.server}
            isOpenTab={props.isOpenTab}
            record={props.record}
            workingLabel={props.language.t("session.timeline.working")}
          />
          <span data-component="home-session-title" dir="auto" class="min-w-0 truncate">
            {title()}
          </span>
          {columns()}
        </button>
      </Show>
      <Menu
        modal={false}
        placement="bottom-start"
        gutter={2}
        open={!!menu()}
        onOpenChange={(open) => {
          if (open) return
          props.setRowUI("menu", (value) => (value?.id === sessionID() ? undefined : value))
        }}
      >
        <Menu.Trigger
          as="span"
          aria-hidden="true"
          tabIndex={-1}
          class="pointer-events-none absolute size-px"
          style={{ left: `${menu()?.x ?? 0}px`, top: `${menu()?.y ?? 0}px` }}
        />
        <Menu.Portal>
          <Menu.Content
            onInteractOutside={() => {
              menuInteractedOutside = true
            }}
            onCloseAutoFocus={(event) => {
              // The trigger is an invisible positioning span, so Kobalte's
              // default close focus restore has no useful target. Skip the
              // row focus when the rename editor owns focus or the user
              // dismissed the menu by interacting elsewhere.
              event.preventDefault()
              const outside = menuInteractedOutside
              menuInteractedOutside = false
              if (outside || editor()) return
              requestAnimationFrame(() => rowButton()?.focus())
            }}
          >
            <Menu.Item onSelect={() => props.onTogglePin(props.record.session)}>
              {props.language.t(
                props.isPinned(props.record.session) ? "navigation.session.unpin" : "navigation.session.pin",
              )}
            </Menu.Item>
            <Menu.Item onSelect={openEditor}>{props.language.t("common.rename")}</Menu.Item>
            <Menu.Item onSelect={() => void props.onExportSession(props.server, props.record.session)}>
              {props.language.t("common.export")}…
            </Menu.Item>
            <Menu.Separator />
            <Menu.Item onSelect={() => props.onDeleteSession(props.server, props.record.session)}>
              {props.language.t("common.delete")}…
            </Menu.Item>
          </Menu.Content>
        </Menu.Portal>
      </Menu>
      <Show when={SHOW_HOME_SESSION_ARCHIVE}>
        <div
          class={`
            hover-reveal absolute right-1.5 top-1/2 flex -translate-y-1/2 items-center gap-1
            group-hover/session:opacity-100 focus-within:opacity-100
          `}
        >
          <Tooltip class="flex shrink-0 items-center" placement="bottom" value={props.language.t("common.archive")}>
            <IconButton
              data-action="home-session-archive"
              variant="ghost-muted"
              size="large"
              icon={<Icon name="archive" />}
              aria-label={props.language.t("common.archive")}
              onClick={(event) => {
                event.preventDefault()
                event.stopPropagation()
                void props.onArchiveSession(props.record.session)
              }}
            />
          </Tooltip>
        </div>
      </Show>
    </div>
  )
}

function HomeSessionsEmpty(props: { onNewSession?: () => void; language: ReturnType<typeof useLanguage> }) {
  return (
    <div class="flex min-h-[min(100%,24rem)] flex-col items-center justify-center gap-3 px-6 py-12 text-center">
      <span
        aria-hidden="true"
        class="mb-1 flex size-10 items-center justify-center rounded-lg border border-control-edge font-mono text-body font-bold text-ink-muted"
      >
        ›_
      </span>
      <h2 class="m-0 text-body font-medium text-foreground">{props.language.t("home.sessions.empty")}</h2>
      <p class="m-0 max-w-[32ch] text-caption text-ink-muted">{props.language.t("home.sessions.empty.description")}</p>
      <Show when={props.onNewSession}>
        {(onNewSession) => (
          <Button
            data-action="home-new-session"
            variant="contrast"
            size="normal"
            icon="plus"
            class="mt-2"
            onClick={onNewSession()}
          >
            {props.language.t("command.session.new")}
          </Button>
        )}
      </Show>
    </div>
  )
}

function HomeSessionSkeleton(props: { label: string }) {
  return (
    <div class="flex min-w-0 flex-col" role="status" aria-label={props.label}>
      <div class="flex h-8 items-center border-b border-muted px-2">
        <span class="h-2.5 w-16 rounded-sm bg-muted" />
      </div>
      <div class="flex min-w-0 flex-col gap-px pt-1" aria-hidden="true">
        <For each={[64, 48, 72, 40, 56, 44]}>
          {(width) => (
            <div class="flex h-[var(--reddb-spatial-control-height-md)] items-center gap-3 px-2">
              <span class="size-1.5 rounded-full bg-muted" />
              <span class="h-2.5 rounded-sm bg-muted motion-safe:animate-pulse" style={{ width: `${width}%` }} />
              <span class="ms-auto h-2.5 w-10 rounded-sm bg-muted" />
            </div>
          )}
        </For>
      </div>
    </div>
  )
}
