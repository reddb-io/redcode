export type NewSessionPhase = "worktree" | "mcp" | "session"

export const NEW_SESSION_WORKTREE_TIMEOUT_MS = 11 * 60_000
export const NEW_SESSION_MCP_TIMEOUT_MS = 2 * 60_000
export const NEW_SESSION_CREATE_TIMEOUT_MS = 30_000

export type PhaseState =
  | { readonly status: "idle"; readonly issued: number }
  | { readonly status: "running"; readonly issued: number; readonly attempt: number; readonly phase: NewSessionPhase }

export type PhaseEvent =
  | { readonly type: "phase.started"; readonly phase: NewSessionPhase }
  | { readonly type: "phase.settled"; readonly attempt: number; readonly phase: NewSessionPhase }
  | { readonly type: "phase.timed-out"; readonly attempt: number; readonly phase: NewSessionPhase }

export function createPhaseState(): PhaseState {
  return { status: "idle", issued: 0 }
}

export function transitionPhase(state: PhaseState, event: PhaseEvent): PhaseState {
  if (event.type === "phase.started") {
    if (state.status !== "idle") return state
    const attempt = state.issued + 1

    return { status: "running", issued: attempt, attempt, phase: event.phase }
  }

  if (state.status !== "running" || state.attempt !== event.attempt || state.phase !== event.phase) return state

  return { status: "idle", issued: state.issued }
}

export class NewSessionPhaseTimeoutError extends Error {
  constructor(
    readonly phase: NewSessionPhase,
    readonly timeoutMs: number,
  ) {
    super(`New session ${phase} phase timed out after ${Math.round(timeoutMs / 1000)} seconds`)
    this.name = "NewSessionPhaseTimeoutError"
  }
}

/** Runs sequential start phases with bounded waits. A response after its bound is reported only to `onLate`. */
export function createNewSessionPhaseRunner() {
  let state = createPhaseState()

  return {
    state: () => state,
    run<T>(
      phase: NewSessionPhase,
      operation: Promise<T>,
      timeoutMs: number,
      onLate?: (value: T) => void | Promise<void>,
    ) {
      const next = transitionPhase(state, { type: "phase.started", phase })

      if (next.status !== "running")
        return Promise.reject(new Error(`New session ${state.status} phase is already active`))
      state = next
      const attempt = next.attempt
      let timedOut = false

      return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => {
          timedOut = true
          state = transitionPhase(state, { type: "phase.timed-out", attempt, phase })
          reject(new NewSessionPhaseTimeoutError(phase, timeoutMs))
        }, timeoutMs)

        operation.then(
          (value) => {
            clearTimeout(timer)
            if (timedOut) {
              void Promise.resolve(onLate?.(value)).catch(() => undefined)
              return
            }
            const settled = transitionPhase(state, { type: "phase.settled", attempt, phase })

            if (settled === state) return
            state = settled
            resolve(value)
          },
          (cause) => {
            clearTimeout(timer)
            if (timedOut) return
            const settled = transitionPhase(state, { type: "phase.settled", attempt, phase })

            if (settled === state) return
            state = settled
            reject(cause)
          },
        )
      })
    },
  }
}
