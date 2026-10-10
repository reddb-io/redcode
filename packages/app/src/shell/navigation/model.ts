import type { SessionInfo } from "@opencode/client/promise"
import { homeProjectForSession } from "@/home/sessions/records"
import { compareSessionTime } from "@/shell/layout/helpers"
import { displayName } from "@opencode/ui/project-avatar"
import { sessionLabel } from "@/session/title"
import { pathKey } from "@/workspaces/path-key"

/** Sessions a collapsed-by-default project shows before "Show more". */
export const NAVIGATION_PROJECT_LIMIT = 5
/** Sessions the flat Recents section shows. */
export const NAVIGATION_RECENT_LIMIT = 8
export const NAVIGATION_MIN_WIDTH = 220
export const NAVIGATION_MAX_WIDTH = 420
export const NAVIGATION_DEFAULT_WIDTH = 272

export type NavigationProjectLike = { id?: string; name?: string; worktree: string; sandboxes?: readonly string[] }

export type NavigationSession<P extends NavigationProjectLike> = {
  session: SessionInfo
  project: P | undefined
  pinned: boolean
}

export type NavigationProject<P extends NavigationProjectLike> = {
  key: string
  project: P
  name: string
  expanded: boolean
  sessions: NavigationSession<P>[]
  /** Sessions held back behind "Show more". */
  hidden: number
  total: number
  /** The most urgent status among all of this project's sessions, so a collapsed row still signals it. */
  status: SessionStatus | undefined
}

export type NavigationTree<P extends NavigationProjectLike> = {
  pinned: NavigationSession<P>[]
  projects: NavigationProject<P>[]
  recents: NavigationSession<P>[]
  filtered: boolean
}

export type NavigationInput<P extends NavigationProjectLike> = {
  projects: readonly P[]
  sessions: readonly SessionInfo[]
  /** Pinned session IDs, in pin order. */
  pinned: readonly string[]
  query?: string
  expanded?: (key: string) => boolean
  showAll?: (key: string) => boolean
  /** Sessions with a status stay visible past the project limit. */
  status?: (sessionID: string) => SessionStatus | undefined
  limit?: number
  recentLimit?: number
}

export const navigationProjectKey = (worktree: string) => pathKey(worktree) as string

/**
 * Builds the sidemenu: pinned sessions first, then every open project with its newest root
 * sessions, then a flat tail of the newest sessions overall. A filter keeps a project whose name
 * matches with all of its sessions, and otherwise only the sessions whose title matches.
 */
export function buildNavigationTree<P extends NavigationProjectLike>(input: NavigationInput<P>): NavigationTree<P> {
  const query = input.query?.trim().toLowerCase() ?? ""
  const filtered = query.length > 0
  const limit = input.limit ?? NAVIGATION_PROJECT_LIMIT
  const pinnedIDs = new Set(input.pinned)
  const sessions = [...new Map(input.sessions.map((session) => [session.id, session] as const)).values()]
    .filter((session) => !session.parentID && typeof session.time.archived !== "number")
    .toSorted(compareSessionTime)
  const entry = (session: SessionInfo): NavigationSession<P> => ({
    session,
    project: homeProjectForSession(session, input.projects),
    pinned: pinnedIDs.has(session.id),
  })
  const matches = (item: NavigationSession<P>) =>
    !filtered ||
    sessionLabel(item.session).toLowerCase().includes(query) ||
    (!!item.project && displayName(item.project).toLowerCase().includes(query))
  const byID = new Map(sessions.map((session) => [session.id, session] as const))
  const pinned = input.pinned.flatMap((id) => {
    const session = byID.get(id)
    return session ? [entry(session)] : []
  })
  const unpinned = sessions.filter((session) => !pinnedIDs.has(session.id)).map(entry)
  const grouped = Map.groupBy(unpinned, (item) => (item.project ? navigationProjectKey(item.project.worktree) : ""))

  const projects = input.projects.flatMap((project): NavigationProject<P>[] => {
    const key = navigationProjectKey(project.worktree)
    const name = displayName(project)
    const all = grouped.get(key) ?? []
    const named = filtered && name.toLowerCase().includes(query)
    const candidates = named ? all : all.filter(matches)
    if (filtered && !named && candidates.length === 0) return []
    const visible =
      filtered || input.showAll?.(key)
        ? candidates
        : candidates.filter((item, index) => index < limit || input.status?.(item.session.id) !== undefined)
    return [
      {
        key,
        project,
        name,
        expanded: filtered || (input.expanded?.(key) ?? true),
        sessions: visible,
        hidden: candidates.length - visible.length,
        total: all.length,
        status: rollupSessionStatus(all.map((item) => input.status?.(item.session.id))),
      },
    ]
  })

  return {
    pinned: pinned.filter(matches),
    projects,
    recents: unpinned.filter(matches).slice(0, input.recentLimit ?? NAVIGATION_RECENT_LIMIT),
    filtered,
  }
}

/** Session IDs in the order the sidemenu shows them, for previous/next navigation. */
export function navigationSessionOrder<P extends NavigationProjectLike>(tree: NavigationTree<P>) {
  return [
    ...new Set([
      ...tree.pinned.map((item) => item.session.id),
      ...tree.projects.flatMap((project) => (project.expanded ? project.sessions.map((item) => item.session.id) : [])),
    ]),
  ]
}

/** Steps through a cyclic list; an unknown current item starts at the first (or last) entry. */
export function stepNavigation<T>(items: readonly T[], current: T | undefined, delta: 1 | -1) {
  if (items.length === 0) return
  const index = current === undefined ? -1 : items.indexOf(current)
  if (index === -1) return delta === 1 ? items[0] : items[items.length - 1]
  return items[(index + delta + items.length) % items.length]
}

