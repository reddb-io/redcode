import type { Design } from "@opencode/schema/design"

/**
 * What the review's preview area shows while a revision is on its way: the zero state before the first
 * revision, the loading stages of a preview (build, assets, runtime), a failure, or the ready frame. It also
 * derives whether the revision on screen is the latest one and how far the newest feedback round has come.
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

/** How far the newest feedback round has come, as the Feedback panel's progress line names it. */
export type RoundStage =
  | "received"
  | "fixing"
  | "stopped"
  | "published"
  | "unverified"
  | "verifying"
  | "verifyFailed"
  | "recording"
  | "missing"
  | "recorded"
  | "ready"

/** What the page observed about the newest round, read fresh on every poll and feed event; nothing is stored. */
export interface RoundFacts {
  /** A revision the agent published answered the round (`Round.published` is set). */
  readonly published: boolean
  /** The feed saw the agent publish the answering revision, or the page has no feed to tell. */
  readonly answered: boolean
  readonly notes: ReadonlyArray<Pick<Design.Note, "status" | "addressed" | "by">>
  /** Notes without an outcome across every round: the rule approval and ending the review use. */
  readonly open: number
  /** A message of this round still waits in the agent's inbox. */
  readonly queued: boolean
  /** Some message to the agent, of any round, still waits in its inbox. */
  readonly inbox: boolean
  /** The agent's state from a connected feed; unknown without one. */
  readonly agent: "working" | "idle" | "unknown"
  /** How long the agent has been idle, in milliseconds. */
  readonly idle: number
  /** The round's newest verify job, and whether it checked the latest revision. */
  readonly verify?: { readonly status: Design.Job["status"]; readonly current: boolean }
  /** A job of the design is queued or running; its monitor resumes the agent when it ends. */
  readonly busy: boolean
  /** The revision on screen is the latest one and finished loading. */
  readonly onLatest: boolean
  /** The conversation feed is connected. */
  readonly connected: boolean
}

/** Whether the revision on screen is the latest, and what the page can say about it against the newest round. */
export interface RevisionFacts {
  /** The revision on screen and when it was published. */
  readonly shown?: { readonly id: string; readonly created?: number }
  /** Revisions newer than the one on screen that the page knows of, a feed announcement included. */
  readonly newer: number
  /** The reader follows the latest revision instead of one picked from the history. */
  readonly following: boolean
  /** What holds a newer revision back from replacing the one on screen. */
  readonly blocker: "" | "card" | "pending" | "dialog" | "hidden"
  /** A load of the latest revision is in flight. */
  readonly loading: boolean
  /** The latest revision, or the one on screen, failed to load. */
  readonly failed: boolean
  /** The feed dropped, or a poll could not reach the server. */
  readonly offline: boolean
  /** The newest round, with when its answering revision was published. */
  readonly round?: {
    readonly number: number
    readonly opened: number
    readonly revision: string
    readonly published?: string
    readonly answered?: number
  }
  /** Whether the agent published the revision on screen, as the feed reported; undefined without a feed to tell. */
  readonly byAgent?: boolean
}

/** The one-line statement above the preview about the revision on screen. */
export type RevisionLine =
  | ""
  | "failed"
  | "card"
  | "pending"
  | "older"
  | "answers"
  | "after"
  | "yours"
  | "unanswered"
  | "before"

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
  // An idle agent counts as stopped only after this long: a host can end one turn just before the next begins.
  const settle = 2000
  /**
   * The newest round's stage on a five-step bar (received, fixing, published, verifying, ready). A halted stage is
   * where an idle agent left the round short of the next step. "ready" is asserted only when every check holds.
   */
  const progress = (facts: RoundFacts) => {
    const count = (test: (note: RoundFacts["notes"][number]) => boolean) => facts.notes.filter(test).length
    const tally = {
      total: facts.notes.length,
      addressed: count((note) => note.status !== "open" || !!note.addressed),
      recorded: count((note) => note.status !== "open"),
      resolved: count((note) => note.status === "resolved"),
      partial: count((note) => note.status === "partial"),
      unresolved: count((note) => note.status === "unresolved" && note.by !== "reviewer"),
      accepted: count((note) => note.status === "accepted" && note.by !== "reviewer"),
      closed: count((note) => note.status !== "open" && note.by === "reviewer"),
    }
    const at = (stage: RoundStage, step: number, halted = false) => ({ stage, step, halted, ...tally })
    const idle = facts.agent === "idle" && facts.idle >= settle
    if (!facts.published) {
      if (facts.queued) return at("received", 0)
      if (facts.agent === "working" || (facts.agent === "unknown" && tally.addressed > 0)) return at("fixing", 1)
      return idle ? at("stopped", 1, true) : at("received", 0)
    }
    // Only a verify of the latest revision counts: a later publish makes an earlier verify outdated.
    const verify = facts.verify?.current ? facts.verify.status : undefined
    if (verify === "queued" || verify === "running") return at("verifying", 3)
    const verified = verify === "completed"
    if (tally.recorded === tally.total) {
      if (
        verified &&
        idle &&
        facts.open === 0 &&
        facts.answered &&
        !facts.busy &&
        !facts.inbox &&
        facts.onLatest &&
        facts.connected
      )
        return at("ready", 4)
      if (facts.agent === "working") return at("recording", 3)
      if (verified) return at("recorded", 4)
      return idle ? at("unverified", 3, true) : at("recording", 3)
    }
    if (verified) return idle ? at("missing", 3, true) : at("recording", 3)
    if (verify) return idle ? at("verifyFailed", 3, true) : at("published", 2)
    return idle ? at("unverified", 2, true) : at("published", 2)
  }
  /** The revision chip beside the picker and the statement above the preview. */
  const revision = (facts: RevisionFacts) => ({
    chip: facts.failed
      ? ("failed" as const)
      : facts.offline
        ? ("offline" as const)
        : facts.newer > 0
          ? facts.following && !facts.blocker
            ? ("updating" as const)
            : ("behind" as const)
          : facts.loading
            ? ("updating" as const)
            : ("latest" as const),
    line: line(facts),
  })
  const line = (facts: RevisionFacts): RevisionLine => {
    if (facts.failed) return "failed"
    if (facts.newer > 0 && facts.following && (facts.blocker === "card" || facts.blocker === "pending"))
      return facts.blocker
    if (facts.newer > 0 && !facts.following) return "older"
    const shown = facts.shown
    const round = facts.round
    if (!shown || !round) return ""
    // A revision answers a round only when the agent published it as the round's answer.
    if (round.published === shown.id) return facts.byAgent === false ? "yours" : "answers"
    if (!round.published) {
      // Published after the round opened while it stayed open: a page publish, or an agent restore.
      const later = shown.id !== round.revision && (shown.created ?? 0) > round.opened
      if (!later) return "before"
      return facts.byAgent ? "unanswered" : "yours"
    }
    return (shown.created ?? 0) > (round.answered ?? Number.POSITIVE_INFINITY) ? "after" : "older"
  }
  return { initial, reduce, elapsed, progress, revision }
}
