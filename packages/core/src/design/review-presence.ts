export * as DesignReviewPresence from "./review-presence"

import { Effect } from "effect"

/**
 * How long a launched review page has to connect before another launch for the same session is
 * considered. A publish burst, a page still loading and a page reloading all fall inside it.
 */
export const DEBOUNCE = 15_000

/**
 * `claimed`: the caller launches a browser now and gives the claim back if the launch fails.
 * `connected`: a review page follows the session, so it shows new revisions itself.
 * `pending`: a tab was requested recently (or a page just went away), or was requested and never connected.
 */
export type Outcome = "claimed" | "connected" | "pending"

export type Claim =
  | { readonly outcome: "claimed"; readonly token: number }
  | { readonly outcome: "connected" | "pending" }

interface Entry {
  connections: number
  /** When a browser was last requested for this session. */
  openedAt?: number
  /** Whether a review page connected since that request, so a later disconnect means the user closed it. */
  seen: boolean
  /** When the last review page went away; a reload reconnects inside the debounce. */
  releasedAt?: number
  /** The live claim and what it replaced, so a failed launch can give it back. */
  claim?: { readonly token: number; readonly openedAt?: number; readonly seen: boolean }
}

export interface Presence {
  /** Registers one connected review page (a feed subscriber); the returned function releases it once. */
  readonly connect: (sessionID: string) => () => void
  /** Review pages currently connected for the session in this process. */
  readonly connected: (sessionID: string) => number
  /**
   * Claims a browser launch for the session. Never while a page is connected, and never twice inside
   * the debounce. After a launch, a publish claims again only once a page connected and went away (the
   * user closed it); an explicit user request does not need that, and records its claim like any other.
   */
  readonly claim: (sessionID: string, input?: { readonly explicit?: boolean }) => Claim
  /** Gives back a claim whose launch failed, so the next publish or request tries again. */
  readonly release: (sessionID: string, token: number) => void
  /** Sessions with state; entries indistinguishable from a fresh session are dropped. */
  readonly size: () => number
}

export function make(options: { readonly now?: () => number; readonly debounce?: number } = {}): Presence {
  // Monotonic, so a wall-clock adjustment cannot reopen or suppress a tab.
  const now = options.now ?? (() => performance.now())
  const debounce = options.debounce ?? DEBOUNCE
  const entries = new Map<string, Entry>()
  let tokens = 0
  const settled = (item: Entry, at: number) =>
    item.connections === 0 &&
    (item.openedAt === undefined || (item.seen && at - item.openedAt >= debounce)) &&
    (item.releasedAt === undefined || at - item.releasedAt >= debounce)
  const prune = (at: number) => {
    for (const [sessionID, item] of entries) if (settled(item, at)) entries.delete(sessionID)
  }
  const entry = (sessionID: string) => {
    const existing = entries.get(sessionID)
    if (existing) return existing
    const created: Entry = { connections: 0, seen: false }
    entries.set(sessionID, created)
    return created
  }
  return {
    connect: (sessionID) => {
      prune(now())
      const item = entry(sessionID)
      item.connections++
      item.seen = true
      let released = false
      return () => {
        if (released) return
        released = true
        item.connections--
        if (item.connections === 0) item.releasedAt = now()
      }
    },
    connected: (sessionID) => entries.get(sessionID)?.connections ?? 0,
    claim: (sessionID, input = {}) => {
      const at = now()
      prune(at)
      const item = entry(sessionID)
      if (item.connections > 0) return { outcome: "connected" }
      if (!input.explicit && item.releasedAt !== undefined && at - item.releasedAt < debounce)
        return { outcome: "pending" }
      if (item.openedAt !== undefined) {
        if (at - item.openedAt < debounce) return { outcome: "pending" }
        if (!input.explicit && !item.seen) return { outcome: "pending" }
      }
      const token = ++tokens
      item.claim = { token, openedAt: item.openedAt, seen: item.seen }
      item.openedAt = at
      item.seen = false
      return { outcome: "claimed", token }
    },
    release: (sessionID, token) => {
      const item = entries.get(sessionID)
      if (!item?.claim || item.claim.token !== token) return
      item.openedAt = item.claim.openedAt
      item.seen = item.claim.seen
      item.claim = undefined
      prune(now())
    },
    size: () => {
      prune(now())
      return entries.size
    },
  }
}