/**
 * A session's one status, most urgent first: a pending permission, a pending question, a live
 * execution, inbox work waiting, a last turn that failed, then a finished turn this client has not
 * viewed. A session with none of these shows nothing.
 */
export const SESSION_STATUSES = ["approval", "input", "working", "queued", "failed", "done"] as const

/** Session families with explicit depth; each session appears once, even with an unavailable parent. */
export function agentSessionTrees(sessions: readonly SessionInfo[]) {
  const byID = new Map(sessions.map((session) => [session.id, session]))
  const children = Map.groupBy(
    sessions.filter((session) => session.parentID),
    (session) => session.parentID,
  )
  const seen = new Set<string>()
  const visit = (session: SessionInfo, depth: number): { session: SessionInfo; depth: number }[] => {
    if (seen.has(session.id)) return []
    seen.add(session.id)
    return [{ session, depth }, ...(children.get(session.id) ?? []).flatMap((child) => visit(child, depth + 1))]
  }
  const roots = sessions.filter((session) => !session.parentID || !byID.has(session.parentID))
  return [...roots, ...sessions].flatMap((root) => (seen.has(root.id) ? [] : [{ root, rows: visit(root, 0) }]))
}
export type SessionStatus = (typeof SESSION_STATUSES)[number]

export function sessionStatus(signals: Record<SessionStatus, boolean>) {
  return SESSION_STATUSES.find((status) => signals[status])
}

/** The most urgent of several statuses: what a project row shows for its sessions. */
export function rollupSessionStatus(statuses: readonly (SessionStatus | undefined)[]) {
  return SESSION_STATUSES.find((status) => statuses.includes(status))
}

/** Statuses that wait on the user rather than on the agent; their rows never recede. */
export const sessionAwaitsUser = (status: SessionStatus | undefined) =>
  status === "approval" || status === "input" || status === "failed" || status === "done"

/** The next session waiting on the user after `current`: most urgent first, then sidemenu order. */
export function nextSessionAwaitingUser<P extends NavigationProjectLike>(
  tree: NavigationTree<P>,
  status: (sessionID: string) => SessionStatus | undefined,
  current: string | undefined,
) {
  const rank = (id: string) => SESSION_STATUSES.findIndex((item) => item === status(id))
  const waiting = [
    ...new Set([
      ...tree.pinned.map((item) => item.session.id),
      ...tree.projects.flatMap((project) => project.sessions.map((item) => item.session.id)),
      ...tree.recents.map((item) => item.session.id),
    ]),
  ]
    .filter((id) => sessionAwaitsUser(status(id)))
    .toSorted((a, b) => rank(a) - rank(b))
  return stepNavigation(waiting, current, 1)
}

export type NavigationElapsed =
  | { unit: "second"; seconds: number }
  | { unit: "minute"; minutes: number }
  | { unit: "hour"; hours: number; minutes: number }

/** A live execution's compact elapsed time: "42s", "3m", "1h 5m". */
export function navigationElapsed(elapsed: number): NavigationElapsed {
  const seconds = Math.max(0, Math.floor(elapsed / 1000))
  if (seconds < 60) return { unit: "second", seconds }
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return { unit: "minute", minutes }
  return { unit: "hour", hours: Math.floor(minutes / 60), minutes: minutes % 60 }
}

export type NavigationDay = "today" | "yesterday" | "week" | "older"

// Calendar day in the local time zone, comparable as a number.
function localDay(date: Date) {
  return date.getFullYear() * 10_000 + date.getMonth() * 100 + date.getDate()
}

/** Groups items by local calendar day relative to `now`, newest groups first, empty groups dropped. */
export function groupByDay<T>(items: readonly T[], time: (item: T) => number, now: Date) {
  const today = localDay(now)
  const yesterday = localDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1))
  const week = localDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7))
  const bucket = (item: T): NavigationDay => {
    const day = localDay(new Date(time(item)))
    if (day >= today) return "today"
    if (day === yesterday) return "yesterday"
    if (day >= week) return "week"
    return "older"
  }
  const groups = Map.groupBy(items, bucket)
  return (["today", "yesterday", "week", "older"] as const).flatMap((id) => {
    const grouped = groups.get(id)
    return grouped ? [{ id, items: grouped }] : []
  })
}

export type NavigationAge = { value: number; unit: "minute" | "hour" | "day" | "week" | "month" | "year" }

/** The compact age a row shows ("4m", "2h", "3d"); undefined under a minute, which reads as "now". */
export function navigationAge(elapsed: number): NavigationAge | undefined {
  const minutes = Math.floor(elapsed / 60_000)
  if (minutes < 1) return
  if (minutes < 60) return { value: minutes, unit: "minute" }
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return { value: hours, unit: "hour" }
  const days = Math.floor(hours / 24)
  if (days < 7) return { value: days, unit: "day" }
  if (days < 30) return { value: Math.floor(days / 7), unit: "week" }
  if (days < 365) return { value: Math.floor(days / 30), unit: "month" }
  return { value: Math.floor(days / 365), unit: "year" }
}

export const clampNavigationWidth = (width: number) =>
  Math.round(Math.min(NAVIGATION_MAX_WIDTH, Math.max(NAVIGATION_MIN_WIDTH, width)))

export type PinnedSession = { server: string; session: string }

/** Pins at the top of the list, or removes an existing pin. */
export function togglePinned(list: readonly PinnedSession[], entry: PinnedSession) {
  const pinned = list.some((item) => item.server === entry.server && item.session === entry.session)
  if (pinned) return list.filter((item) => item.server !== entry.server || item.session !== entry.session)
  return [entry, ...list]
}
