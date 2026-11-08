export const REQUEST_QUEUE_LIMIT = 4
export const REQUEST_QUEUE_SLOW_LIMIT = 2
export const REQUEST_STALL_MS = 2_000
export const REQUEST_STALL_COOLDOWN_MS = 10_000

const slowRequestPaths = ["/api/vcs", "/api/worktree"]

export type RequestQueueConfig = { readonly limit: number; readonly slowLimit: number; readonly stallMs: number }
export type RequestPriority = 0 | 1 | 2
export type RequestEntry = {
  readonly id: number
  readonly method: string
  readonly url: string
  readonly at: number
  readonly slow: boolean
  readonly priority: RequestPriority
}
export type RequestStallItem = { readonly method: string; readonly url: string; readonly ms: number }
export type RequestStallSnapshot = {
  readonly limit: number
  readonly inflight: readonly RequestStallItem[]
  readonly queued: readonly RequestStallItem[]
}

export type RequestQueueState =
  | { readonly status: "running"; readonly nextId: number; readonly warnedAt: number; readonly inflight: readonly RequestEntry[] }
  | {
      readonly status: "queued"
      readonly nextId: number
      readonly warnedAt: number
      readonly inflight: readonly RequestEntry[]
      readonly waiting: readonly RequestEntry[]
    }
  | { readonly status: "disposed" }

export type RequestQueueEvent =
  | {
      readonly type: "request.arrived"
      readonly method: string
      readonly url: string
      readonly slow: boolean
      readonly priority: RequestPriority
      readonly now: number
    }
  | { readonly type: "request.settled"; readonly id: number; readonly now: number }
  | { readonly type: "request.aborted"; readonly id: number; readonly now: number }
  | { readonly type: "watch.due"; readonly now: number }
  | { readonly type: "disposed" }

export type RequestQueueEffect =
  | { readonly type: "request.start"; readonly id: number }
  | { readonly type: "request.cancel"; readonly ids: readonly number[] }
  | { readonly type: "watcher.start"; readonly delayMs: number }
  | { readonly type: "watcher.stop" }
  | { readonly type: "log.stall"; readonly data: RequestStallSnapshot }

export type RequestClassification =
  | { readonly bypass: true }
  | { readonly bypass: false; readonly slow: boolean; readonly setup: boolean; readonly priority: RequestPriority }

const none: readonly RequestQueueEffect[] = []
const stop: RequestQueueEffect = { type: "watcher.stop" }
const bypass: RequestClassification = { bypass: true }

export function createRequestQueueState(): RequestQueueState {
  return { status: "running", nextId: 1, warnedAt: -Infinity, inflight: [] }
}

export function transitionRequestQueue(
  state: RequestQueueState,
  event: RequestQueueEvent,
  config: RequestQueueConfig,
): { readonly state: RequestQueueState; readonly effects: readonly RequestQueueEffect[] } {
  if (state.status === "disposed") return { state, effects: none }
  if (event.type === "request.arrived") return arrived(state, event, config)
  if (event.type === "request.settled" || event.type === "request.aborted") return left(state, event, config)
  if (event.type === "watch.due") return watched(state, event.now, config)

  if (state.status === "running")
    return {
      state: { status: "disposed" },
      effects: state.inflight.length
        ? [{ type: "request.cancel", ids: state.inflight.map((entry) => entry.id) }]
        : none,
    }

  return {
    state: { status: "disposed" },
    effects: [stop, { type: "request.cancel", ids: [...state.waiting, ...state.inflight].map((entry) => entry.id) }],
  }
}

export const selectInflightCount = (state: RequestQueueState) =>
  state.status === "disposed" ? 0 : state.inflight.length
export const selectQueuedCount = (state: RequestQueueState) => (state.status === "queued" ? state.waiting.length : 0)
export const selectQueueDisposed = (state: RequestQueueState) => state.status === "disposed"
export const isRequestInflight = (state: RequestQueueState, id: number) =>
  state.status !== "disposed" && state.inflight.some((entry) => entry.id === id)

/** Writes and navigation-critical reads jump ahead of background indexes and older transcript pages. */
export function classifyRequest(method: string, url: URL): RequestClassification {
  const pathname = url.pathname
  if (pathname === "/api/event") return bypass
  const initialMessages =
    /^\/api\/session\/[^/]+\/message$/.test(pathname) &&
    !url.searchParams.has("cursor") &&
    !url.searchParams.has("before") &&
    !url.searchParams.has("type") &&
    url.searchParams.get("order") !== "asc"

  return {
    bypass: false,
    slow: slowRequestPaths.some((path) => pathname === path || pathname.startsWith(`${path}/`)),
    setup: method === "POST" && pathname === "/api/worktree",
    priority: method !== "GET" ? 2 : pathname === "/api/session" || initialMessages ? 1 : 0,
  }
}

