/**
 * What the review's preview area shows while a revision is on its way: the zero state before the first
 * revision, the loading stages of a preview (build, assets, runtime), a failure, or the ready frame.
 */
export type LoadingStage = "revision" | "queued" | "tools" | "build" | "assets" | "runtime"

export interface LoadingState {
  readonly phase: "empty" | "loading" | "error" | "ready"
  readonly stage: LoadingStage
  /** The revision being loaded or shown. */
  readonly revision: string
  /** When the current load started, for the elapsed time. */
  readonly since: number
  /** The failure summary in the error phase. */
  readonly message: string
  /** The agent's live activity from the conversation feed, shown in the zero state. */
  readonly agent: "idle" | "thinking" | "tool"
  readonly tool: string
}

export type LoadingEvent =
  /** The design list answered: the design's latest revision, or none yet. */
  | { readonly type: "design"; readonly revision: string | undefined; readonly at: number }
  /**
   * The page asked for a revision's preview. A quiet load (a live reload of the frame on screen) keeps
   * the current frame visible until the new document arrives.
   */
  | { readonly type: "load"; readonly revision: string; readonly at: number; readonly quiet?: boolean }
  /**
   * The host's preview build status: queued, tools (installed on first use), building, ready or failed.
   * A failure is the preview response's to report; a status can be left over from an earlier attempt.
   */
  | { readonly type: "build"; readonly revision: string; readonly stage: string; readonly message?: string }
  /** The preview document arrived; the frame is loading its assets and fonts. */
  | { readonly type: "document"; readonly revision: string }
  /** The frame fired its load event. */
  | { readonly type: "frame" }
  /** The frame's runtime (screens, slides) reported ready, fonts included. */
  | { readonly type: "ready" }
  | { readonly type: "failed"; readonly revision: string; readonly message: string }
  | { readonly type: "agent"; readonly state: "working" | "idle" }
  | { readonly type: "tool"; readonly tool: string; readonly status: "running" | "done" | "failed" }

/**
 * The preview area's state machine: observed events in, the state to draw out. The standalone review
 * page serializes this function, so keep it self-contained.
 */
export function previewLoading() {
  const order: LoadingStage[] = ["revision", "queued", "tools", "build", "assets", "runtime"]
  const initial = (at: number): LoadingState => ({
    phase: "loading",
    stage: "revision",
    revision: "",
    since: at,
    message: "",
    agent: "idle",
    tool: "",
  })
  const reduce = (state: LoadingState, event: LoadingEvent): LoadingState => {
    if (event.type === "agent")
      return event.state === "idle"
        ? { ...state, agent: "idle", tool: "" }
        : { ...state, agent: state.tool ? "tool" : "thinking" }
    if (event.type === "tool") {
      if (event.status === "running") return { ...state, agent: "tool", tool: event.tool }
      if (event.tool !== state.tool) return state
      return { ...state, agent: "thinking", tool: "" }
    }
    if (event.type === "design") {
      if (!event.revision) return { ...state, phase: "empty", stage: "revision", revision: "", message: "" }
      if (state.phase !== "empty") return state
      return { ...state, phase: "loading", stage: "revision", since: event.at }
    }
    if (event.type === "load") {
      const next = { ...state, stage: "queued" as const, revision: event.revision, since: event.at, message: "" }
      return event.quiet && state.phase === "ready" ? next : { ...next, phase: "loading" }
    }
    if (event.type === "failed")
      return event.revision === state.revision ? { ...state, phase: "error", message: event.message } : state
    if (event.type === "document")
      return event.revision === state.revision && state.phase !== "error" && state.phase !== "empty"
        ? { ...state, phase: "loading", stage: "assets" }
        : state
    if (state.phase !== "loading") return state
    if (event.type === "build") {
      if (event.revision !== state.revision || event.stage === "failed") return state
      const stage: LoadingStage =
        event.stage === "tools" ? "tools" : event.stage === "building" || event.stage === "ready" ? "build" : "queued"
      // Status polls race the preview response: a load never goes back to an earlier stage.
      return order.indexOf(stage) > order.indexOf(state.stage) ? { ...state, stage } : state
    }
    if (event.type === "frame") return state.stage === "assets" ? { ...state, stage: "runtime" } : state
    // The runtime can report ready before the frame's own load event reaches the page.
    return state.stage === "assets" || state.stage === "runtime" ? { ...state, phase: "ready" } : state
  }
  const elapsed = (state: LoadingState, now: number) => Math.max(0, Math.floor((now - state.since) / 1000))
  return { initial, reduce, elapsed }
}
