import { createEffect, untrack } from "solid-js"
import { useGlobal } from "@/runtime/server/runtime"
import { useCurrentRoute } from "@/shell/state/layout"
import { tabKey, useTabs, type SessionTab } from "./tabs"

/** Release transcripts after their last tab closes, even when the session screen unmounts. */
export function SessionHistoryCache() {
  const tabs = useTabs()
  const global = useGlobal()
  const route = useCurrentRoute()
  let previous = new Map<string, SessionTab>()
  const closed = new Map<string, SessionTab>()

  createEffect(() => {
    if (!tabs.ready()) return
    const current = route()
    const open = new Map(tabs.store.flatMap((tab) => (tab.type === "session" ? [[tabKey(tab), tab] as const] : [])))

    for (const [key, tab] of previous) {
      if (!open.has(key)) closed.set(key, tab)
    }
    previous = open

    for (const [key, tab] of closed) {
      const data = global.serverCtx(tab.server)?.data
      if (!data) {
        closed.delete(key)
        continue
      }
      const root = data.session.root(tab.sessionId)
      const stillOpen = [...open.values()].some(
        (item) =>
          item.server === tab.server &&
          (data.session.root(item.sessionId) === root ||
            (item.routeSessionId && data.session.root(item.routeSessionId) === root)),
      )
      if (stillOpen) {
        closed.delete(key)
        continue
      }
      if (current.type === "session" && current.server === tab.server && data.session.root(current.sessionId) === root)
        continue
      closed.delete(key)
      untrack(() => data.session.evictHistory(tab.sessionId))
    }
  })

  return null
}
