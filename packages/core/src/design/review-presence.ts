export * as DesignReviewPresence from "./review-presence"

import { Effect } from "effect"

/**
 * How long a launched review page has to connect before another launch for the same session is
 * considered. A publish burst, a page still loading and a page reloading all fall inside it.
 */
export const DEBOUNCE = 15_000

interface Entry {
  connections: number
  /** When a browser was last launched for this session. */
  openedAt?: number
  /** Whether a review page connected since that launch, so a disconnect means the user closed it. */
  seen: boolean
}

export interface Presence {
  /** Registers one connected review page (a feed subscriber); the returned function releases it once. */
  readonly connect: (sessionID: string) => () => void
  /** Review pages currently connected for the session in this process. */
  readonly connected: (sessionID: string) => number
  /**
   * Claims a browser launch for the session, recording it when granted. Never while a page is
   * connected, and never twice inside the debounce. After a launch, a publish claims again only once
   * a page connected and went away (the user closed it); an explicit request does not need that.
   */
  readonly claim: (sessionID: string, input?: { readonly explicit?: boolean; readonly connected?: number }) => boolean
}

export function make(options: { readonly now?: () => number; readonly debounce?: number } = {}): Presence {
  const now = options.now ?? Date.now
  const debounce = options.debounce ?? DEBOUNCE
  const entries = new Map<string, Entry>()
  const entry = (sessionID: string) => {
    const existing = entries.get(sessionID)
    if (existing) return existing
    const created: Entry = { connections: 0, seen: false }
    entries.set(sessionID, created)
    return created
  }
  return {
    connect: (sessionID) => {
      const item = entry(sessionID)
      item.connections++
      item.seen = true
      let released = false
      return () => {
        if (released) return
        released = true
        item.connections--
      }
    },
    connected: (sessionID) => entries.get(sessionID)?.connections ?? 0,
    claim: (sessionID, input = {}) => {
      const item = entry(sessionID)
      if ((input.connected ?? item.connections) > 0) return false
      const at = now()
      if (item.openedAt !== undefined) {
        if (at - item.openedAt < debounce) return false
        if (!input.explicit && !item.seen) return false
      }
      item.openedAt = at
      item.seen = false
      return true
    },
  }
}

/** The process-wide presence both review feed routes register with and every launcher consults. */
export const shared = make()

/** Holds a feed subscription as one connected review page for as long as the scope lives. */
export const hold = (sessionID: string, presence: Presence = shared) =>
  Effect.acquireRelease(
    Effect.sync(() => presence.connect(sessionID)),
    (release) => Effect.sync(release),
  )
