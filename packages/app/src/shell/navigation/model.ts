import type { SessionInfo } from "@opencode/client/promise"
import { homeProjectForSession } from "@/home/sessions/records"
import { compareSessionTime, displayName } from "@/shell/layout/helpers"
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
  /** A session of this project is running or unread, so a collapsed row still signals it. */
  attention: boolean
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
  /** Running or unread sessions stay visible past the project limit. */
  attention?: (sessionID: string) => boolean
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
    const attention = all.some((item) => input.attention?.(item.session.id) ?? false)
    const visible =
      filtered || input.showAll?.(key)
        ? candidates
        : candidates.filter((item, index) => index < limit || (input.attention?.(item.session.id) ?? false))
    return [
      {
        key,
        project,
        name,
        expanded: filtered || (input.expanded?.(key) ?? true),
        sessions: visible,
        hidden: candidates.length - visible.length,
        total: all.length,
        attention,
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