type OpenState = Exclude<RequestQueueState, { status: "disposed" }>

function arrived(
  state: OpenState,
  event: Extract<RequestQueueEvent, { type: "request.arrived" }>,
  config: RequestQueueConfig,
) {
  const entry: RequestEntry = { id: state.nextId, method: event.method, url: event.url, at: event.now, slow: event.slow, priority: event.priority }
  const nextId = entry.id + 1

  if (canStart(state.inflight, entry.slow, config))
    return { state: { ...state, nextId, inflight: [...state.inflight, entry] }, effects: [{ type: "request.start" as const, id: entry.id }] }

  if (state.status === "running")
    return {
      state: { status: "queued" as const, nextId, warnedAt: state.warnedAt, inflight: state.inflight, waiting: [entry] },
      effects: [{ type: "watcher.start" as const, delayMs: config.stallMs }],
    }

  const position = state.waiting.findIndex((item) => item.priority < entry.priority)
  return {
    state: { ...state, nextId, waiting: position === -1 ? [...state.waiting, entry] : state.waiting.toSpliced(position, 0, entry) },
    effects: none,
  }
}

function left(
  state: OpenState,
  event: Extract<RequestQueueEvent, { type: "request.settled" | "request.aborted" }>,
  config: RequestQueueConfig,
) {
  const index = state.inflight.findIndex((entry) => entry.id === event.id)

  if (index === -1) {
    if (state.status === "running" || event.type === "request.settled") return { state, effects: none }
    const position = state.waiting.findIndex((entry) => entry.id === event.id)

    if (position === -1) return { state, effects: none }
    const waiting = state.waiting.toSpliced(position, 1)

    return waiting.length ? { state: { ...state, waiting }, effects: none } : { state: running(state, state.inflight), effects: [stop] }
  }

  const inflight = state.inflight.toSpliced(index, 1)
  if (state.status === "running") return { state: { ...state, inflight }, effects: none }
  const next = state.waiting.findIndex((entry) => canStart(inflight, entry.slow, config))

  if (next === -1) return { state: { ...state, inflight }, effects: none }
  const promoted = { ...state.waiting[next]!, at: event.now }
  const waiting = state.waiting.toSpliced(next, 1)
  const start: RequestQueueEffect = { type: "request.start", id: promoted.id }

  return waiting.length
    ? { state: { ...state, inflight: [...inflight, promoted], waiting }, effects: [start] }
    : { state: running(state, [...inflight, promoted]), effects: [stop, start] }
}

function watched(state: OpenState, now: number, config: RequestQueueConfig) {
  if (state.status !== "queued") return { state, effects: none }
  const waited = now - state.waiting.reduce((oldest, entry) => Math.min(oldest, entry.at), now)

  if (waited >= config.stallMs && now - state.warnedAt >= REQUEST_STALL_COOLDOWN_MS)
    return {
      state: { ...state, warnedAt: now },
      effects: [
        { type: "watcher.start" as const, delayMs: config.stallMs },
        {
          type: "log.stall" as const,
          data: {
            limit: config.limit,
            inflight: state.inflight.map((entry) => describe(entry, now)),
            queued: state.waiting.map((entry) => describe(entry, now)),
          },
        },
      ],
    }

  return {
    state,
    effects: [{ type: "watcher.start" as const, delayMs: waited >= config.stallMs ? config.stallMs : Math.max(1, config.stallMs - waited) }],
  }
}

function running(state: OpenState, inflight: readonly RequestEntry[]): RequestQueueState {
  return { status: "running", nextId: state.nextId, warnedAt: state.warnedAt, inflight }
}

function canStart(inflight: readonly RequestEntry[], slow: boolean, config: RequestQueueConfig) {
  if (inflight.length >= config.limit) return false
  if (!slow) return true

  return inflight.reduce((count, entry) => (entry.slow ? count + 1 : count), 0) < config.slowLimit
}

function describe(entry: RequestEntry, now: number): RequestStallItem {
  return { method: entry.method, url: entry.url, ms: now - entry.at }
}