/** The process-wide presence both review feed routes register with and every launch claims through. */
export const shared = make()

/** Holds a feed subscription as one connected review page for as long as the scope lives. */
export const hold = (sessionID: string, presence: Presence = shared) =>
  Effect.acquireRelease(
    Effect.sync(() => presence.connect(sessionID)),
    (release) => Effect.sync(release),
  )

/**
 * Claims and, when granted, launches in the background; a launch that reports no browser gives its
 * claim back. Returns the claim outcome at once: `claimed` means a tab was requested, not yet opened.
 */
export const launch = (input: {
  readonly sessionID: string
  readonly explicit?: boolean
  readonly open: Effect.Effect<boolean>
  readonly presence?: Presence
}) =>
  Effect.gen(function* () {
    const presence = input.presence ?? shared
    const claim = presence.claim(input.sessionID, { explicit: input.explicit })
    if (claim.outcome !== "claimed") return claim.outcome
    yield* Effect.forkDetach(
      input.open.pipe(
        Effect.catchCause(() => Effect.succeed(false)),
        Effect.tap((opened) =>
          opened ? Effect.void : Effect.sync(() => presence.release(input.sessionID, claim.token)),
        ),
      ),
    )
    return claim.outcome
  })

/** What a server's launch route answers. */
export interface ClaimReply {
  readonly outcome: Outcome
  readonly token?: number
  readonly url?: string
}

export function parseClaim(value: unknown): ClaimReply | undefined {
  if (typeof value !== "object" || value === null) return undefined
  const { outcome, token, url } = value as Record<string, unknown>
  if (outcome !== "claimed" && outcome !== "connected" && outcome !== "pending") return undefined
  if (outcome === "claimed" && typeof token !== "number") return undefined
  return {
    outcome,
    ...(typeof token === "number" ? { token } : {}),
    ...(typeof url === "string" ? { url } : {}),
  }
}

export type Explicit = "opened" | "failed" | "connected" | "pending" | "disabled" | "unavailable"

/**
 * An explicit user request to open the review from a client (TUI command, `redcode design`). The claim
 * is made on the server, where the feed routes count connected pages and the Design tool claims too, so
 * a publish right after this request opens no second tab. A server without the launch route falls back
 * to `local` when given (`local: true` in the result), else reports `unavailable`.
 */
export async function openExplicit(input: {
  readonly sessionID: string
  /** The variable forbidding launches, checked before anything is claimed. */
  readonly disabled?: string
  readonly claim: () => Promise<ClaimReply | undefined>
  readonly release: (token: number) => Promise<unknown>
  readonly launch: (url: string) => Promise<boolean>
  /** Used when the reply names no URL. */
  readonly url?: string
  readonly local?: Presence
}): Promise<{ readonly status: Explicit; readonly url?: string; readonly local: boolean }> {
  if (input.disabled) return { status: "disabled", url: input.url, local: false }
  const remote = await input.claim().catch(() => undefined)
  const local = remote === undefined && input.local !== undefined
  const reply: ClaimReply | undefined =
    remote ?? (input.local ? { ...input.local.claim(input.sessionID, { explicit: true }), url: input.url } : undefined)
  const url = reply?.url ?? input.url
  if (!reply || !url) return { status: "unavailable", url, local }
  if (reply.outcome !== "claimed") return { status: reply.outcome, url, local }
  const token = reply.token
  if (token === undefined) return { status: "unavailable", url, local }
  if (await input.launch(url).catch(() => false)) return { status: "opened", url, local }
  await (local ? Promise.resolve(input.local!.release(input.sessionID, token)) : input.release(token)).catch(
    () => undefined,
  )
  return { status: "failed", url, local }
}
