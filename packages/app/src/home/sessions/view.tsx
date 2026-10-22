import type { SessionInfo } from "@opencode/client/promise"
import { createEffect, getOwner, on, runWithOwner, untrack } from "solid-js"
import type { useLanguage } from "@/runtime/i18n/language"
import type { ServerConnection } from "@/runtime/server/registry"
import { sharedLanguage } from "@/runtime/react/language"
import { sharedMount, type SharedMount } from "@/runtime/react/mount"
import { sharedSource, type SharedSource } from "@/runtime/react/source"
import { ReactView } from "@/runtime/react/view"
import { sessionLabel } from "@/session/title"
import {
  homeSessionSearchKey,
  type HomeSessionGroup,
  type HomeSessionRecord,
  type OpenSessionOptions,
} from "./controller"
import { HomeSessionStatus } from "./status"
import { HomeSessionsNativeView } from "./view.react"
import "./view.css"

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
  onRenameSession: (server: ServerConnection.Key, session: SessionInfo, title: string) => Promise<boolean>
  onExportSession: (server: ServerConnection.Key, session: SessionInfo) => Promise<void>
  onDeleteSession: (server: ServerConnection.Key, session: SessionInfo) => void
  isPinned: (session: SessionInfo) => boolean
  onTogglePin: (session: SessionInfo) => void
  onSetContent: (element: HTMLDivElement) => void
  onSetHeader: (id: HomeSessionGroup["id"], element: HTMLDivElement) => void
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

export function createHomeSessionsViewServices(props: HomeSessionsViewProps) {
  const owner = getOwner()
  const statuses = new Map<string, SharedMount>()
  const headers = new Map<HomeSessionGroup["id"], SharedSource<number>>()
  const status = (record: HomeSessionRecord) => {
    const key = `${props.server}:${record.session.id}`
    const cached = statuses.get(key)
    if (cached) return cached
    const mount = untrack(() =>
      runWithOwner(owner, () =>
        sharedMount(() => (
          <HomeSessionStatus
            server={props.server}
            isOpenTab={props.isOpenTab}
            record={record}
            workingLabel={props.language.t("session.timeline.working")}
          />
        )),
      ),
    )!
    statuses.set(key, mount)
    return mount
  }
  const header = (id: HomeSessionGroup["id"]) => {
    const cached = headers.get(id)
    if (cached) return cached
    const source = untrack(() => runWithOwner(owner, () => sharedSource(() => props.titleOpacity(id))))!
    headers.set(id, source)
    return source
  }
  const read = (record: HomeSessionRecord) => ({
    ...record,
    session: { ...record.session, time: { ...record.session.time }, location: { ...record.session.location } },
    project: { ...record.project, icon: record.project.icon ? { ...record.project.icon } : undefined },
    key: homeSessionSearchKey(record),
    title: sessionLabel(record.session),
    location: { ...props.location(record) },
    pinned: props.isPinned(record.session),
    status: status(record),
  })
  createEffect(
    on(
      () => props.loading,
      (loading) => {
        if (!loading) props.onRevealLocations()
      },
    ),
  )
  return {
    snapshot: sharedSource(() => ({
      language: sharedLanguage(props.language),
      groups: props.groups.map((group) => ({
        ...group,
        sessions: group.sessions.map(read),
        opacity: header(group.id),
      })),
      loading: props.loading,
      desktop: props.desktop,
      showProjectName: props.showProjectName,
      server: props.server,
      canCreateSession: props.canCreateSession,
      searchValue: props.searchValue,
      searchPlaceholder: props.searchPlaceholder,
      searchOpen: props.searchOpen,
      searchLoading: props.searchLoading,
      searchResults: props.searchResults.map(read),
      searchActive: props.searchActive,
      searchNoResultsLabel: props.searchNoResultsLabel,
    })),
    create: () => props.onCreateSession(),
    open: (session: SessionInfo, options?: OpenSessionOptions) => props.onOpenSession(session, options),
    rename: (session: SessionInfo, title: string) => props.onRenameSession(props.server, session, title),
    export: (session: SessionInfo) => props.onExportSession(props.server, session),
    remove: (session: SessionInfo) => props.onDeleteSession(props.server, session),
    pin: (session: SessionInfo) => props.onTogglePin(session),
    reveal: (record: HomeSessionRecord) => props.onRevealLocations(record),
    bindContent: (element: HTMLDivElement | null) => {
      if (element) props.onSetContent(element)
    },
    bindHeader: props.onSetHeader,
    bindSearchRoot: (element: HTMLDivElement | null) => {
      if (element) props.onSetSearchRoot(element)
    },
    bindSearchInput: (element: HTMLInputElement | null) => {
      if (element) props.onSetSearchInput(element)
    },
    bindSearchList: (element: HTMLDivElement | null) => {
      if (element) props.onSetSearchList(element)
    },
    searchFocus: props.onSearchFocus,
    searchInput: props.onSearchInput,
    searchClose: props.onSearchClose,
    searchMove: props.onSearchMove,
    searchSelectActive: props.onSearchSelectActive,
    searchHighlight: props.onSearchHighlight,
    searchSelect: props.onSearchSelect,
  }
}

export function HomeSessionsView(props: HomeSessionsViewProps) {
  const services = createHomeSessionsViewServices(props)
  return <ReactView component={HomeSessionsNativeView} props={{ services }} />
}
