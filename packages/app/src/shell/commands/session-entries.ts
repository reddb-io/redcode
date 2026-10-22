import { onCleanup } from "solid-js"
import { getFilename } from "@opencode/util/path"
import { displayName } from "@opencode/ui/project-avatar-data"
import type { SessionInfo } from "@opencode/client/promise"
import type { Project } from "@/runtime/server/types"
import type { ServerConnection } from "@/runtime/server/registry"
import type { LocalProject } from "@/shell/state/layout"
import { resolveProjectForSession } from "@/shell/layout/helpers"
import { looksLikeSessionID } from "@/session/search"
import type { CommandPaletteEntry } from "./entries"

const ENTRY_LIMIT = 5

export function createServerSessionEntries(props: {
  server: ServerConnection.Key
  opened: () => LocalProject[]
  stored: () => Project[]
  load: (search: string, signal: AbortSignal) => Promise<{ data: SessionInfo[] }>
  get: (sessionID: string, signal: AbortSignal) => Promise<SessionInfo>
  untitled: () => string
  category: () => string
  recentCategory: () => string
}) {
  let abort: AbortController | undefined

  onCleanup(() => abort?.abort())

  return async (text: string): Promise<CommandPaletteEntry[]> => {
    const search = text.trim()

    abort?.abort()
    const current = new AbortController()
    abort = current

    // Typed searches wait for a pause; an empty query lists recent sessions right away.
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, search ? 100 : 0)
      current.signal.addEventListener(
        "abort",
        () => {
          clearTimeout(timer)
          resolve()
        },
        { once: true },
      )
    })

    if (current.signal.aborted) return []
    const opened = props.opened()
    const stored = props.stored().map((project) => ({ ...project, expanded: false }))
    const category = search ? props.category() : props.recentCategory()

    const entries = await Promise.all([
      props.load(search, current.signal).then(
        (result) => result.data,
        () => [],
      ),
      looksLikeSessionID(search)
        ? props.get(search, current.signal).then(
            (result) => [result],
            () => [],
          )
        : Promise.resolve([]),
    ]).then(([listed, exact]) =>
      [...new Map([...exact, ...listed].map((session) => [session.id, session] as const)).values()].flatMap(
        (session) => {
          if (session.time.archived) return []

          const project = resolveProjectForSession(session, opened, stored)

          return [
            {
              id: `session:${props.server}:${session.id}`,
              type: "session" as const,
              title: session.title || props.untitled(),
              description: project ? displayName(project) : getFilename(session.location.directory),
              category,
              directory: session.location.directory,
              sessionID: session.id,
              server: props.server,
              project,
              updated: session.time.updated,
            },
          ]
        },
      ),
    )

    return search ? entries : entries.slice(0, ENTRY_LIMIT)
  }
}
