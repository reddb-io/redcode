import type { SessionMessageUser } from "@opencode/client/promise"

export const HANDOFF_ECHO_TIMEOUT_MS = 1_000
export const HANDOFF_SEND_TIMEOUT_MS = 30_000
export const HANDOFF_SYNC_TIMEOUT_MS = 10_000

export type SessionMessageHandoff = { readonly message: SessionMessageUser }
type Entry = {
  readonly phase: "held" | "sending" | "awaiting-echo" | "syncing"
  readonly attempt: number
  readonly handoff: SessionMessageHandoff
}
export type SessionHandoffState =
  | {
      readonly status: "active"
      readonly connected: boolean
      readonly issued: number
      readonly entries: Readonly<Record<string, Entry>>
    }
  | { readonly status: "disposed" }

export type SessionHandoffEvent =
  | { readonly type: "handoff.set"; readonly sessionID: string; readonly handoff: SessionMessageHandoff }
  | { readonly type: "handoff.held"; readonly sessionID: string; readonly handoff: SessionMessageHandoff }
  | { readonly type: "prompt.settled"; readonly sessionID: string; readonly messageID: string }
  | { readonly type: "handoff.cleared"; readonly sessionID: string; readonly messageID: string }
  | { readonly type: "session.deleted"; readonly sessionID: string }
  | { readonly type: "connection.changed"; readonly connected: boolean }
  | { readonly type: "sending.timed-out"; readonly sessionID: string; readonly attempt: number }
  | { readonly type: "echo.timed-out"; readonly sessionID: string; readonly attempt: number }
  | { readonly type: "sync.settled"; readonly sessionID: string; readonly attempt: number }
  | { readonly type: "sync.timed-out"; readonly sessionID: string; readonly attempt: number }
  | { readonly type: "disposed" }

export type SessionHandoffEffect =
  | {
      readonly type: "timer.set"
      readonly sessionID: string
      readonly timer: "sending" | "echo" | "sync"
      readonly attempt: number
      readonly delayMs: number
    }
  | { readonly type: "timer.cancel"; readonly sessionID: string }
  | { readonly type: "timer.cancel-all" }
  | { readonly type: "sync"; readonly sessionID: string; readonly attempt: number }

export function createSessionHandoffState(connected = true): SessionHandoffState {
  return { status: "active", connected, issued: 0, entries: {} }
}

export function transitionSessionHandoff(
  state: SessionHandoffState,
  event: SessionHandoffEvent,
): { readonly state: SessionHandoffState; readonly effects: readonly SessionHandoffEffect[] } {
  if (state.status === "disposed") return { state, effects: [] }
  if (event.type === "disposed")
    return {
      state: { status: "disposed" },
      effects: Object.keys(state.entries).length ? [{ type: "timer.cancel-all" }] : [],
    }
  if (event.type === "connection.changed") return changeConnection(state, event.connected)

  const entry = state.entries[event.sessionID]
  if (event.type === "handoff.set") {
    const attempt = state.issued + 1

    return {
      state: {
        ...state,
        issued: attempt,
        entries: { ...state.entries, [event.sessionID]: { phase: "sending", attempt, handoff: event.handoff } },
      },
      effects: [
        { type: "timer.set", sessionID: event.sessionID, timer: "sending", attempt, delayMs: HANDOFF_SEND_TIMEOUT_MS },
      ],
    }
  }
  if (event.type === "handoff.held") {
    const attempt = state.issued + 1

    return {
      state: {
        ...state,
        issued: attempt,
        entries: { ...state.entries, [event.sessionID]: { phase: "held", attempt, handoff: event.handoff } },
      },
      effects: entry ? [{ type: "timer.cancel", sessionID: event.sessionID }] : [],
    }
  }
  if (!entry) return { state, effects: [] }

  if (event.type === "prompt.settled") {
    if (entry.phase !== "sending" || entry.handoff.message.id !== event.messageID) return { state, effects: [] }
    const attempt = state.issued + 1

    return {
      state: {
        ...state,
        issued: attempt,
        entries: { ...state.entries, [event.sessionID]: { ...entry, phase: "awaiting-echo", attempt } },
      },
      effects: [
        {
          type: "timer.set",
          sessionID: event.sessionID,
          timer: "echo",
          attempt,
          delayMs: state.connected ? HANDOFF_ECHO_TIMEOUT_MS : HANDOFF_SEND_TIMEOUT_MS,
        },
      ],
    }
  }

  if (event.type === "handoff.cleared")
    return entry.handoff.message.id === event.messageID ? clear(state, event.sessionID) : { state, effects: [] }
  if (event.type === "session.deleted") return clear(state, event.sessionID)
  if (entry.attempt !== event.attempt) return { state, effects: [] }

  if (event.type === "sending.timed-out" || event.type === "echo.timed-out") {
    const phase = event.type === "sending.timed-out" ? "sending" : "awaiting-echo"

    if (entry.phase !== phase) return { state, effects: [] }
    if (!state.connected) return { state: { ...state, entries: without(state.entries, event.sessionID) }, effects: [] }

    return startSync(state, event.sessionID, entry.handoff)
  }

  if (entry.phase !== "syncing") return { state, effects: [] }
  if (event.type === "sync.settled") return clear(state, event.sessionID)

  return { state: { ...state, entries: without(state.entries, event.sessionID) }, effects: [] }
}

