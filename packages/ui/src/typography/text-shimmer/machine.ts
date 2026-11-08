export const TEXT_SHIMMER_SWAP_MS = 220

export type TextShimmerState =
  | { readonly status: "inactive"; readonly attempts: number }
  | { readonly status: "active"; readonly attempts: number }
  | { readonly status: "fading"; readonly attempt: number }
  | { readonly status: "disposed" }

export type TextShimmerEvent =
  | { readonly type: "sync"; readonly active: boolean; readonly reducedMotion: boolean }
  | { readonly type: "settled"; readonly attempt: number }
  | { readonly type: "disposed" }

export const INITIAL_INACTIVE_TEXT_SHIMMER_STATE: TextShimmerState = Object.freeze({ status: "inactive", attempts: 0 })
export const INITIAL_ACTIVE_TEXT_SHIMMER_STATE: TextShimmerState = Object.freeze({ status: "active", attempts: 0 })
export const DISPOSED_TEXT_SHIMMER_STATE: TextShimmerState = Object.freeze({ status: "disposed" })
export const DISPOSED_TEXT_SHIMMER_EVENT: TextShimmerEvent = Object.freeze({ type: "disposed" })

const SYNC_ACTIVE: TextShimmerEvent = Object.freeze({ type: "sync", active: true, reducedMotion: false })
const SYNC_ACTIVE_REDUCED: TextShimmerEvent = Object.freeze({ type: "sync", active: true, reducedMotion: true })
const SYNC_INACTIVE: TextShimmerEvent = Object.freeze({ type: "sync", active: false, reducedMotion: false })
const SYNC_INACTIVE_REDUCED: TextShimmerEvent = Object.freeze({ type: "sync", active: false, reducedMotion: true })

export function syncTextShimmerEvent(active: boolean, reducedMotion: boolean): TextShimmerEvent {
  if (active) return reducedMotion ? SYNC_ACTIVE_REDUCED : SYNC_ACTIVE
  return reducedMotion ? SYNC_INACTIVE_REDUCED : SYNC_INACTIVE
}

export function createTextShimmerState(active: boolean): TextShimmerState {
  return active ? INITIAL_ACTIVE_TEXT_SHIMMER_STATE : INITIAL_INACTIVE_TEXT_SHIMMER_STATE
}

export function transitionTextShimmer(state: TextShimmerState, event: TextShimmerEvent): TextShimmerState {
  if (state.status === "disposed") return state
  if (event.type === "disposed") return DISPOSED_TEXT_SHIMMER_STATE
  if (event.type === "settled") {
    if (state.status !== "fading" || event.attempt !== state.attempt) return state
    return { status: "inactive", attempts: state.attempt }
  }
  if (state.status === "inactive") {
    if (!event.active) return state
    return state.attempts === 0 ? INITIAL_ACTIVE_TEXT_SHIMMER_STATE : { status: "active", attempts: state.attempts }
  }
  if (state.status === "active") {
    if (event.active) return state
    if (event.reducedMotion) {
      return state.attempts === 0
        ? INITIAL_INACTIVE_TEXT_SHIMMER_STATE
        : { status: "inactive", attempts: state.attempts }
    }
    return { status: "fading", attempt: state.attempts + 1 }
  }
  if (event.active) return { status: "active", attempts: state.attempt }
  if (event.reducedMotion) return { status: "inactive", attempts: state.attempt }
  return state
}

export function selectTextShimmerActive(state: TextShimmerState) {
  return state.status === "active"
}

export function selectTextShimmerRunning(state: TextShimmerState) {
  return state.status === "active" || state.status === "fading"
}