export function selectSessionHandoff(state: SessionHandoffState, sessionID: string | undefined) {
  return state.status === "active" && sessionID ? state.entries[sessionID]?.handoff : undefined
}

export function selectSessionHandoffHeld(state: SessionHandoffState, sessionID: string, messageID: string) {
  if (state.status !== "active") return false
  const entry = state.entries[sessionID]

  return entry?.phase === "held" && entry.handoff.message.id === messageID
}

function changeConnection(
  state: Extract<SessionHandoffState, { status: "active" }>,
  connected: boolean,
) {
  if (state.connected === connected) return { state, effects: [] }
  const waiting = Object.entries(state.entries).filter(([, entry]) => entry.phase === "awaiting-echo")

  if (!waiting.length) return { state: { ...state, connected }, effects: [] }
  const entries = { ...state.entries }
  const effects = waiting.flatMap(([sessionID, entry]): SessionHandoffEffect[] => {
    entries[sessionID] = { ...entry, phase: connected ? "syncing" : "awaiting-echo" }

    return connected
      ? [
          { type: "sync", sessionID, attempt: entry.attempt },
          { type: "timer.set", sessionID, timer: "sync", attempt: entry.attempt, delayMs: HANDOFF_SYNC_TIMEOUT_MS },
        ]
      : [
          { type: "timer.set", sessionID, timer: "echo", attempt: entry.attempt, delayMs: HANDOFF_SEND_TIMEOUT_MS },
        ]
  })

  return { state: { ...state, connected, entries }, effects }
}

function startSync(
  state: Extract<SessionHandoffState, { status: "active" }>,
  sessionID: string,
  handoff: SessionMessageHandoff,
) {
  const attempt = state.issued + 1

  return {
    state: {
      ...state,
      issued: attempt,
      entries: { ...state.entries, [sessionID]: { phase: "syncing" as const, attempt, handoff } },
    },
    effects: [
      { type: "sync" as const, sessionID, attempt },
      { type: "timer.set" as const, sessionID, timer: "sync" as const, attempt, delayMs: HANDOFF_SYNC_TIMEOUT_MS },
    ],
  }
}

function clear(state: Extract<SessionHandoffState, { status: "active" }>, sessionID: string) {
  return {
    state: { ...state, entries: without(state.entries, sessionID) },
    effects: [{ type: "timer.cancel" as const, sessionID }],
  }
}

function without(entries: Readonly<Record<string, Entry>>, sessionID: string) {
  const next = { ...entries }
  delete next[sessionID]

  return next
}
